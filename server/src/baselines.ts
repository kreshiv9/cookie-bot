// server/src/baselines.ts
export type Bands = { few: number; some: number; many: number };
export type Baseline = {
  ads_p75_days: number;
  analytics_p75_days: number;
  third_party_bands: Bands;
  notes?: string;
};

const DEFAULT_BASELINES: Record<string, Baseline> = {
  retail: {
    ads_p75_days: 180,
    analytics_p75_days: 365,
    third_party_bands: { few: 5, some: 19, many: 49 },
    notes: "Retail often uses many partners; ads 90–400d; analytics ~1y."
  },
  news: {
    ads_p75_days: 365,
    analytics_p75_days: 365,
    third_party_bands: { few: 5, some: 19, many: 49 },
    notes: "News sites often have many partners; ads up to ~2y common."
  },
  saas: {
    ads_p75_days: 90,
    analytics_p75_days: 270,
    third_party_bands: { few: 5, some: 14, many: 29 },
    notes: "SaaS fewer partners; ads short; analytics ~9–12m."
  },
  finance_health: {
    ads_p75_days: 60,
    analytics_p75_days: 180,
    third_party_bands: { few: 3, some: 8, many: 14 },
    notes: "Regulated: minimal partners; shorter durations."
  },
  gov_ngo: {
    ads_p75_days: 30,
    analytics_p75_days: 120,
    third_party_bands: { few: 3, some: 8, many: 14 },
    notes: "Gov rarely uses ads; limited analytics."
  }
};

export function getBaselinesFor(
  siteType: string | null | undefined
): Baseline {
  const key = (siteType || "retail").toLowerCase();
  return DEFAULT_BASELINES[key] ?? DEFAULT_BASELINES["retail"];
}