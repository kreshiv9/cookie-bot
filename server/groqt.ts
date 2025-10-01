import Groq from "groq-sdk";
"import 'dotenv/config';"

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function main() {
  const resp = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "user", content: "Say hello from Groq test" }],
  });
  console.log(resp.choices[0].message);
}
main();