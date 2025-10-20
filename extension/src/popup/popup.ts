type AnalyzeResult = import('../types/contracts').AnalyzeResult;
import { API_BASE_URL } from '../config.js';

function tabsQuery(q: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise(res => chrome.tabs.query(q, res));
}
function runtimeSendMessage<T = any>(message: any): Promise<T> {
  return new Promise(res => chrome.runtime.sendMessage(message, res));
}

const analyzeBtn = document.getElementById('analyzeBtn') as HTMLButtonElement;
const domainEl   = document.getElementById('domain') as HTMLElement;
const statusEl   = document.getElementById('status') as HTMLElement;

const verdictEl  = document.getElementById('verdict') as HTMLElement;
const tldrEl     = document.getElementById('tldrList') as HTMLUListElement;
const adviceEl   = document.getElementById('advice') as HTMLElement;
const cloudTag   = document.getElementById('cloudTag') as HTMLElement;
const clarityEl  = document.getElementById('clarityScore') as HTMLElement;
const safetyEl   = document.getElementById('safetyScore') as HTMLElement;
const siteTypeSel = document.getElementById('siteType') as HTMLSelectElement | null;

const linksEl    = document.getElementById('policyLinks') as HTMLElement;

const retentionEl= document.getElementById('retentionList') as HTMLUListElement;
const rcEl       = document.getElementById('rightsContact') as HTMLElement;
const cookiesEl  = document.getElementById('cookies') as HTMLElement;
const missingEl  = document.getElementById('missingList') as HTMLUListElement;
const reasonsEl  = document.getElementById('reasonsList') as HTMLUListElement;

analyzeBtn?.addEventListener('click', async () => {
  statusEl.textContent = 'Analyzing (cloud)…';
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    statusEl.textContent = 'No active tab';
    return;
  }
  domainEl.textContent = new URL(tab.url).hostname;

  const result = await runtimeSendMessage<AnalyzeResult | { error: string }>({ type: 'ANALYZE_ACTIVE_TAB' });
  if ((result as any)?.error) {
    statusEl.textContent = 'Error: ' + (result as any).error;
    return;
  }
  const local = result as AnalyzeResult;
  // Cloud-only: build payload and call server; do not render local
  if (!API_BASE_URL) {
    statusEl.textContent = 'Cloud not configured';
    if (cloudTag) cloudTag.style.display = 'none';
    return;
  }
  try {
    const payload = toServerPayload(local);
    const resp = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      let msg = 'server error';
      try { const j = await resp.json(); msg = j?.error || msg; } catch {}
      statusEl.textContent = 'Error: ' + msg;
      if (cloudTag) cloudTag.style.display = 'none';
      return;
    }
    const remote = await resp.json();
    applyRemote(remote);
    statusEl.textContent = 'Done';
    if (cloudTag) cloudTag.style.display = '';
  } catch (e: any) {
    statusEl.textContent = 'Error: ' + (e?.message || 'network');
    if (cloudTag) cloudTag.style.display = 'none';
  }
});

// --- helpers ---------------------------------------------------
function fnv1a32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 (with 32-bit overflow)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  // convert to unsigned hex
  return (h >>> 0).toString(16);
}

function detectCookieCategoriesExplained(text: string): boolean {
  return /(necessary|strictly necessary|analytics|performance|functional|preferences|personalization|targeting|advertising|marketing|measurement|statistics|security)/i.test(text)
    || /(cookie (?:center|centre|preferences)|consent (?:center|centre)|manage (?:cookie|cookies))/i.test(text);
}

function detectCookieLifespansDisclosed(text: string): boolean {
  return /(\b\d+\s*(minute|minutes|hour|hours|day|week|month|year)s?\b|session|expires|expiry|expiration|valid for)/i.test(text);
}

