Policy Analyzer (Cookie Analyzer)
=================================

A Chrome extension + Node.js server that reads a site’s cookie/privacy policy, parses real cookie tables (provider, cookie, expiration), and asks Groq AI for a short, plain‑English risk summary with a clear verdict and advice.

Why I built it
- Cookie popups are confusing and inconsistent.
- Policies bury details (durations, third‑party partners, controls).
- I wanted a fast, consistent “is this OK?” answer, grounded in what the site actually discloses.

What it does
- Finds cookie/privacy pages and parses <table> rows to extract:
  - provider (and domain), cookie name, expiration text → days
  - third‑party providers (by comparing provider domain vs site domain)
- Converts word durations (“One year”, “90 days”, “2 hours”, “Session”) into days.
- Computes p75 lifetimes (typical, not outliers) and compares to industry baselines.
- Detects consent signals (category controls, “Reject all”, CMP name).
- Sends a compact payload to the server; returns exactly 3 bullets + advice + scores.
- Shows only the cloud (AI) result in the popup — or a clear error.

Pipeline (end‑to‑end)
1) DOM scraping (extension)
   - Detect policy links (includes current page if it looks like a policy)
   - Extract rendered text and cookie tables
2) Policy extraction (extension)
   - Provider/cookie/expiry parsed; durations converted to days
   - Third‑party partners from provider column
   - Consent and disclosure signals inferred
3) Baseline comparison (server)
   - Uses your per‑industry baselines (p75 for ads/analytics; few/some/many for partners)
4) AI summary (server)
   - Groq model `llama-3.1-8b-instant`
   - p75‑only language (no “up to … days” maxima)
   - Says “not disclosed” when evidence is missing; lowers transparency
5) UI verdict (extension)
   - Blue popup, 3 bullets + one-line advice, scores & verdict

Tech used
- Extension: TypeScript, content script + background worker, simple DOM/regex heuristics
- Server: Node.js (Express, TypeScript)
- AI: groq‑sdk (LLaMA 3.1 8B Instant)
- Optional DB: Prisma + Postgres/Neon for potential caching capabilities (disabled by default)

Repo layout
- `extension/` — the Chrome extension
  - `src/content/content.js` — parses policy links & cookie tables; extracts provider/expiry/ttl_days
  - `src/worker/pipeline.ts` — builds the payload (p75, third‑parties, evidence flags)
  - `src/popup` — blue UI; calls the backend and renders AI output
- `server/` — the backend
  - `src/index.ts` — `/api/health` and `/api/analyze`
  - `src/ai.ts` — Groq call + output validation
  - `src/baselines.ts` — your per‑industry baselines
  - `prisma/` — schema (only if you enable DB)

Setup (server)
1) `cd server && npm install`
2) Create `server/.env` (no quotes):
   - `GROQ_API_KEY=gsk_...`
   - Optional persistence:
     - `DATABASE_URL=postgresql://...`
     - `ENABLE_DB=true` (omit to disable DB I/O)
3) Set baselines in `server/src/baselines.ts` (see “Baselines” below)
4) Build & run: `npm run build && npm start`
5) Health: `curl http://localhost:3000/api/health`

Setup (extension)
1) `cd extension && npm install`
2) Configure API URL in `src/config.ts` (dev):
   - `export const API_BASE_URL = 'http://localhost:3000'`
3) Build: `npm run build`
4) Load in Chrome: `chrome://extensions` → “Load unpacked” → `extension/dist`

Baselines (you control “typical”)
- File: `server/src/baselines.ts`
- For each category (retail, news, saas, finance_health, gov_ngo) set:
  - `ads_p75_days` — typical 75th percentile for ad cookies
  - `analytics_p75_days` — typical 75th percentile for analytics cookies
  - `third_party_bands` — thresholds for few/some/many partners
- Example (retail): `ads_p75_days: 180`, `analytics_p75_days: 365`, `third_party_bands: { few: 5, some: 15, many: 25 }`
- Optional: seed to DB (only if `ENABLE_DB=true`): `cd server && npm run build && npm run seed:baselines`

Run it
- Start server: `cd server && npm run build && npm start`
- Build extension: `cd extension && npm run build`
- Load popup and click “Analyze” on any site

What the popup shows
- Headline: ✅ Generally safe / ⚠️ Some concerns / 🚩 Risky
- 3 bullets:
  1) p75 cookie lifetimes (ads/analytics) vs your baselines (or “typical not provided”)
  2) third‑party partners + consent controls (red flags: no reject‑all / no per‑category)
  3) missing disclosures (rights, contact, last updated, PD retention) or “very long outliers” (no scary maxima)
- Advice: one concise line (e.g., “Allow only essential; avoid ‘Accept All’”)

Notes & safeguards
- AI is always called; on failure the popup shows a clear error (no local fallback UI).
- Missing evidence is never treated as zero — AI says “not disclosed” and lowers transparency.
- p75 only; no “up to … days” phrasing.

Troubleshooting
- “AI unavailable, please retry” → check `GROQ_API_KEY` in `server/.env`, rebuild & restart
- DB error (Prisma) but you don’t use DB → remove `ENABLE_DB` from `.env` (DB writes are skipped unless true)
- No cloud results → verify `API_BASE_URL` and server running
- Cookie table missed → some pages render late; reopen the popup after a second


