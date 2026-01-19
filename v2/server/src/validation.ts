import { z } from 'zod';

export const ThirdPartyBandsSchema = z.object({
  few: z.number(),
  some: z.number(),
  many: z.number()
});

export const BaselinesSchema = z.object({
  ads_p75_days: z.number(),
  analytics_p75_days: z.number(),
  third_party_bands: ThirdPartyBandsSchema
});

export const MetricsSchema = z.object({
  ads_p75: z.number().nullable(),
  analytics_p75: z.number().nullable(),
  third_parties_count: z.number().nullable(),
  very_long_count: z.number()
});

export const EvidenceSchema = z.object({
  durations_evidence: z.enum(['cookie_table','none']),
  third_parties_evidence: z.enum(['cookie_table','policy_text','none'])
});

export const ConsentSchema = z.object({
  has_category_choices: z.boolean(),
  reject_non_essential: z.enum(['yes','no','unclear'])
});

export const DisclosuresSchema = z.object({
  rights_listed: z.boolean(),
  contact_present: z.boolean(),
  pd_retention_present: z.boolean(),
  last_updated_present: z.boolean()
});

export const DeterministicSchema = z.object({
  clarity: z.number().min(0).max(100),
  safety: z.number().min(0).max(100),
  verdict: z.enum(['LIKELY_OK','CAUTION','HIGH_RISK'])
});

export const SummarizeRequestSchema = z.object({
  siteType: z.enum(['retail','news','saas','finance_health','gov_ngo']),
  baselines: BaselinesSchema,
  metrics: MetricsSchema,
  evidence: EvidenceSchema,
  consent: ConsentSchema,
  disclosures: DisclosuresSchema,
  deterministic: DeterministicSchema,
  top_domains: z.array(z.string()).max(3).optional()
});

export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;

const ChipsSchema = z.object({
  retention: z.enum(['shorter','typical','longer']),
  partners: z.enum(['few','some','many']),
  controls: z.enum(['clear','unclear','poor'])
});

const ActionSchema = z.object({
  label: z.string(),
  type: z.enum(['open_cmp','browser_setting','learn_more']),
  url: z.string().url().optional()
});

export const SummarizeResponseSchema = z.object({
  headline: z.string(),
  chips: ChipsSchema,
  bullets: z.array(z.string()).length(3),
  advice: z.string(),
  confidence: z.enum(['high','medium','low']),
  actions: z.array(ActionSchema).optional()
});

export type SummarizeResponse = z.infer<typeof SummarizeResponseSchema>;
