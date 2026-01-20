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
  const attempts = [];
  const okResults = [];
  for (const url of urls) {
    let res = { url, ok: false, status: 0, reason: '', contentType: '', length: 0, hasTable: false, contentScore: 0 };
    try {
      const resp = await fetch(url, { method: 'GET', credentials: 'omit' });
      res.status = resp.status;
      res.contentType = resp.headers.get('content-type') || '';
      if (!resp.ok || !/text\/html/i.test(res.contentType)) {
        res.reason = !resp.ok ? 'http_error' : 'non_html';
        attempts.push(res);
        continue;
      }
      const html = await resp.text();
      res.hasTable = /<table/i.test(html);
      const text = extractText(html);
      res.length = text.length;
      res.contentScore = scorePolicyText(text);
      if (text && text.length > 200) {
        res.ok = true;
        okResults.push({ meta: res, text });
      } else {
        res.reason = 'too_short';
      }
      attempts.push(res);
    } catch (e) {
      res.reason = 'fetch_error';
      attempts.push(res);
    }
  }
  if (okResults.length) {
    // Choose best by contentScore, then hasTable, then length
    okResults.sort((a,b) => (b.meta.contentScore - a.meta.contentScore) || (Number(b.meta.hasTable) - Number(a.meta.hasTable)) || (b.meta.length - a.meta.length));
    const best = okResults[0];
    return { ok: true, url: best.meta.url, text: truncate(best.text, 50000), length: best.meta.length, contentType: best.meta.contentType, attempts };
  }
  return { ok: false, error: 'no_html', attempts };
}

function scorePolicyText(text) {
  const t = (text || '').toLowerCase();
  let s = 0;
  if (/cookie\s+policy|cookies/.test(t)) s += 40;
  if (/privacy\s+policy/.test(t)) s += 25;
  if (/your\s+rights|data\s+subject|access\s+request/.test(t)) s += 10;
  if (/retention|how\s+long\s+we\s+keep|storage\s+period/.test(t)) s += 10;
  if (/do\s+not\s+sell|do\s+not\s+share|your\s+privacy\s+choices/.test(t)) s += 10;
  if (/cookie\s+name|provider|expiry|duration|lifespan/.test(t)) s += 20; // table-like headers
  return s;
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
