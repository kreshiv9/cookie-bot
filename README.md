# Cookie / Policy Analyzer

![screenshot](cookie-bot.jpeg)

**AI-powered Chrome extension for a quick, clear safety check.**  
Reads long cookie/privacy policies, extracts key details, and points out potential risks in plain English.

---

## How It Works
1. **DOM Scraping** — finds policy pages and parses cookie tables  
2. **Regex Extraction** — pulls durations, providers, partners, and key disclosures  
3. **Groq AI Analysis** — summarizes risks into a crisp verdict + 3 bullets

---

## Features
- Instant “is this safe?” verdict  
- Detects long-lived cookies & third-party trackers  
- Notes missing disclosures and weak consent options  
- Clean popup UI with a simple, actionable summary

---

## Tech
- **Extension:** TypeScript, DOM scraping, regex heuristics  
- **Backend:** Node.js (Express)  
- **AI:** Groq LLaMA-3.1 (8B Instant)

