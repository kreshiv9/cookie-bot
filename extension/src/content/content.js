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

// Try to parse cookie tables by headers (Lifespan/Expiry/Duration)
function getCookieTables() {
  const results = [];
  const tables = Array.from(document.querySelectorAll('table'));
  const headRe = {
    lifespan: /(lifespan|expiry|expires|duration|lifetime)/i,
    name: /(cookie|name)/i,
    category: /(type|category|purpose)/i
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
      category: headerTexts.findIndex(h => headRe.category.test(h))
    };
    if (idx.lifespan === -1) continue; // must have a lifespan column

    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll('td,th'));
      if (!cells.length) continue;
      const get = i => (i >= 0 && i < cells.length) ? (cells[i].innerText || '').trim() : null;
      const cookie_name = get(idx.name) || null;
      const category = get(idx.category) || null;
      const lifespan_text = get(idx.lifespan) || null;
      const raw_row_text = cells.map(c => (c.innerText || '').trim()).join(' | ') || null;

      if (lifespan_text && /\d+\s*(day|week|month|year)s?/i.test(lifespan_text)) {
        results.push({ cookie_name, category, lifespan_text, raw_row_text });
      } else if (raw_row_text && /\d+\s*(day|week|month|year)s?/i.test(raw_row_text)) {
        results.push({ cookie_name, category, lifespan_text: null, raw_row_text });
      }
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