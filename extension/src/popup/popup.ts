type AnalyzeResult = import('../types/contracts').AnalyzeResult;

const analyzeBtn = document.getElementById('analyzeBtn') as HTMLButtonElement;
const domainEl   = document.getElementById('domain') as HTMLElement;
const statusEl   = document.getElementById('status') as HTMLElement;
const linksEl    = document.getElementById('policyLinks') as HTMLElement;
const retentionEl= document.getElementById('retentionList') as HTMLUListElement;
const rcEl       = document.getElementById('rightsContact') as HTMLElement;
const cookiesEl  = document.getElementById('cookies') as HTMLElement;
const missingEl  = document.getElementById('missingList') as HTMLUListElement;

analyzeBtn?.addEventListener('click', async () => {
  statusEl.textContent = 'Analyzing…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    statusEl.textContent = 'No active tab';
    return;
  }

  domainEl.textContent = new URL(tab.url).hostname;

  const result = await chrome.runtime.sendMessage({ type: 'ANALYZE_ACTIVE_TAB' }) as AnalyzeResult | { error: string };
  if ((result as any)?.error) {
    statusEl.textContent = 'Error: ' + (result as any).error;
    return;
  }

  render(result as AnalyzeResult);
  statusEl.textContent = 'Done';
});

function render(data: AnalyzeResult) {
  // Policy links
  linksEl.innerHTML = data.policy.urls.length
    ? data.policy.urls.map(u => `<span class="badge">${escapeHtml(u)}</span>`).join(' ')
    : 'None found';

  // Retention list
  retentionEl.innerHTML = '';
  data.extraction.retention.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${escapeHtml(item.data_category || 'general')}</strong>: ${escapeHtml(item.duration_text || 'unspecified')}</div>` +
                   (item.quote ? `<div class="quote">“${escapeHtml(item.quote)}”</div>` : '');
    retentionEl.appendChild(li);
    });

  // Rights & Contact
  const rcBits: string[] = [];
  rcBits.push(data.extraction.disclosures.user_rights_listed ? 'Rights: ✅' : 'Rights: ❌');
  rcBits.push(data.extraction.disclosures.contact_or_dpo_listed ? 'Contact/DPO: ✅' : 'Contact/DPO: ❌');
  rcEl.textContent = rcBits.join(' • ');

  // Cookies snapshot summary
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
}

function escapeHtml(s: string) {
  return s.replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch] as string));
}