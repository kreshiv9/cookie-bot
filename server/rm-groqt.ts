/*
DISABLED FILE (renamed to rm-groqt.ts)
Reason: Developer-only Groq smoke test, not needed in production.
Original path: server/groqt.ts

Preserved original content below (commented out):
------------------------------------------------
import 'dotenv/config';
import Groq from "groq-sdk";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function main() {
  const resp = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: "Say hello from Groq test" }],
  });
  console.log(resp.choices[0].message);
}
main();
*/
