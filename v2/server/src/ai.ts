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
    // Basic shape check will be completed after sanitization
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid AI shape');
    }
    const sanitized = sanitizeResponse(req, parsed as any);
    return { response: sanitized, source: 'ai', model };
  } catch (e) {
    return { response: fallbackSummary(req), source: 'fallback' };
  }
}

function fallbackSummary(req: SummarizeRequest): SummarizeResponse {
  const { baselines, metrics, evidence, disclosures, consent } = req;
  const bullets: string[] = [deterministicBullet1(req), deterministicBullet2(req), deterministicBullet3(req)];
  const chips = computeChips(req);
  const advice = deterministicAdvice(req);
  const confidence = computeConfidence(req);
  const headline = buildHeadline(req, chips);
  const actions = buildActions(req);
  return { headline, chips, bullets, advice, confidence, actions };
}

function sanitizeResponse(req: SummarizeRequest, ai: any): SummarizeResponse {
  // Compute deterministic structure
  const chips = computeChips(req);
  const headline = typeof ai.headline === 'string' && ai.headline.trim().length
    ? ai.headline.trim()
    : buildHeadline(req, chips);
  const b1 = deterministicBullet1(req);
  const b2 = deterministicBullet2(req);
  let b3: string;
  if (ai && ai.bullets && Array.isArray(ai.bullets) && typeof ai.bullets[2] === 'string') {
    b3 = String(ai.bullets[2]).replace(/third-?party cookies/ig, 'other companies’ cookies')
      .replace(/\b(up to|max(?:imum)?)\b/ig, '').replace(/\s{2,}/g, ' ').trim();
  } else {
    b3 = deterministicBullet3(req);
  }
  const advice = typeof ai.advice === 'string' && ai.advice.trim().length
    ? ai.advice.replace(/third-?party cookies/ig, 'other companies’ cookies').trim()
    : deterministicAdvice(req);
  const confidence = computeConfidence(req);
  const actions = buildActions(req);
  return { headline, chips, bullets: [b1, b2, b3], advice, confidence, actions };
}

function deterministicBullet1(req: SummarizeRequest): string {
  const { baselines, metrics, evidence } = req;
  if (evidence.durations_evidence !== 'cookie_table') return 'Cookie lifespans not disclosed in tables.';
  const parts: string[] = [];
  if (typeof metrics.ads_p75 === 'number') {
    const label = labelVsBaseline(metrics.ads_p75, baselines.ads_p75_days);
    parts.push(`ads p75 ~ ${metrics.ads_p75}d (typical ${baselines.ads_p75_days}d) — ${label}`);
  }
  if (typeof metrics.analytics_p75 === 'number') {
    const label = labelVsBaseline(metrics.analytics_p75, baselines.analytics_p75_days);
    parts.push(`analytics p75 ~ ${metrics.analytics_p75}d (typical ${baselines.analytics_p75_days}d) — ${label}`);
  }
  return parts.length ? `Cookie durations: ${parts.join('; ')}.` : 'Cookie lifespans listed, but no p75 derived!';
}

function deterministicBullet2(req: SummarizeRequest): string {
  const { baselines, metrics } = req;
  const bands = baselines.third_party_bands;
  if (typeof metrics.third_parties_count !== 'number') return 'Partners not disclosed in tables or text.';
  const band = bandForThirdParties(metrics.third_parties_count, bands);
  return `Other companies’ cookies: about ${metrics.third_parties_count} — ${band} for this category.`;
}

function deterministicBullet3(req: SummarizeRequest): string {
  const { disclosures, consent } = req;
  const parts: string[] = [];
  parts.push(consent.has_category_choices ? 'category choices present' : 'category choices missing');
  parts.push(consent.reject_non_essential === 'yes' ? 'reject non‑essential available' : (consent.reject_non_essential === 'no' ? 'reject non‑essential not offered' : 'reject non‑essential unclear'));
  const d: string[] = [];
  if (disclosures.rights_listed) d.push('rights');
  if (disclosures.contact_present) d.push('contact');
  if (disclosures.pd_retention_present) d.push('retention');
  if (disclosures.last_updated_present) d.push('last updated');
  const disc = d.length ? `disclosures: ${d.join(', ')}` : 'disclosures missing';
  return `Consent/Disclosures: ${parts.join('; ')}; ${disc}.`;
}

