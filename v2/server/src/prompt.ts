import type { SummarizeRequest } from './validation';

export function buildSystemPrompt() {
  return (
    'You are a privacy/compliance writing assistant. Respond with a JSON object only.\n' +
    '- Use ONLY the provided numbers and bands; do not invent values.\n' +
    '- If evidence is none, say "not disclosed".\n' +
    '- Use p75 only (no maxima or "up to" phrasing).\n' +
    '- Exactly 3 concise bullets and 1 advice line.\n' +
    '- Use the phrasing "other companies’ cookies" when referencing third-parties.\n' +
    '- Keep a neutral, clear tone. No fear language.'
  );
}

export function buildUserContent(req: SummarizeRequest) {
  const { baselines, metrics, evidence, consent, disclosures, deterministic, top_domains } = req;
  return (
    `Baselines: ads_p75_days=${baselines.ads_p75_days}, analytics_p75_days=${baselines.analytics_p75_days}, ` +
    `third_party_bands={few:${baselines.third_party_bands.few},some:${baselines.third_party_bands.some},many:${baselines.third_party_bands.many}}\n` +
    `Metrics: ads_p75=${metrics.ads_p75 ?? 'null'}, analytics_p75=${metrics.analytics_p75 ?? 'null'}, ` +
    `third_parties_count=${metrics.third_parties_count ?? 'null'}, very_long_count=${metrics.very_long_count}\n` +
    `Evidence: durations=${evidence.durations_evidence}, third_parties=${evidence.third_parties_evidence}\n` +
    `Consent: has_category_choices=${consent.has_category_choices}, reject_non_essential=${consent.reject_non_essential}\n` +
    `Disclosures: rights=${disclosures.rights_listed}, contact=${disclosures.contact_present}, retention=${disclosures.pd_retention_present}, last_updated=${disclosures.last_updated_present}\n` +
    `Deterministic: clarity=${deterministic.clarity}, safety=${deterministic.safety}, verdict=${deterministic.verdict}\n` +
    (top_domains && top_domains.length ? `Top other companies by cookies: ${top_domains.join(', ')}\n` : '') +
    '\nReturn a JSON object: { "bullets": [b1,b2,b3], "advice": line }.\n' +
    'Do not add extra keys.'
  );
}

