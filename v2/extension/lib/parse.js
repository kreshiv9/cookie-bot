// Lightweight parse + metrics helpers. Pure and deterministic.

const MULTI_TLDS = [
  'co.uk','ac.uk','gov.uk','org.uk',
  'com.au','net.au','org.au',
  'co.in','com.br','com.tr','com.mx',
];

export function getETLDPlusOne(hostname) {
  const parts = (hostname || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.') || hostname;
  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  if (MULTI_TLDS.includes(lastTwo)) return lastThree;
  return lastTwo;
}

export function extractDomain(text) {
  if (!text) return null;
  const m = String(text).match(/[a-z0-9][a-z0-9-]*\.[a-z]{2,}(?:\.[a-z]{2,})?/i);
  return m ? m[0].toLowerCase() : null;
}

export function durationToDays(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (s === 'session' || s === 'browser session') return 0;
  const unitMap = { d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7, m: 30, mo: 30, month: 30, months: 30, y: 365, yr: 365, year: 365, years: 365 };
  // Patterns: 365d, 12 months, 2 years, 30, etc.
  const compact = s.match(/(\d+(?:\.\d+)?)(\s*[dwmyyr]*)/);
  if (compact) {
    const val = parseFloat(compact[1]);
    const unitRaw = (compact[2] || '').trim();
    const unit = unitRaw || 'days';
    const mult = unitMap[unit] ?? unitMap[unit.replace(/s$/, '')] ?? 1;
    return Math.round(val * mult);
  }
  // Fallback for phrases like "about 2 years"
  const num = s.match(/(\d+(?:\.\d+)?)/);
  if (num) {
    const val = parseFloat(num[1]);
    if (s.includes('year')) return Math.round(val * 365);
    if (s.includes('month')) return Math.round(val * 30);
    if (s.includes('week')) return Math.round(val * 7);
    return Math.round(val);
  }
  return null;
}

export function percentile(values, p = 0.75) {
  const arr = (values || []).filter(v => typeof v === 'number' && !isNaN(v)).sort((a,b)=>a-b);
  if (arr.length === 0) return null;
  const idx = Math.floor((arr.length - 1) * p);
  return arr[idx];
}

export function classifyRow(row) {
  const s = `${row.name || ''} ${row.provider || ''} ${row.category || ''}`.toLowerCase();
  const isAds = /(ads|adserver|doubleclick|criteo|bingads|facebook|pixel|fbp|fbc|gclid|msclkid|taboola|outbrain|quantcast)/.test(s);
  const isAnalytics = /(analytics|ga\b|gtm|amplitude|mixpanel|segment|hotjar|matomo|plausible)/.test(s);
  if (isAds) return 'ads';
  if (isAnalytics) return 'analytics';
  return 'other';
}

export function computeMetricsFromScrape({ cookieRows = [], siteDomain }) {
  const ads = [];
  const analytics = [];
  const veryLongLimit = 730; // > 2 years
  let very_long_count = 0;
  const providerDomains = new Set();
  const thirdPartyDomains = new Set();

  for (const r of cookieRows) {
    const days = durationToDays(r.expiryText);
    if (days != null && days > veryLongLimit) very_long_count++;
    const kind = classifyRow(r);
    if (kind === 'ads' && days != null) ads.push(days);
    if (kind === 'analytics' && days != null) analytics.push(days);

    const pdom = extractDomain(r.provider) || extractDomain(r.domain || r.provider || '') || null;
    const etld1 = pdom ? getETLDPlusOne(pdom) : null;
    if (etld1) providerDomains.add(etld1);
    if (etld1 && siteDomain && !etld1.endsWith(siteDomain)) {
      thirdPartyDomains.add(etld1);
    }
  }

  const ads_p75 = percentile(ads, 0.75);
  const analytics_p75 = percentile(analytics, 0.75);
  const third_parties_count = thirdPartyDomains.size || null;

  return {
    metrics: { ads_p75, analytics_p75, third_parties_count, very_long_count },
    domains: {
      unique_provider_domains: Array.from(providerDomains),
      third_party_domains: Array.from(thirdPartyDomains)
    }
  };
}

export function readabilityScore(text) {
  if (!text) return 0;
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return 0;
  const sentences = s.split(/[.!?]+\s/).filter(Boolean);
  const words = s.split(/\s+/).filter(Boolean);
  const avgSentenceLen = sentences.length ? words.length / sentences.length : words.length;
  const avgWordLen = words.length ? words.join('').length / words.length : 0;
  // Heuristic: Start at 100, subtract penalties for longer sentences/words.
  let score = 100;
  score -= Math.min(60, Math.max(0, (avgSentenceLen - 15) * 2));
  score -= Math.min(30, Math.max(0, (avgWordLen - 5) * 10));
  return Math.max(0, Math.min(100, Math.round(score)));
}

