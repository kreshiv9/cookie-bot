import { bandForThirdParties } from './baselines.js';

export function scoreClarity({
  disclosures, consent, lifespans_disclosed, readability
}) {
  let score = 0;
  if (disclosures.rights_listed) score += 15;
  if (disclosures.contact_present) score += 15;
  if (disclosures.pd_retention_present) score += 15;
  if (disclosures.last_updated_present) score += 10;
  if (lifespans_disclosed) score += 15;
  if (consent.has_category_choices) score += 15;
  if (consent.reject_non_essential === 'yes') score += 15;
  else if (consent.reject_non_essential === 'no') score -= 5;
  const readabilityBonus = Math.round((readability || 0) / 10); // up to +10
  score += readabilityBonus;
  return clamp(score, 0, 100);
}

export function scoreSafety({ metrics, consent }, baselines) {
  let score = 100;
  const { ads_p75_days, analytics_p75_days, third_party_bands } = baselines;
  const { ads_p75, analytics_p75, third_parties_count, very_long_count } = metrics;

  if (typeof ads_p75 === 'number') {
    const over = Math.max(0, ads_p75 - ads_p75_days);
    const pen = Math.min(25, Math.round((over / (ads_p75_days || 1)) * 25));
    score -= pen;
  }
  if (typeof analytics_p75 === 'number') {
    const over = Math.max(0, analytics_p75 - analytics_p75_days);
    const pen = Math.min(20, Math.round((over / (analytics_p75_days || 1)) * 20));
    score -= pen;
  }

  const band = bandForThirdParties(third_parties_count, third_party_bands);
  if (band === 'some') score -= 15;
  if (band === 'many') score -= 30;

  const vlong = typeof very_long_count === 'number' ? very_long_count : 0;
  score -= Math.min(30, vlong * 10);

  if (!consent.has_category_choices) score -= 10;
  if (consent.reject_non_essential === 'no') score -= 15;
  if (consent.reject_non_essential === 'unclear') score -= 5;

  return clamp(score, 0, 100);
}

export function verdict(clarity, safety) {
  if (clarity >= 70 && safety >= 70) return 'LIKELY_OK';
  if (clarity >= 40 && safety >= 40) return 'CAUTION';
  return 'HIGH_RISK';
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

