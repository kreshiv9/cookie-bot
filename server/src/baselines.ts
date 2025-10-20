// server/src/baselines.ts

export type Bands = { few: number | null; some: number | null; many: number | null };
export type Baseline = {
  ads_p75_days: number | null;
  analytics_p75_days: number | null;
  third_party_bands: Bands;
  notes?: string;
};

// --- Baseline explanations ---
// ads_p75_days: "typical" 75th percentile cookie lifespan for advertising cookies
// analytics_p75_days: typical retention for analytics cookies
// third_party_bands: thresholds for unique 3rd-party tracker domains
//   few  = low risk
//   some = moderate risk
//   many = high risk

const DEFAULT_BASELINES: Record<string, Baseline> = {
  retail: {
    ads_p75_days: 180, // ~6 months
    analytics_p75_days: 365, // ~12 months
    third_party_bands: { few: 5, some: 15, many: 25 },
    notes: "Retail sites commonly use multiple ad/analytics vendors."
  },
  news: {
    ads_p75_days: 365, // ad-heavy industry, longer retention
    analytics_p75_days: 365,
    third_party_bands: { few: 10, some: 25, many: 40 },
    notes: "News/media rely on tracking for ads & personalization."
  },
  saas: {
    ads_p75_days: 30, // rarely persistent
    analytics_p75_days: 180,
    third_party_bands: { few: 3, some: 8, many: 12 },
    notes: "SaaS usually minimal ads but has analytics."
  },
  finance_health: {
    ads_p75_days: 0, // ads not appropriate in sensitive sectors
    analytics_p75_days: 90,
    third_party_bands: { few: 2, some: 5, many: 8 },
    notes: "Sensitive data industries should minimize tracking."
  },
  gov_ngo: {
    ads_p75_days: 0, // should not track users for ads
    analytics_p75_days: 90,
    third_party_bands: { few: 1, some: 3, many: 5 },
    notes: "High privacy expectation, few third-parties allowed."
  }
};

export function getBaselinesFor(siteType: string | null | undefined): Baseline {
  const key = (siteType || "retail").toLowerCase();
  return DEFAULT_BASELINES[key] ?? DEFAULT_BASELINES["retail"];
}

export { DEFAULT_BASELINES };