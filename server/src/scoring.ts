export type ClarityInputs = {
    rights_listed: boolean;
    contact_present: boolean;
    pd_retention_present: boolean;
    cookie_categories_explained: boolean;
    cookie_lifespans_disclosed: boolean;
    has_category_choices: boolean;
    reject_non_essential: 'yes'|'no'|'unclear';
    cmp_name?: string | null;
    last_updated_present: boolean;
    readability_hint: 'plain'|'moderate'|'legalese';
  };
  
  export function scoreClarity(i: ClarityInputs): number {
    let s = 0;
    s += i.rights_listed ? 15 : 0;
    s += i.contact_present ? 10 : 0;
    s += i.pd_retention_present ? 15 : 0;
    s += i.cookie_categories_explained ? 10 : 0;
    s += i.cookie_lifespans_disclosed ? 10 : 0;
    s += i.has_category_choices ? 10 : 0;
    s += i.reject_non_essential === 'yes' ? 10 : i.reject_non_essential === 'unclear' ? 5 : 0;
    s += i.cmp_name ? 5 : 0;
    s += i.last_updated_present ? 5 : 0;
    s += i.readability_hint === 'plain' ? 10 : i.readability_hint === 'moderate' ? 5 : 0;
    return Math.max(0, Math.min(100, s));
  }
  
  export type SafetyInputs = {
    site_category: 'retail'|'news'|'saas'|'finance_health'|'gov_ngo';
    ads_p75_days: number;
    analytics_p75_days: number;
    very_long_count: number;         // cookies > 730d (distinct vendors)
    third_parties_count: number;
    bands: { few: number; some: number; many: number };
    consent_penalties: { no_choices: boolean; no_reject: boolean; unclear_reject: boolean };
    sensitive_trackers: boolean;
    baseline_ads_p75: number;
    baseline_analytics_p75: number;
  };
  
  export function scoreSafety(i: SafetyInputs): number {
    let risk = 0;
  
    // Ads P75 vs baseline (max 20)
    const adsOver = i.ads_p75_days - i.baseline_ads_p75;
    if (adsOver <= 0) risk += 0;
    else if (adsOver <= 200) risk += 10;
    else risk += 20;
    if (i.ads_p75_days > 730) risk = Math.min(20, risk + 5);
  
    // Analytics P75 vs baseline (max 15)
    const anaOver = i.analytics_p75_days - i.baseline_analytics_p75;
    if (anaOver <= 0) risk += 0;
    else if (anaOver <= 200) risk += 8;
    else risk += 15;
  
    // Very long cookies vendors (max 20)
    if (i.very_long_count === 0) risk += 0;
    else if (i.very_long_count === 1) risk += 8;
    else if (i.very_long_count <= 3) risk += 15;
    else risk += 20;
  
    // Third parties count vs bands (max 20)
    const tp = i.third_parties_count;
    if (tp <= i.bands.few) risk += 0;
    else if (tp <= i.bands.some) risk += 8;
    else if (tp <= i.bands.many) risk += 15;
    else risk += 20;
  
    // Consent quality (max 15)
    if (i.consent_penalties.no_choices) risk += 10;
    if (i.consent_penalties.no_reject) risk += 5;
    if (i.consent_penalties.unclear_reject) risk += 2;
  
    // Sensitive trackers (max 10)
    if (i.sensitive_trackers) risk += 10;
  
    const safety = Math.max(0, Math.min(100, 100 - risk));
    return safety;
  }
  
  export function verdict(clarity: number, safety: number): 'LIKELY_OK'|'CAUTION'|'HIGH_RISK' {
    if (clarity >= 70 && safety >= 70) return 'LIKELY_OK';
    if (clarity >= 40 && safety >= 40) return 'CAUTION';
    return 'HIGH_RISK';
  }