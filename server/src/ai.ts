import Groq from "groq-sdk";
import { AiOutputFinalSchema, type AiOutputFinal } from './validation';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export async function aiSummarizeFinal(input: any): Promise<AiOutputFinal> {
  const sys = [
    'You produce a concise, helpful quick safety check for privacy/cookie practices.',
    'Input includes: siteType, baselines (ads/analytics typical p75 and partner bands), and extraction (durations arrays p75 context, third party count, consent, disclosures, readability).',
    'OUTPUT strict JSON: { "bullets": string[], "advice": string, "clarity_final": 0-100, "safety_final": 0-100, "verdict": "LIKELY_OK"|"CAUTION"|"HIGH_RISK", "reasons"?: string[] }.',
    'Rules: 2–3 bullets max, use plain language, include numbers when available, compare to typical norms (e.g., "ads ~180d (typical)", "~12 other companies\' cookies: some").',
    'Clarity (Transparency) reflects if key info is present (rights, contact, PD retention, cookie lifespans/categories, last updated, readability).',
    'Safety reflects risk based on durations vs baselines, outliers >730d, third-party count, and consent quality.',
  ].join(' ');

  const user = JSON.stringify(input);

  const resp = await groq.chat.completions.create({
    model: "llama-3.1-8b-instruct",
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
