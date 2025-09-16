// Classic content script: discovers policy links and returns rendered page text

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
  
  // Robust text snapshot (tries to preserve tables & shadow roots lightly)
  function getPageText() {
    const SEP = ' | ';
    // clone body to avoid live mutations flicker
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (!clone) return document.body ? document.body.innerText || '' : '';
  
    // unwrap scripts/styles/noscript
    clone.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
  
    // add separators between table cells so durations like "364 Days" survive stripping
    clone.querySelectorAll('td,th').forEach(cell => {
      if (cell && cell.textContent) cell.textContent = cell.textContent.trim() + SEP;
    });
  
    // join text
    const text = (clone.innerText || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  
    return text;
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
  });