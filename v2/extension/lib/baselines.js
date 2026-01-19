// Default baselines per site type. These are pragmatic starting points and can be tuned later.

export const DEFAULT_SITE_TYPE = 'retail';

export function baselinesForSite(siteType = DEFAULT_SITE_TYPE) {
  const table = {
    retail: {
      ads_p75_days: 365, // 1 year typical for ad cookies
      analytics_p75_days: 730, // _ga is commonly 2 years
      third_party_bands: { few: 3, some: 9, many: 10 }
    },
    news: {
      ads_p75_days: 365,
      analytics_p75_days: 730,
      third_party_bands: { few: 5, some: 12, many: 13 }
    },
    saas: {
      ads_p75_days: 180,
      analytics_p75_days: 365,
      third_party_bands: { few: 2, some: 5, many: 6 }
    },
    finance_health: {
      ads_p75_days: 90,
      analytics_p75_days: 365,
      third_party_bands: { few: 1, some: 3, many: 4 }
    },
    gov_ngo: {
      ads_p75_days: 0,
      analytics_p75_days: 180,
      third_party_bands: { few: 0, some: 1, many: 2 }
    }
  };
  return table[siteType] || table[DEFAULT_SITE_TYPE];
}

export function bandForThirdParties(count, bands) {
  if (count == null) return 'unknown';
  if (count <= bands.few) return 'few';
  if (count <= bands.some) return 'some';
  return 'many';
}

