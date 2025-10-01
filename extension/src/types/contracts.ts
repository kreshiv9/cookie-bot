// Provenance & enums
export type SourceType = 'policy_text' | 'cookie_table';
export type SameSite = 'no_restriction' | 'lax' | 'strict' | 'unspecified';
export type RiskLevel = 'LIKELY_OK' | 'CAUTION' | 'AVOID';

// Browser cookie snapshot (from chrome.cookies)
export type CookieItem = {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSite;
  expirationDate?: number;
  maxAge: number | null; // seconds until expiry (approx)
};

// Policy fetch bundle
export type PolicyBundle = { urls: string[]; text: string };

// Extracted cookie table (from DOM)
export type CookieTableRow = {
  cookie_name?: string | null;
  category?: string | null;
  lifespan_text?: string | null; // e.g., "364 Days", "Session", "A few seconds"
  raw_row_text?: string | null;  // fallback snippet
  domain_hint?: string | null;   // may appear inside row text
};

// Retention item with provenance
export type RetentionItem = {
  data_category: string;
  duration_text: string | null;
  iso_duration: string | null;
  quote: string;
  source_url: string;
  source_type: SourceType;
};

// Consent/controls + third parties
export type ConsentSignals = {
  granular_controls: boolean;                    // preferences / per-category toggles exist
  reject_all_available: boolean | 'unclear';     // explicit "reject all", or 'unclear' if CMP seen but no label found
  cmp_name: string | null;                       // OneTrust, TrustArc, Cookiebot, Quantcast, etc
};

export type ThirdPartySignals = {
  count: number;
  top_domains: string[];          // up to 3
};

// Scoring result + TLDR
export type ScoreResult = {
  level: RiskLevel;
  points: number;
  reasons: string[]; // human-readable
};

export type Summary = {
  score: ScoreResult;
  bullets: string[]; // 3 concise lines
  advice: string;    // 1–2 sentence tip
};

export type AnalyzeResult = {
  pageUrl: string;
  policy: { urls: string[]; text: string };
  cookies: { pre: CookieItem[] };
  extraction: {
    retention: RetentionItem[];
    disclosures: {
      retention_disclosed: boolean;     // any retention (cookie or PD) found
      user_rights_listed: boolean;
      contact_or_dpo_listed: boolean;
    };
    consent: ConsentSignals;
    third_parties: ThirdPartySignals;
    missing: string[];
  };
  metrics?: {
    ads_p75_days: number;           // approximated (uses max if p75 not available)
    analytics_p75_days: number;     // approximated (uses max if p75 not available)
    very_long_vendors: number;      // count of rows with >730d in ads/marketing
  };
  summary: Summary; // <- new TL;DR with score & advice
  findings: Array<{ type: string; severity: 'low'|'medium'|'high'; evidence: string }>;
};
