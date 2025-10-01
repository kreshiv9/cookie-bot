import Groq from "groq-sdk";
import { AiOutputFinalSchema, type AiOutputFinal } from './validation';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export async function aiSummarizeFinal(input: any): Promise<AiOutputFinal> {
  const sys = [
    'You analyze a website\'s privacy/cookie practices and output final scores + TL;DR.',
    'Return strict JSON with fields: { "bullets": string[], "advice": string,',
    '  "clarity_final": number (0-100), "safety_final": number (0-100),',
    '  "verdict": "LIKELY_OK"|"CAUTION"|"HIGH_RISK", "reasons"?: string[] }.',
    'Compare durations to baselines (short/typical/long), avoid jargon, 2–3 bullets max.'
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
