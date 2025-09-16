export type CookieItem = {
    name: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: chrome.cookies.SameSiteStatus | 'no_restriction';
    expirationDate?: number;
    maxAge: number | null; // seconds until expiry (approx)
  };
  
  export type PolicyBundle = { urls: string[]; text: string };
  
  export type AnalyzeResult = {
    pageUrl: string;
    policy: { urls: string[]; text: string };
    cookies: { pre: CookieItem[] };
    extraction: {
      retention: Array<{ data_category: string; duration_text: string | null; iso_duration: string | null; quote: string }>;
      disclosures: {
        retention_disclosed: boolean;
        user_rights_listed: boolean;
        contact_or_dpo_listed: boolean;
      };
      missing: string[];
    };
    findings: Array<{ type: string; severity: 'low'|'medium'|'high'; evidence: string }>;
  };