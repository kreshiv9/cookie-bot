// MV3 background service worker. Fetches policy pages for text-only analysis.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'cookiebot.fetchPolicyText') {
    const urls = Array.isArray(msg.urls) ? msg.urls.slice(0, 3) : [];
    fetchFirstHtml(urls).then(res => sendResponse(res)).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // async
  }
});

async function fetchFirstHtml(urls) {
  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: 'GET', credentials: 'omit' });
      const ct = resp.headers.get('content-type') || '';
      if (!resp.ok || !/text\/html/i.test(ct)) continue;
      const html = await resp.text();
      const text = extractText(html);
      if (text && text.length > 200) {
        return { ok: true, url, text: truncate(text, 50000) };
      }
    } catch (_) {
      // try next
    }
  }
  return { ok: false, error: 'no_html' };
}

function extractText(html) {
  let s = String(html);
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function truncate(str, max) { return str.length > max ? str.slice(0, max) : str; }

