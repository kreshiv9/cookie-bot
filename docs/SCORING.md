# Scoring Guidelines

## Clarity (0–100, 100 = best)
Checklist, weights sum to 100:
- Rights listed: 15
- Privacy contact/DPO: 10
- Personal-data retention stated: 15
- Cookie categories explained: 10
- Cookie lifespans disclosed: 10
- Choice to allow/deny categories: 10
- “Reject non-essential” available: 10
- CMP named: 5
- Last updated visible: 5
- Readability (plain vs legalese, AI-graded): 10

Partial credit possible.

---

## Safety (0–100, 100 = safest)
Compute Risk 0–100, then `Safety = 100 − Risk`.

Risk factors:
- Ads cookies P75 vs baseline: up to 20
- Analytics cookies P75 vs baseline: up to 15
- Very long cookies (>730d): up to 20
- Distinct third parties: up to 20
- Consent quality (no choices, no reject all): up to 15
- Sensitive trackers: up to 10

Clamp 0–100.

---

## Verdict Mapping
- Likely OK: Clarity ≥ 70 AND Safety ≥ 70
- Caution: Clarity ≥ 40 AND Safety ≥ 40 (but not both ≥70)
- High Risk: Clarity < 40 OR Safety < 40