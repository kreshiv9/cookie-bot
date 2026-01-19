import { API_BASE_URL } from './config.js';
import { baselinesForSite, DEFAULT_SITE_TYPE } from './lib/baselines.js';
import { computeMetricsFromScrape, getETLDPlusOne, readabilityScore } from './lib/parse.js';
import { scoreClarity, scoreSafety, verdict } from './lib/scoring.js';

const el = sel => document.querySelector(sel);

document.addEventListener('DOMContentLoaded', () => {
  el('#cloud-badge').textContent = API_BASE_URL ? 'cloud' : 'local';
  el('#local-badge').textContent = API_BASE_URL ? 'local fallback ready' : 'local only';
  el('#analyzeBtn').addEventListener('click', onAnalyze);
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function onAnalyze() {
  const btn = el('#analyzeBtn');
  btn.disabled = true;
  setStatus('Scraping this page…');
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab?.url || !/^https?:/i.test(tab.url)) {
      throw new Error('Open a regular http(s) page and try again.');
    }
    await ensureContentScript(tab.id);
    const scrape = await requestScrape(tab.id);
    const policyText = await fetchPolicyText(scrape.policyLinks);
    const siteDomain = getETLDPlusOne(new URL(scrape.url).hostname);

    setStatus('Collecting cookies…');
    const cookies = await chrome.cookies.getAll({ domain: siteDomain });
    const topDomains = summarizeTopDomains(cookies, siteDomain).slice(0, 3);

    setStatus('Computing metrics…');
    const { metrics, domains } = computeMetricsFromScrape({ cookieRows: scrape.cookieRows, siteDomain });
    const baselines = baselinesForSite(DEFAULT_SITE_TYPE);

    const durations_evidence = scrape.cookieRows && scrape.cookieRows.length ? 'cookie_table' : 'none';
    const third_parties_evidence = domains.third_party_domains.length ? 'cookie_table' : (scrape.readableText.toLowerCase().includes('third party') ? 'policy_text' : 'none');
    const lifespans_disclosed = durations_evidence === 'cookie_table' && scrape.cookieRows.some(r => r.expiryText && r.expiryText.trim());

    const combinedText = [scrape.readableText || '', policyText || ''].join(' ').trim();
    const disclosures = detectDisclosures(combinedText);
    const consent = detectConsent(combinedText);
    const readability = readabilityScore(combinedText);
    const clarity = scoreClarity({ disclosures, consent, lifespans_disclosed, readability });
    const safety = scoreSafety({ metrics, consent }, baselines);
    const v = verdict(clarity, safety);

    const deterministic = { clarity, safety, verdict: v };
    const payload = {
      siteType: DEFAULT_SITE_TYPE,
      baselines,
      metrics,
      evidence: { durations_evidence, third_parties_evidence },
      consent,
      disclosures,
      deterministic,
      top_domains: topDomains
    };

    let bullets = null, advice = null, usedLocal = false;
    let serverSource = null;
    let aiShape = null;
    if (API_BASE_URL) {
      setStatus('Contacting summarizer…');
      try {
        const res = await fetch(`${API_BASE_URL}/api/summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          serverSource = res.headers.get('x-summarizer-source');
          const j = await res.json();
          aiShape = j;
          if (Array.isArray(j.bullets) && j.bullets.length === 3 && typeof j.advice === 'string') {
            bullets = j.bullets;
            advice = j.advice;
          }
        }
      } catch (_) {
        // ignore network errors, will fall back locally
      }
    }
    if (!bullets) {
      usedLocal = true;
      ({ bullets, advice } = localBulletsAdvice({ baselines, metrics, evidence: { durations_evidence, third_parties_evidence }, consent, disclosures }));
    }

    renderResults({ tabId: tab.id, aiShape, bullets, advice, clarity, safety, verdict: v, usedLocal, serverSource, payload, baselines, metrics, consent, disclosures });
    setStatus('Done');
  } catch (e) {
    setStatus('Error: ' + (e && e.message ? e.message : String(e)));
  } finally {
    btn.disabled = false;
  }
}

function setStatus(s) { el('#status').textContent = s; }

function requestScrape(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'cookiebot.scrape' }, (resp) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!resp || !resp.ok) return reject(new Error(resp && resp.error || 'Scrape failed'));
      resolve(resp.result);
    });
  });
}

async function ensureContentScript(tabId) {
  // Try a quick ping first
  const pingOk = await new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'cookiebot.ping' }, () => {
        // If no error and got a response, it's loaded
        if (!chrome.runtime.lastError) return resolve(true);
        resolve(false);
      });
    } catch { resolve(false); }
  });
  if (pingOk) return;
  // Inject content script into the active tab
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  // Small delay to let the script register listeners
  await new Promise(r => setTimeout(r, 50));
}

function fetchPolicyText(urls) {
  return new Promise((resolve) => {
    if (!Array.isArray(urls) || urls.length === 0) return resolve('');
    chrome.runtime.sendMessage({ type: 'cookiebot.fetchPolicyText', urls }, (resp) => {
      if (!resp || !resp.ok) return resolve('');
      resolve(resp.text || '');
    });
  });
}

function summarizeTopDomains(cookies, siteDomain) {
  const counts = new Map();
  for (const c of cookies || []) {
    const d = (c.domain || '').replace(/^\./, '').toLowerCase();
    const etld1 = getETLDPlusOne(d);
    if (!etld1 || etld1.endsWith(siteDomain)) continue;
    counts.set(etld1, (counts.get(etld1) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).map(([d]) => d);
}

function detectDisclosures(text) {
  const t = (text || '').toLowerCase();
  return {
    rights_listed: /(your rights|access|rectification|erasure|delete|objection|appeal)/.test(t),
    contact_present: /(contact\s+us|privacy@|dpo|data protection officer|contact information)/.test(t),
    pd_retention_present: /(retention|how long we keep|storage period)/.test(t),
    last_updated_present: /(last updated|effective date|effective from)/.test(t)
  };
}

function detectConsent(text) {
  const t = (text || '').toLowerCase();
  const hasChoices = /(manage cookies|cookie settings|preferences|consent|categories)/.test(t);
  const reject = /(reject non\-?essential|reject all|decline|only necessary)/.test(t) ? 'yes'
               : /(accept all|allow all)/.test(t) ? 'no'
               : 'unclear';
  return { has_category_choices: hasChoices, reject_non_essential: reject };
}

function localBulletsAdvice({ baselines, metrics, evidence, consent, disclosures }) {
  const bullets = [];
  // Lifespans
  if (evidence.durations_evidence === 'cookie_table') {
    const parts = [];
    if (typeof metrics.ads_p75 === 'number') parts.push(`ads p75 ~ ${metrics.ads_p75}d (baseline ${baselines.ads_p75_days}d)`);
    if (typeof metrics.analytics_p75 === 'number') parts.push(`analytics p75 ~ ${metrics.analytics_p75}d (baseline ${baselines.analytics_p75_days}d)`);
    bullets.push(parts.length ? parts.join('; ') : 'Cookie lifespans listed, but no p75 derived.');
  } else {
    bullets.push('Cookie lifespans not disclosed in tables.');
  }
  // Third parties
  bullets.push(
    typeof metrics.third_parties_count === 'number'
      ? `Uses other companies’ cookies: about ${metrics.third_parties_count}.`
      : 'Partners not disclosed in tables or text.'
  );
  // Consent/disclosures
  const missing = [];
  if (!disclosures.rights_listed) missing.push('rights');
  if (!disclosures.contact_present) missing.push('contact');
  if (!disclosures.pd_retention_present) missing.push('retention');
  if (!disclosures.last_updated_present) missing.push('last updated');
  bullets.push(missing.length ? `Missing basics: ${missing.join(', ')}.` : 'Basics appear disclosed.');

  const advice = consent.reject_non_essential === 'yes'
    ? 'Tip: Use “reject non‑essential” and category toggles as needed.'
    : 'Tip: Look for “reject non‑essential” or per‑category toggles.';

  return { bullets, advice };
}

function chipClass(kind, val) {
  // Map values to ok/warn/risk
  if (kind === 'retention') return val === 'shorter' ? 'ok' : (val === 'typical' ? 'ok' : 'warn');
  if (kind === 'partners') return val === 'few' ? 'ok' : (val === 'some' ? 'warn' : 'risk');
  if (kind === 'controls') return val === 'clear' ? 'ok' : (val === 'unclear' ? 'warn' : 'risk');
  return '';
}

function renderResults({ tabId, aiShape, bullets, advice, clarity, safety, verdict, usedLocal, serverSource, payload, baselines, metrics, consent, disclosures }) {
  const vb = el('#verdictBadge');
  vb.textContent = verdict.replace('_', ' ');
  vb.classList.remove('ok','warn','risk');
  if (verdict === 'LIKELY_OK') vb.classList.add('ok');
  else if (verdict === 'CAUTION') vb.classList.add('warn');
  else vb.classList.add('risk');
  el('#scores').textContent = `Clarity ${clarity}/100 · Safety ${safety}/100`;
  // Chips + headline
  const chipsEl = el('#chips');
  chipsEl.innerHTML = '';
  let headlineText = '';
  if (aiShape && aiShape.chips) {
    const entries = [
      ['retention', aiShape.chips.retention],
      ['partners', aiShape.chips.partners],
      ['controls', aiShape.chips.controls]
    ];
    for (const [k, v] of entries) {
      if (!v) continue;
      const span = document.createElement('span');
      span.className = 'chip ' + chipClass(k, v);
      span.textContent = `${k}: ${v}`;
      chipsEl.appendChild(span);
    }
    chipsEl.classList.remove('hidden');
    if (aiShape.headline) headlineText = aiShape.headline;
  } else {
    chipsEl.classList.add('hidden');
  }
  el('#headline').textContent = headlineText;
  const ul = el('#bullets');
  ul.innerHTML = '';
  bullets.forEach(b => {
    const li = document.createElement('li');
    li.textContent = b;
    ul.appendChild(li);
  });
  el('#advice').textContent = advice || '';
  el('#summary').classList.remove('hidden');
  // Actions
  const actionsEl = el('#actions');
  actionsEl.innerHTML = '';
  if (aiShape && Array.isArray(aiShape.actions)) {
    aiShape.actions.forEach(act => {
      if (act.type === 'open_cmp') {
        const btn = document.createElement('button');
        btn.textContent = act.label || 'Open cookie settings';
        btn.addEventListener('click', async () => {
          setStatus('Opening cookie settings…');
          const ok = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, { type: 'cookiebot.openSettings' }, (resp) => {
              resolve(resp && resp.ok);
            });
          });
          setStatus(ok ? 'Cookie settings opened (if detected).' : 'Could not find cookie settings on this page.');
        });
        actionsEl.appendChild(btn);
      } else if (act.type === 'browser_setting') {
        const btn = document.createElement('button');
        btn.textContent = act.label || 'Browser cookie settings';
        btn.addEventListener('click', async () => {
          try { await chrome.tabs.create({ url: 'chrome://settings/cookies' }); }
          catch (_) { await chrome.tabs.create({ url: 'https://support.google.com/chrome/answer/95647' }); }
        });
        actionsEl.appendChild(btn);
      } else if (act.type === 'learn_more' && act.url) {
        const a = document.createElement('a');
        a.href = act.url;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.textContent = act.label || 'Learn more';
        actionsEl.appendChild(a);
      }
    });
    actionsEl.classList.remove('hidden');
  } else {
    actionsEl.classList.add('hidden');
  }
  el('#details').classList.remove('hidden');
  // Friendly details
  const dc = el('#detailsContent');
  dc.innerHTML = '';
  const list = document.createElement('div');
  list.innerHTML = `
    <div><strong>Confidence:</strong> ${aiShape && aiShape.confidence ? aiShape.confidence : 'unknown'}</div>
    <div><strong>Baselines:</strong> ads ${baselines.ads_p75_days}d; analytics ${baselines.analytics_p75_days}d; bands few/some/many = ${baselines.third_party_bands.few}/${baselines.third_party_bands.some}/${baselines.third_party_bands.many}</div>
    <div><strong>Metrics:</strong> ads_p75=${metrics.ads_p75 ?? 'n/a'}d; analytics_p75=${metrics.analytics_p75 ?? 'n/a'}d; partners=${metrics.third_parties_count ?? 'n/a'}; very_long>${'730d'} count=${metrics.very_long_count}</div>
    <div><strong>Evidence:</strong> durations=${payload.evidence.durations_evidence}; partners=${payload.evidence.third_parties_evidence}</div>
    <div><strong>Consent:</strong> choices=${payload.consent.has_category_choices}; reject_non_essential=${payload.consent.reject_non_essential}</div>
    <div><strong>Disclosures:</strong> rights=${payload.disclosures.rights_listed}; contact=${payload.disclosures.contact_present}; retention=${payload.disclosures.pd_retention_present}; last_updated=${payload.disclosures.last_updated_present}</div>
  `;
  dc.appendChild(list);
  // Debug JSON
  el('#debugJson').textContent = JSON.stringify(payload, null, 2);
  let cloudLabel = 'local';
  if (API_BASE_URL) {
    if (usedLocal) cloudLabel = 'cloud (offline)';
    else if (serverSource === 'ai') cloudLabel = 'cloud (ai)';
    else if (serverSource === 'fallback') cloudLabel = 'cloud (fallback)';
    else cloudLabel = 'cloud';
  }
  el('#cloud-badge').textContent = cloudLabel;
}
