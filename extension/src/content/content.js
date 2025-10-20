// Classic content script: discovers policy links, rendered text, and cookie table rows

function discoverLinks() {
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const hits = [];
  const re = /(privacy|cookie|cookies|policy)/i;
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const label = (a.textContent || '').trim();
    if (re.test(href) || re.test(label)) {
      try {
        const url = new URL(href, window.location.href).toString();
        hits.push(url);
      } catch {}
    }
  }
  // Include current page if it looks like a policy page
  try {
    if (re.test(window.location.pathname) || re.test(document.title || '')) {
      hits.push(window.location.href);
    }
  } catch {}
  return Array.from(new Set(hits));
}

function getPageText() {
  const SEP = ' | ';
  const clone = document.body ? document.body.cloneNode(true) : null;
  if (!clone) return document.body ? document.body.innerText || '' : '';
  clone.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
  clone.querySelectorAll('td,th').forEach(cell => {
    if (cell && cell.textContent) cell.textContent = cell.textContent.trim() + SEP;
  });
  const text = (clone.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function approxSiteRoot(hostname) {
  try {
    const parts = hostname.toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return hostname.toLowerCase();
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (prev.length <= 3) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  } catch { return hostname.toLowerCase(); }
}

function extractDomain(str) {
  if (!str) return null;
  const m = String(str).match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

const WORD_NUM = {
  'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
  'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
  'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90
};

function parseNumberToken(tok) {
  if (!tok) return null;
  tok = tok.toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(tok)) return parseFloat(tok);
  return WORD_NUM[tok] ?? null;
}

function durationToDays(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  if (/session/.test(s)) return 0;
  // numeric first
  let m = s.match(/(\d+(?:\.\d+)?)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)/i);
  if (!m) {
    // word-based numbers
    m = s.match(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)/i);
    if (!m) return null;
  }
  const n = parseNumberToken(m[1]);
  const unit = m[2].toLowerCase();
  if (n == null) return null;
  const factor = /minute/.test(unit) ? (1/1440)
    : /hour/.test(unit) ? (1/24)
    : /day/.test(unit) ? 1
    : /week/.test(unit) ? 7
    : /month/.test(unit) ? 30
    : 365;
  const days = n * factor;
  return Math.max(0, Math.round(days));
}

// Try to parse cookie tables by headers (Name/Provider/Expiry/Category)
function getCookieTables() {
  const results = [];
  const tables = Array.from(document.querySelectorAll('table'));
  const headRe = {
    lifespan: /(lifespan|expiry|expires|expiration|duration|lifetime|validity|retention)/i,
    name: /(cookie\s*name|cookie|name)/i,
    category: /(type|category|purpose)/i,
    provider: /(provider|domain|host|company|party|third\s*party)/i
  };

  for (const t of tables) {
    const headers = Array.from(t.querySelectorAll('thead th, tr th'));
    const rows = Array.from(t.querySelectorAll('tbody tr')).length
      ? Array.from(t.querySelectorAll('tbody tr'))
      : Array.from(t.querySelectorAll('tr')).slice(1);

    if (!headers.length || !rows.length) continue;

    const headerTexts = headers.map(h => (h.textContent || '').trim());
    const idx = {
      lifespan: headerTexts.findIndex(h => headRe.lifespan.test(h)),
      name: headerTexts.findIndex(h => headRe.name.test(h)),
      category: headerTexts.findIndex(h => headRe.category.test(h)),
      provider: headerTexts.findIndex(h => headRe.provider.test(h))
    };
    if (idx.name === -1 && idx.lifespan === -1 && idx.provider === -1) continue; // need at least one meaningful column

    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll('td,th'));
      if (!cells.length) continue;
      const get = i => (i >= 0 && i < cells.length) ? (cells[i].innerText || '').trim() : null;
      const cookie_name = get(idx.name) || null;
      const category = get(idx.category) || null;
      const lifespan_text = get(idx.lifespan) || null;
      const provider_text = get(idx.provider) || null;
      const raw_row_text = cells.map(c => (c.innerText || '').trim()).join(' | ') || null;

      // provider domain from link or text
      let provider_domain = null;
      if (idx.provider !== -1) {
        const cell = cells[idx.provider];
        const href = cell?.querySelector('a[href]')?.getAttribute('href') || null;
        provider_domain = href ? extractDomain(href) : extractDomain(provider_text);
      }
      const siteRoot = approxSiteRoot(window.location.hostname);
      const provRoot = provider_domain ? approxSiteRoot(provider_domain) : null;
      const third_party = provRoot ? (provRoot !== siteRoot) : null;

      // duration parsing (numeric or word-based)
      let ttl_days = null;
      if (lifespan_text) ttl_days = durationToDays(lifespan_text);
      if (ttl_days == null && raw_row_text) ttl_days = durationToDays(raw_row_text);
      const ttl_source = ttl_days != null ? 'table' : null;

      results.push({
        cookie_name,
        category,
        lifespan_text,
        ttl_days,
        ttl_source,
        provider_text,
        provider_domain,
        third_party,
        third_party_source: provider_domain ? 'table' : null,
        raw_row_text
      });
    }
  }
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'DISCOVER_POLICY_LINKS') {
    try { sendResponse(discoverLinks()); } catch { sendResponse([]); }
    return true;
  }
  if (msg && msg.type === 'GET_PAGE_TEXT') {
    try { sendResponse(getPageText()); } catch { sendResponse(''); }
    return true;
  }
  if (msg && msg.type === 'GET_COOKIE_TABLES') {
    try { sendResponse(getCookieTables()); } catch { sendResponse([]); }
    return true;
  }
});
