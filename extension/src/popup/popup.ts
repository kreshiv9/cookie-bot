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

const linksEl    = document.getElementById('policyLinks') as HTMLElement;

const retentionEl= document.getElementById('retentionList') as HTMLUListElement;
const rcEl       = document.getElementById('rightsContact') as HTMLElement;
const cookiesEl  = document.getElementById('cookies') as HTMLElement;
const missingEl  = document.getElementById('missingList') as HTMLUListElement;
const reasonsEl  = document.getElementById('reasonsList') as HTMLUListElement;

analyzeBtn?.addEventListener('click', async () => {
  statusEl.textContent = 'Analyzing…';
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
  render(local);
  if (clarityEl) clarityEl.textContent = 'calculating…';
  if (safetyEl) safetyEl.textContent = 'calculating…';

  // Try remote analysis if configured
  if (API_BASE_URL) {
    try {
      const payload = toServerPayload(local);
      const resp = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const remote = await resp.json();
        applyRemote(remote);
        statusEl.textContent = 'Done (cloud)';
        if (cloudTag) cloudTag.style.display = '';
        return;
      }
    } catch {}
  }
  statusEl.textContent = 'Done (local)';
  if (cloudTag) cloudTag.style.display = 'none';
});

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
  return {
    siteUrl: data.pageUrl,
    siteType: null,
    durations: data.extraction.durations || undefined,
    disclosures: {
      rights_listed: data.extraction.disclosures.user_rights_listed,
      contact_present: data.extraction.disclosures.contact_or_dpo_listed,
      pd_retention_present: data.extraction.disclosures.retention_disclosed,
      cookie_categories_explained: true,
      cookie_lifespans_disclosed: true,
      last_updated_present: false
    },
    consent: {
      has_category_choices: data.extraction.consent.granular_controls,
      reject_non_essential: rejectVal,
      cmp_name: data.extraction.consent.cmp_name
    },
    third_parties: { count: data.extraction.third_parties.count },
    metrics: data.metrics || undefined,
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
  adviceEl.textContent = remote.advice || '';
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
