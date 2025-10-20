import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './db';
import { scoreClarity } from './scoring';
import { aiSummarizeFinal } from './ai';
import { getBaselinesFor } from './baselines';

const app = express();
const PORT = process.env.PORT || 3000;
const DB_ENABLED = process.env.ENABLE_DB === 'true';

app.use(cors());
app.use(express.json({ limit: '250kb' }));

app.get('/api/health', (_req: any, res: any) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/baselines', (req: any, res: any) => {
  const siteType = (req.query.siteType as string) || null;
  const base = getBaselinesFor(siteType || 'retail');
  res.json(base);
});

// Analyze endpoint (Render-friendly Express handler)
app.post('/api/analyze', async (req: any, res: any) => {
  try {
    const payload: any = req.body || {};

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // Derive domain from provided siteUrl (required)
    const url: string | undefined = payload.siteUrl || payload.url;
    if (!url) return res.status(400).json({ error: 'siteUrl is required' });
    const domain = new URL(url).hostname.replace(/^www\./, '');

    // Upsert site only if DB is enabled
    let siteId: string | null = null;
    if (DB_ENABLED) {
      const site = await prisma.site.upsert({
        where: { domain },
        update: {},
        create: { domain, category: payload.siteType ?? null }
      });
      siteId = site.id;
    }

    // Note: We will persist Policy/Extraction/Analysis only after AI succeeds

    // Clarity inputs — map to expected fields (with safe fallbacks)
    const clarity = scoreClarity({
      rights_listed: !!payload?.disclosures?.rights_listed,
      contact_present: !!payload?.disclosures?.contact_present,
      pd_retention_present: !!payload?.disclosures?.pd_retention_present,
      // Default to false so we don't over-credit when data is missing
      cookie_categories_explained: payload?.disclosures?.cookie_categories_explained ?? false,
      cookie_lifespans_disclosed: payload?.disclosures?.cookie_lifespans_disclosed ?? false,
      has_category_choices: !!payload?.consent?.has_category_choices,
      reject_non_essential: payload?.consent?.reject_non_essential ?? 'unclear',
      cmp_name: payload?.consent?.cmp_name ?? null,
      last_updated_present: payload?.disclosures?.last_updated_present ?? false,
      readability_hint: payload?.readability_hint ?? 'moderate'
    });

    const base = getBaselinesFor(payload.siteType ?? 'retail');

    // Safety inputs — accept either precomputed metrics or infer basic ones
    // Accept metrics as provided; treat missing as null (unknown)
    const adsP75 = Number.isFinite(payload?.metrics?.ads_p75_days) ? payload.metrics.ads_p75_days : null;
    const analyticsP75 = Number.isFinite(payload?.metrics?.analytics_p75_days) ? payload.metrics.analytics_p75_days : null;
    const veryLongVendors = Number.isFinite(payload?.metrics?.very_long_vendors) ? payload.metrics.very_long_vendors : null;
    const thirdCount = (typeof payload?.third_parties?.count === 'number' && Number.isFinite(payload.third_parties.count))
      ? payload.third_parties.count
      : null;

    // AI-first finalization (no rules-only fallback)
    let finalClarity = clarity;
    let finalSafety = 0;
    let v: 'LIKELY_OK'|'CAUTION'|'HIGH_RISK' = 'CAUTION';
    let aiOutput: any = null;
    try {
      const ai = await aiSummarizeFinal({
        siteType: payload.siteType ?? null,
        baselines: base,
        extraction: {
          // Intentionally do not include raw duration arrays to avoid outlier-driven phrasing
          third_parties: payload.third_parties,
          consent: payload.consent,
          disclosures: payload.disclosures,
          durations_evidence: payload?.durations_evidence,
          third_parties_evidence: payload?.third_parties_evidence,
          retention: Array.isArray(payload?.retention) ? payload.retention.slice(0, 5) : undefined,
          policy_urls: Array.isArray(payload?.policy_urls) ? payload.policy_urls.slice(0, 3) : undefined,
          readability_hint: payload.readability_hint || 'moderate'
        },
        metrics: { ads_p75: adsP75, analytics_p75: analyticsP75, very_long_count: veryLongVendors, third_parties_count: thirdCount },
        rule_scores: { clarity_rule_score: clarity }
      });
      finalClarity = ai.clarity_final;
      finalSafety = ai.safety_final;
      v = ai.verdict;
      aiOutput = ai;
    } catch {
      return res.status(502).json({ error: 'AI unavailable, please retry' });
    }

    // Persist only on AI success and when DB is enabled
    if (DB_ENABLED && siteId) {
      const policy = await prisma.policy.create({
        data: {
          siteId: siteId,
          url,
          lang: payload.lang ?? null,
          rawTextHash: payload.rawTextHash ?? 'n/a'
        }
      });

      await prisma.extraction.create({
        data: {
          policyId: policy.id,
          extractionJson: payload,
          adsP75Days: Number.isFinite(adsP75) ? adsP75 : 0,
          analyticsP75Days: Number.isFinite(analyticsP75) ? analyticsP75 : 0,
          thirdPartiesCount: Number.isFinite(thirdCount) ? thirdCount : 0,
          hasChoices: !!payload?.consent?.has_category_choices,
          rejectNonEssential: payload?.consent?.reject_non_essential ?? 'unclear',
          rightsListed: !!payload?.disclosures?.rights_listed,
          contactPresent: !!payload?.disclosures?.contact_present,
          pdRetentionPresent: !!payload?.disclosures?.pd_retention_present,
          lastUpdatedPresent: payload?.disclosures?.last_updated_present ?? false,
          readabilityHint: payload?.readability_hint ?? 'moderate'
        }
      });

      await prisma.analysis.create({
        data: {
          siteId: siteId,
          policyId: policy.id,
          clarityScoreRule: Math.round(clarity),
          safetyScoreRule: 0,
          clarityScoreFinal: Math.round(finalClarity),
          safetyScoreFinal: Math.round(finalSafety),
          verdict: v,
          aiProvider: 'groq',
          aiVersion: 'llama-3.1-8b-instant',
          aiOutput
        }
      });
    }

    return res.json({
      clarity: finalClarity,
      safety: finalSafety,
      verdict: v,
      bullets: aiOutput.bullets ?? [],
      advice: aiOutput.advice ?? ''
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Internal error' });
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});

function clamp01(n: number) {
  return Math.max(0, Math.min(100, n));
}