function detectLastUpdated(text: string): boolean {
  if (!text) return false;
  // Focus on the beginning where sites usually place it
  const head = text.slice(0, 4000);
  const kw = /(last\s+(updated|modified|revised|changed)|updated\s*(on|:)?|effective\s+(date|as of|from)|revision\s+date|last\s+revision|last\s+revised|policy\s+version)/i;
  if (kw.test(head)) return true;
  // Light date heuristics combined with context words
  const dateWords = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(,\s*\d{2,4})?|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}\b/i;
  const ctx = /(updated|effective|revis(ed|ion)|modified)/i;
  // Look for a context word near a date within the head
  const lines = head.split(/\n|\.|\r/).slice(0, 20);
  for (const ln of lines) {
    if (ctx.test(ln) && dateWords.test(ln)) return true;
  }
  return false;
}

function render(data: AnalyzeResult) {
  // Quick take (score badge + TL;DR + advice)
  verdictEl.textContent = labelForLevel(data.summary.score.level);
  verdictEl.className = 'pill small ' + classForLevel(data.summary.score.level);

  tldrEl.innerHTML = '';
  data.summary.bullets.slice(0,3).forEach(b => {
    const li = document.createElement('li');
    li.textContent = b;
    tldrEl.appendChild(li);
  });

  adviceEl.textContent = data.summary.advice;
  if (clarityEl) clarityEl.textContent = '—';
  if (safetyEl) safetyEl.textContent = '—';

  // Policy links
  linksEl.innerHTML = data.policy.urls.length
    ? data.policy.urls.map(u => `<span class="badge">${escapeHtml(u)}</span>`).join(' ')
    : 'None found';

  // Details: Retention quotes with provenance
  retentionEl.innerHTML = '';
  data.extraction.retention.forEach(item => {
    const source = item.source_type === 'cookie_table' ? 'cookie table' : 'policy text';
    const li = document.createElement('li');
    li.innerHTML =
      `<div><strong>${escapeHtml(item.data_category || 'general')}</strong>: ${escapeHtml(item.duration_text || 'unspecified')} <span class="badge">${escapeHtml(source)}</span></div>` +
      (item.quote ? `<div class="quote">“${escapeHtml(item.quote)}”</div>` : '');
    retentionEl.appendChild(li);
  });

  // Rights, contact & consent (plain-English)
  const bits: string[] = [];
  bits.push(data.extraction.disclosures.user_rights_listed ? 'Your privacy rights: ✅' : 'Your privacy rights: ❌');
  bits.push(data.extraction.disclosures.contact_or_dpo_listed ? 'Privacy contact listed: ✅' : 'Privacy contact listed: ❌');

  const c = data.extraction.consent;
  bits.push(c.granular_controls
    ? 'You can choose which cookies to allow: Yes'
    : 'You can choose which cookies to allow: No');
  bits.push(
    c.reject_all_available === true
      ? '“Reject non-essential” button: Yes'
      : c.reject_all_available === 'unclear'
        ? '“Reject non-essential” button: Unclear'
        : '“Reject non-essential” button: No'
  );
  if (c.cmp_name) bits.push(`Consent manager: ${c.cmp_name}`);

  rcEl.textContent = bits.join(' • ');

  // Cookies snapshot
  const pre = data.cookies.pre;
  const top = [...pre].sort((a,b) => (b.maxAge || 0) - (a.maxAge || 0)).slice(0,3);
  const topStr = top.map(c => `${c.name} (${c.maxAge ? Math.round((c.maxAge)/86400) + 'd' : 'session'})`).join(', ');
  cookiesEl.textContent = `${pre.length} cookies • Top by lifetime: ${topStr || 'n/a'}`;

  // Missing
  missingEl.innerHTML = '';
  data.extraction.missing.forEach(m => {
    const li = document.createElement('li');
    li.textContent = m;
    missingEl.appendChild(li);
  });
  if (reasonsEl) reasonsEl.innerHTML = '';
}

function labelForLevel(level: AnalyzeResult['summary']['score']['level']): string {
  return level === 'LIKELY_OK' ? 'Likely OK'
       : level === 'CAUTION' ? 'Proceed with caution'
       : 'High risk';
}
function classForLevel(level: AnalyzeResult['summary']['score']['level']): string {
  return level === 'LIKELY_OK' ? 'ok'
       : level === 'CAUTION' ? 'warn'
       : 'bad';
}

