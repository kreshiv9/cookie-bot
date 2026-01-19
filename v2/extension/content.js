// MV3 content script: scrapes policy links, readable text, and cookie tables.

(() => {
  const SELECTOR_HINTS = ['privacy', 'cookie', 'cookies', 'policy'];

  function absoluteUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return href || null;
    }
  }

  function findPolicyLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const links = anchors
      .filter(a => {
        const t = (a.textContent || '').trim().toLowerCase();
        const h = (a.getAttribute('href') || '').toLowerCase();
        return SELECTOR_HINTS.some(k => t.includes(k) || h.includes(k));
      })
      .map(a => absoluteUrl(a.getAttribute('href')))
      .filter(Boolean);
    return Array.from(new Set(links)).slice(0, 10);
  }

  function readableText() {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const s = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (s.length >= 20) parts.push(s);
      if (parts.join(' ').length > 10000) break; // cap
    }
    return parts.join(' ');
  }

  function parseCookieTables() {
    const tables = Array.from(document.querySelectorAll('table'));
    const rows = [];
    for (const table of tables) {
      const ths = Array.from(table.querySelectorAll('thead th, tr th'));
      const headers = ths.map(th => (th.textContent || '').toLowerCase().trim());
      if (!headers.length) continue;
      const idx = {
        name: headers.findIndex(h => /cookie|name/.test(h)),
        provider: headers.findIndex(h => /provider|domain|host/.test(h)),
        expiry: headers.findIndex(h => /expiry|expires|duration|lifespan/.test(h)),
        category: headers.findIndex(h => /category|type|purpose/.test(h))
      };
      // Must have at least name + (provider or expiry)
      if (idx.name === -1 || (idx.provider === -1 && idx.expiry === -1)) continue;
      const trs = Array.from(table.querySelectorAll('tbody tr, tr'));
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').replace(/\s+/g, ' ').trim());
        if (!tds.length) continue;
        const name = idx.name >= 0 ? tds[idx.name] : '';
        const provider = idx.provider >= 0 ? tds[idx.provider] : '';
        const expiryText = idx.expiry >= 0 ? tds[idx.expiry] : '';
        const category = idx.category >= 0 ? tds[idx.category] : '';
        if (name || provider || expiryText) {
          rows.push({ name, provider, expiryText, category });
        }
      }
    }
    return rows.slice(0, 1000); // cap
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'cookiebot.ping') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === 'cookiebot.openSettings') {
      const clicked = tryOpenCookieSettings();
      sendResponse({ ok: clicked });
      return true;
    }
    if (msg && msg.type === 'cookiebot.scrape') {
      try {
        const result = {
          url: location.href,
          policyLinks: findPolicyLinks(),
          readableText: readableText(),
          cookieRows: parseCookieTables()
        };
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
      return true;
    }
  });

  function tryOpenCookieSettings() {
    // Heuristics: click visible elements that likely open cookie preferences.
    const selectors = [
      'button', 'a', '[role="button"]', '[class*="cookie"]', '[id*="cookie"]', '[aria-label*="cookie"]',
      '[data-testid*="cookie"]', '[data-test*="cookie"]'
    ];
    const texts = /(cookie|cookies|consent|preferences|settings|manage)/i;
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      const a = (el.getAttribute('aria-label') || '').trim();
      if ((t && texts.test(t)) || (a && texts.test(a))) {
        try {
          el.click();
          return true;
        } catch (_) {}
      }
    }
    // Try common CMP globals
    try { if (typeof window.__tcfapi === 'function') { window.__tcfapi('showUi', 2, ()=>{}); return true; } } catch(_) {}
    try { if (typeof window.didomiOnReady === 'function' && window.Didomi) { window.Didomi.preferences.show(); return true; } } catch(_) {}
    return false;
  }
})();
