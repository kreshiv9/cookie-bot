# Product Requirements Document (PRD) — Policy Analyzer Beta

## 1. Problem
Privacy and cookie policies are long and confusing.  
Users cannot quickly tell:
- how long data is retained,
- what rights they have,
- whether the practices are safe.

## 2. Solution
A Chrome extension that:
- Scrapes privacy/cookie policies automatically,
- Extracts key facts (retention, rights, contact, consent, cookie lifespans),
- Scores on two axes: **Clarity** (is info disclosed) and **Safety** (are practices normal vs standards),
- Produces a simple TL;DR + advice in plain language.

## 3. Tech Stack
- **Extension**: MV3 + TypeScript
- **Backend**: Vercel serverless (Node.js/TypeScript)
- **AI**: Groq API (free, Llama 3.1 Instruct), optional Gemini Flash fallback
- **DB**: Postgres (Neon free tier) with Prisma ORM

## 4. Features
**In scope**
- DOM scraping + regex for key sections
- AI summarization and advice
- Scoring system (Clarity and Safety, both 0–100)
- Minimal modern popup UI with verdict + bullets + advice

**Out of scope (for now)**
- Auto “Reject all”
- Multi-language
- Mobile

## 5. User Flow
1. User clicks extension → “Analyze”
2. Extension scrapes policy/cookies
3. Sends extraction to backend
4. Backend computes scores → calls AI for summary/advice
5. Popup shows Clarity + Safety scores, bullets, and advice
6. User can expand “Show details” for raw data

## 6. Functional Requirements
- Extract retention periods, rights, contact, consent choices
- Detect cookie lifespans and third-party trackers
- Compute Clarity and Safety scores
- Display verdict: “Likely OK”, “Caution”, “High Risk”
- Generate 2–3 bullets and plain advice via AI

## 7. Non-Functional
- Response in under 3s
- No personal user data stored
- Backend keys secured in env variables
- Graceful fallback if AI or DB fails

## 8. Database Schema (Postgres + Prisma)
Tables:
- **sites**: id, domain, category, timestamps
- **policies**: id, siteId, url, rawTextHash, createdAt
- **extractions**: id, policyId, extractionJson, adsP75Days, analyticsP75Days, thirdPartiesCount, hasChoices, rejectNonEssential, rightsListed, contactPresent, pdRetentionPresent, lastUpdatedPresent, readabilityHint, createdAt
- **analyses**: id, siteId, policyId, clarityScoreRule, safetyScoreRule, clarityScoreFinal, safetyScoreFinal, verdict, aiProvider, aiVersion, aiOutput, createdAt
- **baselines**: id, siteCategory, adsP75Days, analyticsP75Days, thirdPartyBands (JSON), notes, updatedAt