function escapeHtml(s: string) {
  return s.replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch] as string));
}

function toServerPayload(data: AnalyzeResult) {
  const rejectVal = data.extraction.consent.reject_all_available === true ? 'yes'
    : data.extraction.consent.reject_all_available === false ? 'no'
    : 'unclear';
  const text = data.policy?.text || '';
  const arrays = data.extraction.durations;
  const hasDurations = !!(arrays && ((arrays.ads_days?.length || 0) > 0 || (arrays.analytics_days?.length || 0) > 0 || (arrays.outliers_days?.length || 0) > 0));
  const cookieCategoriesExplained = detectCookieCategoriesExplained(text);
  const cookieLifespansDisclosed = hasDurations || detectCookieLifespansDisclosed(text);
  const lastUpdatedPresent = detectLastUpdated(text);
  const siteType = siteTypeSel?.value || 'retail';
  const rawTextHash = fnv1a32(text);
  return {
    siteUrl: data.pageUrl,
    siteType,
    rawTextHash,
    durations: data.extraction.durations || undefined,
    durations_evidence: data.extraction.durations_evidence || undefined,
    retention: (data.extraction.retention || []).slice(0, 5).map(r => ({
      source_type: r.source_type,
      data_category: r.data_category,
      duration_text: r.duration_text,
      quote: (r.quote || '').slice(0, 200)
    })),
    disclosures: {
      rights_listed: data.extraction.disclosures.user_rights_listed,
      contact_present: data.extraction.disclosures.contact_or_dpo_listed,
      pd_retention_present: data.extraction.disclosures.retention_disclosed,
      cookie_categories_explained: cookieCategoriesExplained,
      cookie_lifespans_disclosed: cookieLifespansDisclosed,
      last_updated_present: lastUpdatedPresent
    },
    consent: {
      has_category_choices: data.extraction.consent.granular_controls,
      reject_non_essential: rejectVal,
      cmp_name: data.extraction.consent.cmp_name
    },
    third_parties: {
      count: (data.extraction.third_parties_evidence === 'none') ? null as any : data.extraction.third_parties.count,
      top_domains: (data.extraction.third_parties.top_domains || []).slice(0, 3)
    },
    third_parties_evidence: data.extraction.third_parties_evidence || undefined,
    metrics: data.metrics || undefined,
    policy_urls: (data.policy?.urls || []).slice(0, 3),
    readability_hint: data.readability_hint || 'moderate'
  };
}

function applyRemote(remote: any) {
  // Update verdict + bullets + advice if remote returns them
  if (!remote) return;
  const level = remote.verdict === 'LIKELY_OK' ? 'LIKELY_OK' : remote.verdict === 'CAUTION' ? 'CAUTION' : 'AVOID';
  verdictEl.textContent = level === 'LIKELY_OK' ? 'Likely OK' : level === 'CAUTION' ? 'Proceed with caution' : 'High risk';
  verdictEl.className = 'pill small ' + (level === 'LIKELY_OK' ? 'ok' : level === 'CAUTION' ? 'warn' : 'bad');

  tldrEl.innerHTML = '';
  (remote.bullets || []).slice(0,3).forEach((b: string) => {
    const li = document.createElement('li');
    li.textContent = b;
    tldrEl.appendChild(li);
  });
  adviceEl.textContent = remote.advice ? ('Advice: ' + remote.advice) : '';
  if (typeof remote.clarity === 'number' && clarityEl) clarityEl.textContent = String(remote.clarity);
  if (typeof remote.safety === 'number' && safetyEl) safetyEl.textContent = String(remote.safety);
  if (reasonsEl) {
    reasonsEl.innerHTML = '';
    const list: string[] = [];
    if (remote?.reasons?.clarity) list.push(...remote.reasons.clarity);
    if (remote?.reasons?.safety) list.push(...remote.reasons.safety);
    list.slice(0, 8).forEach(r => { const li = document.createElement('li'); li.textContent = r; reasonsEl.appendChild(li); });
  }
}
