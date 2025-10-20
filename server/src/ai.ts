import Groq from "groq-sdk";
import { AiOutputFinalSchema, type AiOutputFinal } from './validation';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export async function aiSummarizeFinal(input: any): Promise<AiOutputFinal> {
  const sys = [
    'You generate a short, factual risk summary about privacy/cookie practices.',
    'Use ONLY the provided data: siteType, baselines (typical p75 durations and partner bands), extraction (third party count and top_domains, consent, disclosures, durations_evidence, third_parties_evidence), metrics (p75 values and outlier counts), readability. Optional: retention items (with brief quotes) and policy_urls.',
    'Output STRICT JSON with EXACT KEYS: { "bullets": string[3], "advice": string, "clarity_final": 0-100, "safety_final": 0-100, "verdict": "LIKELY_OK"|"CAUTION"|"HIGH_RISK" }.',
    'Bullets: EXACTLY 3 lines, plain text (no emojis or symbols). Keep each to one clause. Include numbers when available.',
    'Bullet 1: State how long cookies are held using p75 (ads and/or analytics), and whether that is normal for the industry using baselines if provided. If p75 is null/absent or durations_evidence is "none", say lifespans are not disclosed. If baselines are not set, clearly say typical is not provided. Do NOT cite single maximum durations and do NOT use "up to" phrasing.',
    'Bullet 2: Summarize third parties and consent control (e.g., many/few trackers, reject-all availability, category choices). If third_parties_evidence is "none", say partners not disclosed instead of assuming zero. Point out red flags (no reject, no choices).',
    'Bullet 3: Mention missing important information (e.g., no retention info, no rights/contact). If extreme lifetimes/outliers (>730 days) are present, note "very long outliers" without specific max-day numbers.',
    'Advice: one concise sentence, actionable (e.g., allow only essential cookies; avoid "Accept All"). Max ~180 characters.',
    'Clarity_final: reflect disclosures quality (rights/contact/retention/cookie info/last updated/readability). Reduce clarity when lifespans or partners are not disclosed (evidence "none").',
    'Safety_final: reflect risk from durations vs baselines (if present), very-long outliers, many third parties, poor consent. If lifespans are unknown, do not treat as short/safe; remain neutral on safety from durations.',
    'Do not invent data. If unknown or not found, say so briefly.',
  ].join(' ');

  const user = JSON.stringify(input);

  const resp = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  });

  const txt = resp.choices[0]?.message?.content ?? '{}';
  const parsed = AiOutputFinalSchema.safeParse(JSON.parse(txt));
  if (!parsed.success) {
    throw new Error('AI output validation failed');
  }
  // Clamp for safety
  const out = parsed.data;
  return {
    ...out,
    clarity_final: clamp01(out.clarity_final),
    safety_final: clamp01(out.safety_final)
  };
}

function clamp01(n: number) { return Math.max(0, Math.min(100, n)); }
