import type {
    AnalyzeResult, CookieItem, PolicyBundle, CookieTableRow, RetentionItem,
    ConsentSignals, ThirdPartySignals, ScoreResult, Summary, RiskLevel
  } from '../types/contracts.js';

  // -- utils ----------------------------------------------------

  async function ensureContentScript(tabId: number) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
    } catch {}
  }
  function tabsSendMessage<T = any>(tabId: number, message: any): Promise<T> {
    return new Promise((res, rej) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) return rej(err);
        res(response as T);
      });
    });
  }

  // Approximate site root (eTLD+1-ish). Good enough for cross-subdomain matching.
  function approxSiteRoot(hostname: string): string {
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 2) return hostname.toLowerCase();
    // crude handling for common ccTLDs like co.in — keep last 3 if second-last is 2 letters
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (prev.length <= 3) return parts.slice(-3).join('.').toLowerCase();
    return parts.slice(-2).join('.').toLowerCase();
  }

  // Filter to same-site (eTLD+1), not same-origin
  function filterSameSite(urls: string[], pageUrl: string): string[] {
    const siteRoot = approxSiteRoot(new URL(pageUrl).hostname);
    return Array.from(new Set(urls)).filter(u => {
      try {
        const root = approxSiteRoot(new URL(u).hostname);
        return root === siteRoot;
      } catch {
        return false;
      }
    });
  }

  function toDays(text: string | null): number | null {
    if (!text) return null;
    const s = text.toLowerCase();
    if (s.includes('session')) return 0;
    if (s.includes('few seconds')) return 0;
    const m = s.match(/(\d+)\s*(day|week|month|year)s?/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const factor = unit === 'day' ? 1 : unit === 'week' ? 7 : unit === 'month' ? 30 : 365;
    return n * factor;
  }

  function maxDaysFromRow(lifespanText?: string | null, rawRow?: string | null): number {
    const texts = [lifespanText || '', rawRow || ''].join(' | ');
    const matches = Array.from(texts.matchAll(/(\d+)\s*(day|week|month|year)s?/gi));
    if (!matches.length) {
      if (/session|few seconds/i.test(texts)) return 0;
      return 0;
    }
    return matches.reduce((mx, m) => {
      const d = toDays(m[0]) ?? 0;
      return Math.max(mx, d);
    }, 0);
  }

  // Vendor/name hints (small curated lists)
  const analyticsHints = [
    'analytics', 'google analytics', '_ga', '_gid', '_gat', 'gtm', 'gtag', 'rt', 'optimizely', 'segment', 'adobe analytics'
  ];
  const adsHints = [
    'ad', 'advert', 'marketing', 'doubleclick', 'criteo', 'adnxs', '_fbp', 'tiktok', 'tt_', 'gcl', 'taboola', 'outbrain', 'trade desk', 'quantcast'
  ];

  function containsAny(hay: string, needles: string[]): boolean {
    const s = hay.toLowerCase();
    return needles.some(n => s.includes(n));
  }

  function isAnalyticsRow(row: { category?: string | null; cookie_name?: string | null; raw_row_text?: string | null }): boolean {
    const blob = ((row.category || '') + ' ' + (row.cookie_name || '') + ' ' + (row.raw_row_text || '')).toLowerCase();
    return /analytics|performance/.test(row.category || '') || containsAny(blob, analyticsHints);
  }
  function isAdsRow(row: { category?: string | null; cookie_name?: string | null; raw_row_text?: string | null }): boolean {
    const blob = ((row.category || '') + ' ' + (row.cookie_name || '') + ' ' + (row.raw_row_text || '')).toLowerCase();
    return /target|advert|ads|marketing/.test(row.category || '') || containsAny(blob, adsHints);
  }
  
  function percentile75(values: number[]): number {
    const arr = values.filter(v => Number.isFinite(v)).sort((a,b) => a-b);
    if (arr.length === 0) return 0;
    const idx = Math.ceil(0.75 * arr.length) - 1;
    return arr[Math.max(0, Math.min(arr.length - 1, idx))];
  }

  function readabilityHint(text: string): 'plain'|'moderate'|'legalese' {
    const words = text.split(/\s+/).filter(Boolean);
    const sentences = text.split(/[\.!?]+/).filter(s => s.trim().length > 0);
    const avgLen = sentences.length ? (words.length / sentences.length) : 20;
    const legaleseHits = (text.match(/hereby|thereof|hereto|pursuant|notwithstanding|whereas|therein|thereon|therewith/gi) || []).length;
    if (avgLen > 25 || legaleseHits >= 3) return 'legalese';
    if (avgLen > 18 || legaleseHits >= 1) return 'moderate';
    return 'plain';
  }

  // -- content bridge -------------------------------------------
  
  export async function discoverPolicyUrlsOnPage(tabId: number): Promise<string[]> {
    try {
      await ensureContentScript(tabId);
      const r = await tabsSendMessage<string[]>(tabId, { type: 'DISCOVER_POLICY_LINKS' });
      return Array.isArray(r) ? r : [];
    } catch { return []; }
  }
  async function getRenderedPageText(tabId: number): Promise<string> {
    try {
      await ensureContentScript(tabId);
      const text = await tabsSendMessage<string>(tabId, { type: 'GET_PAGE_TEXT' });
      return typeof text === 'string' ? text : '';
    } catch { return ''; }
  }
  async function getCookieTableRows(tabId: number): Promise<CookieTableRow[]> {
    try {
      await ensureContentScript(tabId);
      const rows = await tabsSendMessage<CookieTableRow[]>(tabId, { type: 'GET_COOKIE_TABLES' });
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }
  
  // -- fetch & normalize ----------------------------------------
  
  export async function fetchAndNormalizePolicies(urls: string[]): Promise<PolicyBundle> {
    const taken = Array.from(new Set(urls)).slice(0, 5);
    const texts: string[] = [];
    for (const u of taken) {
      try {
        const res = await fetch(u);
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        texts.push(text);
      } catch {}
    }
    return { urls: taken, text: texts.join('\n\n---\n\n') };
  }
  
  // -- main builder ---------------------------------------------
  
  export async function buildAnalyzeResult(
    pageUrl: string,
    preCookies: chrome.cookies.Cookie[],
    policy: PolicyBundle
  ): Promise<AnalyzeResult> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id ?? -1;
  
    // 1) same-site URLs or current page
    let urls = policy.urls.length ? filterSameSite(policy.urls, pageUrl) : [];
    if (urls.length === 0) urls = [pageUrl];
  
    // 2) text (fetch or rendered)
    let text = (policy.text || '').slice(0, 200000);
    if (tabId > -1 && text.length < 500) {
      const rendered = await getRenderedPageText(tabId);
      if (rendered && rendered.length > text.length) text = rendered.slice(0, 200000);
    }
  
    // 3) cookie table rows
    let tableRows: CookieTableRow[] = [];
    if (tabId > -1) {
      tableRows = await getCookieTableRows(tabId);
    }
  
    // 4) retention extraction
    const retention: RetentionItem[] = [];
    const lines = text.split(/[\.!\?\n]/);
    const cue = /(retain|retention|keep|store|delete|erasure|until)/i;
    const dur = /(\d+)\s*(day|week|month|year)s?/i;
  
    // 4A) from cookie table
    for (const r of tableRows) {
      const d = r.lifespan_text || (r.raw_row_text || '').match(/(\d+)\s*(day|week|month|year)s?/i)?.[0] || null;
      if (!d) continue;
      retention.push({
        data_category: (r.category || 'cookie'),
        duration_text: d,
        iso_duration: null,
        quote: (r.raw_row_text || `${r.cookie_name || ''} ${d}`).trim(),
        source_url: pageUrl,
        source_type: 'cookie_table'
      });
    }
  
    // 4B) from policy text (non-cookie PD retention if possible)
    const pdCtx = /(personal data|personal information|customer data|account|order|records)/i;
    for (const ln of lines) {
      if (cue.test(ln) && pdCtx.test(ln)) {
        const m = ln.match(dur) || ln.match(/until (?:account )?deletion/i) || ln.match(/as required by law/i);
        if (m) {
          retention.push({
            data_category: 'personal_data',
            duration_text: m[0],
            iso_duration: null,
            quote: ln.trim(),
            source_url: pageUrl,
            source_type: 'policy_text'
          });
        }
      }
    }
  
    // 5) consent signals
    const textLc = text.toLowerCase();
    const cmpName =
      /onetrust|optanon/i.test(text) ? 'OneTrust' :
      /trustarc/i.test(text) ? 'TrustArc' :
      /cookiebot/i.test(text) ? 'Cookiebot' :
      /quantcast/i.test(text) ? 'Quantcast' : null;

    const granular_controls =
      /\b(preferences|manage (cookie|cookies)|granular|category|settings)\b/i.test(text);

    let reject_all_available: boolean | 'unclear' =
      /\breject all\b/i.test(text) || /\bdecline\b/i.test(text) ? true : false;

    // If a CMP is present but we didn't find explicit copy for reject-all, mark as 'unclear'
    if (cmpName && reject_all_available === false) {
      reject_all_available = 'unclear';
    }

    const consent: ConsentSignals = {
      granular_controls,
      reject_all_available,
      cmp_name: cmpName
    };
  
    // 6) third-party trackers (from table domains vs site)
    const analyticsRows = tableRows.filter(isAnalyticsRow);
    const targetingRows = tableRows.filter(isAdsRow);
    const siteRoot = approxSiteRoot(new URL(pageUrl).hostname);
    const domainRegex = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}/i;
    const domains = new Set<string>();
    for (const r of tableRows) {
      // try to grab a domain from row text
      let d = r.raw_row_text?.match(domainRegex)?.[0] || null;
      if (!d && r.cookie_name && domainRegex.test(r.cookie_name)) {
        d = r.cookie_name!.match(domainRegex)![0];
      }
      if (d) {
        const root = approxSiteRoot(d.toLowerCase());
        if (root && root.indexOf(siteRoot) === -1) domains.add(root);
      }
    }
    const third_parties: ThirdPartySignals = {
      count: domains.size,
      top_domains: Array.from(domains).slice(0, 3)
    };
  
    // 6b) durations arrays + p75s
    const adsDurations: number[] = targetingRows.map(r => maxDaysFromRow(r.lifespan_text, r.raw_row_text)).filter(n => n >= 0);
    const analyticsDurations: number[] = analyticsRows.map(r => maxDaysFromRow(r.lifespan_text, r.raw_row_text)).filter(n => n >= 0);
    const outliersDays: number[] = [...adsDurations, ...analyticsDurations].filter(n => n > 730);

  // 7) disclosures + missing
    const rightsRegex = /\bright(s)?\b.*\b(access|rectification|erasure|deletion|portability|object|objection|restriction|appeal)\b/i;
    const rights =
      rightsRegex.test(text) ||
      /\byou have the right to\b/i.test(text);
    const contact = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /data protection officer|DPO/i.test(text);
  
    const anyPdRetention = retention.some(r => r.source_type === 'policy_text' && r.data_category === 'personal_data');
  
    const missing: string[] = [];
    if (!anyPdRetention) {
      missing.push('No personal-data retention statement found (cookie lifespans are separate).');
    }
    if (!rights) missing.push('User rights not clearly listed');
    if (!contact) missing.push('Contact/DPO not found');
  
     // 8) risk scoring (friendlier thresholds)
  let points = 0;
  const reasons: string[] = [];

  // Accurate max durations by category using row-level max

  const maxAnalytics = analyticsRows.reduce((mx, r) => Math.max(mx, maxDaysFromRow(r.lifespan_text, r.raw_row_text)), 0);
  const maxTargetDays = targetingRows.reduce((mx, r) => Math.max(mx, maxDaysFromRow(r.lifespan_text, r.raw_row_text)), 0);
  if (maxTargetDays > 730) { points += 3; reasons.push(`Very long ads cookies (~${maxTargetDays} days).`); }
  else if (maxTargetDays > 400) { points += 2; reasons.push(`Long ads cookies (~${maxTargetDays} days).`); }

  // b) third-party presence
  if (third_parties.count >= 50) { points += 3; reasons.push(`Very many third-party trackers (~${third_parties.count}).`); }
  else if (third_parties.count >= 20) { points += 2; reasons.push(`Many third-party trackers (~${third_parties.count}).`); }
  else if (third_parties.count >= 10) { points += 1; reasons.push(`Several third-party trackers (~${third_parties.count}).`); }

  // c) consent quality
  if (!consent.granular_controls) { points += 2; reasons.push('No way to choose cookies by category.'); }
  if (!consent.reject_all_available) { points += 1; reasons.push('No "reject all" option.'); }

  // d) PD retention / rights / contact
  if (!anyPdRetention) { points += 1; reasons.push('Personal-data retention not stated.'); }
  if (!rights) { points += 1; reasons.push('User rights not listed.'); }
  if (!contact) { points += 1; reasons.push('No contact/DPO found.'); }

  let level: RiskLevel = 'LIKELY_OK';
  if (points >= 6) level = 'AVOID';
  else if (points >= 3) level = 'CAUTION';
  const score: ScoreResult = { level, points, reasons };

  // 9) TL;DR bullets + advice (plain-language, with context)
  const bullets: string[] = [];

  function labelDuration(days: number | null): string {
    if (days === null) return 'unspecified';
    if (days === 0) return 'session only';
    if (days <= 90) return `short (~${days}d)`;
    if (days <= 400) return `typical (~${days}d)`;
    if (days <= 730) return `long (~${days}d)`;
    return `very long (~${days}d)`;
  }

  const tp = third_parties.count;
  const tpLabel =
    tp === 0 ? 'no third-party trackers'
    : tp < 6 ? 'a few third-party trackers'
    : tp < 20 ? 'some third-party trackers'
    : tp < 50 ? 'many third-party trackers (common on large sites)'
    : 'a very large number of third-party trackers';

  bullets.push(`Ads cookies: ${labelDuration(maxTargetDays)}; Analytics: ${labelDuration(maxAnalytics)}; ${tpLabel}.`);

  bullets.push(anyPdRetention
    ? 'They state how long personal data (like account info) is kept.'
    : 'They don’t say how long personal data (like account info) is kept.');

  const consentSummary = consent.granular_controls
    ? 'You can choose which cookies to allow'
    : 'No easy way to choose cookies';
  const rejectSummary = consent.reject_all_available ? 'Has a "reject all" button' : 'No "reject all" button';
  bullets.push(`${consentSummary}. ${rejectSummary}. Rights ${rights ? 'listed' : 'not listed'}. Contact ${contact ? 'present' : 'missing'}.`);

  let advice = '';
  if (level === 'LIKELY_OK') {
    advice = 'Looks fine: accept essential cookies, and consider turning off ads/marketing if you prefer.';
  } else if (level === 'CAUTION') {
    advice = 'Proceed carefully: turn off ads/marketing cookies if possible; continue only if you’re comfortable.';
  } else {
    advice = 'High risk: avoid accepting non-essential cookies here; consider leaving or using private mode.';
  }
  const summary: Summary = { score, bullets, advice };

  // 10) cookies snapshot (from chrome.cookies)
  const pre: CookieItem[] = preCookies.map(c => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: (c.sameSite as any) ?? 'unspecified',
    expirationDate: c.expirationDate,
    maxAge: c.expirationDate ? Math.max(0, Math.round(c.expirationDate - (Date.now() / 1000))) : null,
  }));

  const readHint = readabilityHint(text);

  return {
    pageUrl,
    policy: { urls, text: text.slice(0, 10000) },
    cookies: { pre },
    extraction: {
      durations: { ads_days: adsDurations, analytics_days: analyticsDurations, outliers_days: outliersDays },
      retention,
      disclosures: {
        retention_disclosed: retention.length > 0,
        user_rights_listed: rights,
        contact_or_dpo_listed: contact,
      },
      consent,
      third_parties,
      missing,
    },
    metrics: {
      ads_p75_days: percentile75(adsDurations) || maxTargetDays,
      analytics_p75_days: percentile75(analyticsDurations) || maxAnalytics,
      very_long_vendors: adsDurations.filter(n => n > 730).length,
    },
    readability_hint: readHint,
    summary,
    findings: [],
  };
}
