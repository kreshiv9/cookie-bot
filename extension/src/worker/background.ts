import { buildAnalyzeResult, discoverPolicyUrlsOnPage, fetchAndNormalizePolicies } from './pipeline.js';

function tabsQuery(q: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise(res => chrome.tabs.query(q, res));
}
function cookiesGetAll(details: chrome.cookies.GetAllDetails): Promise<chrome.cookies.Cookie[]> {
  return new Promise(res => chrome.cookies.getAll(details, res));
}

chrome.runtime.onMessage.addListener(
  (msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (res: any) => void) => {
    (async () => {
      if (msg?.type === 'ANALYZE_ACTIVE_TAB') {
        try {
          const [tab] = await tabsQuery({ active: true, currentWindow: true });
          if (!tab?.id || !tab.url) return sendResponse({ error: 'No active tab' });

          const pre = await cookiesGetAll({ url: tab.url });

          let urls = await discoverPolicyUrlsOnPage(tab.id);
          if (!urls || urls.length === 0) urls = [tab.url];

          const policy = await fetchAndNormalizePolicies(urls);

          const result = await buildAnalyzeResult(tab.url, pre, policy);

          sendResponse(result);
        } catch (e: any) {
          sendResponse({ error: String(e?.message || e) });
        }
        return true;
      }
    })();
    return true;
  }
);