function labelVsBaseline(value: number, baseline: number): 'shorter than typical'|'in line with typical'|'longer than typical' {
  const ratio = baseline > 0 ? value / baseline : 1;
  if (ratio < 0.75) return 'shorter than typical';
  if (ratio > 1.25) return 'longer than typical';
  return 'in line with typical';
}

function bandForThirdParties(count: number, bands: { few: number; some: number; many: number }): 'few'|'some'|'many' {
  if (count <= bands.few) return 'few';
  if (count <= bands.some) return 'some';
  return 'many';
}

function computeChips(req: SummarizeRequest) {
  const { baselines, metrics, consent } = req;
  // Retention chip: worst-of labels across categories (ads, analytics)
  const labels: Array<'shorter'|'typical'|'longer'> = [];
  if (typeof metrics.ads_p75 === 'number') labels.push(mapLabel(labelVsBaseline(metrics.ads_p75, baselines.ads_p75_days)));
  if (typeof metrics.analytics_p75 === 'number') labels.push(mapLabel(labelVsBaseline(metrics.analytics_p75, baselines.analytics_p75_days)));
  const retention = pickWorst(labels) || 'typical';
  const partners = bandForThirdParties(typeof metrics.third_parties_count === 'number' ? metrics.third_parties_count : Number.MAX_SAFE_INTEGER, baselines.third_party_bands);
  const controls: 'clear'|'unclear'|'poor' = consent.has_category_choices && consent.reject_non_essential === 'yes' ? 'clear'
    : (consent.has_category_choices || consent.reject_non_essential === 'unclear') ? 'unclear' : 'poor';
  return { retention, partners, controls };
}

function mapLabel(x: 'shorter than typical'|'in line with typical'|'longer than typical'): 'shorter'|'typical'|'longer' {
  if (x === 'longer than typical') return 'longer';
  if (x === 'shorter than typical') return 'shorter';
  return 'typical';
}

function pickWorst(labels: Array<'shorter'|'typical'|'longer'>): 'shorter'|'typical'|'longer'|null {
  if (!labels.length) return null;
  if (labels.includes('longer')) return 'longer';
  if (labels.includes('typical')) return 'typical';
  return 'shorter';
}

function computeConfidence(req: SummarizeRequest): 'high'|'medium'|'low' {
  const { evidence } = req;
  const hasDur = evidence.durations_evidence === 'cookie_table';
  const hasPartners = evidence.third_parties_evidence !== 'none';
  if (hasDur && hasPartners) return 'high';
  if (hasDur || hasPartners) return 'medium';
  return 'low';
}

function buildHeadline(req: SummarizeRequest, chips: { retention: string; partners: string; controls: string }) {
  const verdict = req.deterministic.verdict === 'LIKELY_OK' ? 'Likely OK' : (req.deterministic.verdict === 'CAUTION' ? 'Caution' : 'High Risk');
  const site = req.siteType.replace('_','/');
  return `${verdict} for ${site}: ${chips.partners} partners, ${chips.controls} controls`;
}

function deterministicAdvice(req: SummarizeRequest): string {
  const { consent } = req;
  if (consent.has_category_choices && consent.reject_non_essential === 'yes') {
    return 'Use cookie settings to limit categories or reject non‑essential cookies.';
  }
  if (consent.has_category_choices) {
    return 'Open cookie settings and look for a “reject non‑essential” option or per‑category toggles.';
  }
  return 'If cookie settings are unclear, consider limiting third‑party cookies in your browser.';
}

function buildActions(req: SummarizeRequest) {
  const actions: Array<{ label: string; type: 'open_cmp'|'browser_setting'|'learn_more'; url?: string }> = [];
  if (req.consent.has_category_choices) actions.push({ label: 'Open cookie settings', type: 'open_cmp' });
  actions.push({ label: 'Manage browser cookie settings', type: 'browser_setting' });
  actions.push({ label: 'Learn about managing cookies (Chrome)', type: 'learn_more', url: 'https://support.google.com/chrome/answer/95647' });
  return actions;
}
