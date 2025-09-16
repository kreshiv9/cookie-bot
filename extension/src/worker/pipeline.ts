import type { AnalyzeResult, CookieItem, PolicyBundle } from '../types/contracts.js';

// Inject content script if needed
async function ensureContentScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
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

export async function discoverPolicyUrlsOnPage(tabId: number): Promise<string[]> {
  try {
    await ensureContentScript(tabId);
    const r = await tabsSendMessage<string[]>(tabId, { type: 'DISCOVER_POLICY_LINKS' });
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

async function getRenderedPageText(tabId: number): Promise<string> {
  try {
    await ensureContentScript(tabId);
    const text = await tabsSendMessage<string>(tabId, { type: 'GET_PAGE_TEXT' });
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

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

export async function buildAnalyzeResult(
  pageUrl: string,
  preCookies: chrome.cookies.Cookie[],
  policy: PolicyBundle
): Promise<AnalyzeResult> {
  let text = (policy.text || '').slice(0, 200000);

  // If fetched text is suspiciously small, we likely hit a JS-rendered page.
  // Ask the content script for the rendered page text instead.
  if (text.length < 500) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const rendered = await getRenderedPageText(tab.id);
      if (rendered && rendered.length > text.length) text = rendered.slice(0, 200000);
    }
  }

  const lines = text.split(/[\.!\?\n]/);

  const retention: AnalyzeResult['extraction']['retention'] = [];
  const missing: string[] = [];

  const cue = /(retain|retention|keep|store|delete|erasure|until)/i;
  const dur = /(\d+)\s*(day|week|month|year)s?/i;

  for (const ln of lines) {
    if (cue.test(ln)) {
      const m = ln.match(dur) || ln.match(/until (?:account )?deletion/i) || ln.match(/as required by law/i);
      if (m) retention.push({ data_category: 'general', duration_text: m[0], iso_duration: null, quote: ln.trim() });
    }
  }

  // Fallback: capture standalone durations (useful for table lifespans)
  if (retention.length === 0) {
    const durOnly = text.match(/(\d+)\s*(day|week|month|year)s?/gi);
    if (durOnly) {
      const seen = new Set<string>();
      for (const d of durOnly.slice(0, 10)) {
        if (seen.has(d)) continue;
        seen.add(d);
        const idx = text.indexOf(d);
        const start = Math.max(0, idx - 80);
        const end = Math.min(text.length, idx + d.length + 80);
        const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
        retention.push({ data_category: 'general', duration_text: d, iso_duration: null, quote: snippet });
      }
    }
  }

  if (!retention.length) missing.push('No explicit retention duration found');

  const rights = /(access|erasure|delete|portability|opt[- ]?out|appeal)/i.test(text);
  const contact = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /data protection officer/i.test(text);
  if (!rights)  missing.push('User rights not clearly listed');
  if (!contact) missing.push('Contact/DPO not found');

  const pre: CookieItem[] = preCookies.map(c => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: (c.sameSite as any) ?? 'unspecified',
    expirationDate: c.expirationDate,
    maxAge: c.expirationDate ? Math.max(0, Math.round((c.expirationDate - (Date.now()/1000)))) : null
  }));

  return {
    pageUrl,
    policy: { urls: policy.urls, text: text.slice(0, 10000) }, // small preview only
    cookies: { pre },
    extraction: {
      retention,
      disclosures: {
        retention_disclosed: retention.length > 0,
        user_rights_listed: rights,
        contact_or_dpo_listed: contact
      },
      missing
    },
    findings: []
  };
}