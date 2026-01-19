import type { SummarizeRequest } from './validation';

export function buildSystemPrompt() {
  return (
    'You are a privacy/compliance writing assistant. Respond with a JSON object only.\n' +
    '- Use ONLY the provided numbers and bands; do not invent values.\n' +
    '- If evidence is none, say "not disclosed".\n' +
    '- Use p75 only (never say "up to" or "maximum").\n' +
    '- Exactly 3 concise bullets and 1 advice line.\n' +
    '- Use the phrase "other companies’ cookies" (not "third-party cookies").\n' +
    '- Keep neutral, clear wording; avoid legal compliance claims.'
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
    '\nWrite a JSON object using this structure (no extra keys):\n' +
    '{\n' +
    '  "headline": "<Short title like: Caution for retail: many partners, unclear controls>",\n' +
    '  "chips": { "retention": "shorter|typical|longer", "partners": "few|some|many", "controls": "clear|unclear|poor" },\n' +
    '  "bullets": [\n' +
    '    "Cookie durations: ads p75 ~ <ads_p75>d (typical <ads_baseline>d) — <shorter than typical|in line with typical|longer than typical>; analytics p75 ~ <analytics_p75>d (typical <analytics_baseline>d) — <shorter than typical|in line with typical|longer than typical>.",\n' +
    '    "Other companies’ cookies: about <count> — <few|some|many> for this category.",\n' +
    '    "Consent/Disclosures: one sentence on category choices, reject non‑essential, rights/contact/retention/last updated."\n' +
    '  ],\n' +
    '  "advice": "A single short action line.",\n' +
    '  "confidence": "high|medium|low"\n' +
    '}\n' +
    'Forbidden phrases: "up to", "maximum", "third-party cookies", legal/compliance claims.'
  );
}
