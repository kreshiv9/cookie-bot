import Groq from 'groq-sdk';
import type { SummarizeRequest, SummarizeResponse } from './validation';
import { buildSystemPrompt, buildUserContent } from './prompt';

export type SummarizeResult = { response: SummarizeResponse; source: 'ai' | 'fallback'; model?: string };

export async function summarize(req: SummarizeRequest): Promise<SummarizeResult> {
  const apiKey = process.env.GROQ_API_KEY || '';
  const system = buildSystemPrompt();
  const user = buildUserContent(req);
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

  if (!apiKey) {
    return { response: fallbackSummary(req), source: 'fallback' };
  }

  try {
    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    });
    const content = completion.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.bullets) || parsed.bullets.length !== 3 || typeof parsed.advice !== 'string') {
      throw new Error('Invalid AI shape');
    }
    return { response: parsed as SummarizeResponse, source: 'ai', model };
  } catch (e) {
    return { response: fallbackSummary(req), source: 'fallback' };
  }
}

function fallbackSummary(req: SummarizeRequest): SummarizeResponse {
  const { baselines, metrics, evidence, disclosures, consent } = req;
  const bullets: string[] = [];
  if (evidence.durations_evidence === 'cookie_table') {
    const p: string[] = [];
    if (typeof metrics.ads_p75 === 'number') p.push(`ads p75 ~ ${metrics.ads_p75}d (baseline ${baselines.ads_p75_days}d)`);
    if (typeof metrics.analytics_p75 === 'number') p.push(`analytics p75 ~ ${metrics.analytics_p75}d (baseline ${baselines.analytics_p75_days}d)`);
    bullets.push(p.length ? p.join('; ') : 'Cookie lifespans listed, but no p75 derived.');
  } else {
    bullets.push('Cookie lifespans not disclosed in tables.');
  }
  bullets.push(
    typeof metrics.third_parties_count === 'number'
      ? `Uses other companies’ cookies: about ${metrics.third_parties_count}.`
      : 'Partners not disclosed in tables or text.'
  );
  const missing: string[] = [];
  if (!disclosures.rights_listed) missing.push('rights');
  if (!disclosures.contact_present) missing.push('contact');
  if (!disclosures.pd_retention_present) missing.push('retention');
  if (!disclosures.last_updated_present) missing.push('last updated');
  bullets.push(missing.length ? `Missing basics: ${missing.join(', ')}.` : 'Basics appear disclosed.');
  const advice = consent.reject_non_essential === 'yes'
    ? 'Tip: Use “reject non‑essential” and category toggles as needed.'
    : 'Tip: Look for “reject non‑essential” or per‑category toggles.';
  return { bullets, advice };
}
