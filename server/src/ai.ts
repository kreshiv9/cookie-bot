import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

export async function aiSummarize(input: any): Promise<{
  bullets: string[]; advice: string; optional_adjustments?: { clarity_delta?: number; safety_delta?: number; reasons?: string[] }
}> {
  const sys = `You are an assistant that writes a friendly TL;DR about privacy & cookies. 
Return valid JSON: { "bullets": string[], "advice": string, "optional_adjustments": { "clarity_delta"?: number, "safety_delta"?: number, "reasons"?: string[] } }.
Keep bullets plain and compare to typical norms (short/typical/long). Avoid jargon.`;

  const user = JSON.stringify(input);

  const resp = await groq.chat.completions.create({
    model: "llama-3.1-8b-instruct",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  });

  const txt = resp.choices[0]?.message?.content ?? "{}";
  return JSON.parse(txt);
}