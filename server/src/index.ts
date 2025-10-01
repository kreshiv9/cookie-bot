import express from 'express';
import cors from 'cors';
import { prisma } from './db';
import { scoreClarity, scoreSafety, verdict } from './scoring';
import { aiSummarizeFinal } from './ai';
import { getBaselinesFor } from './baselines';

const app = express();
const PORT = process.env.PORT || 3000;

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

    // Upsert site (for caching we might return early; but we need domain first)
    const site = await prisma.site.upsert({
      where: { domain },
      update: {},
      create: { domain, category: payload.siteType ?? null }
    });

    // Cache: if rawTextHash provided and we already analyzed it for this domain, return cached
    const rawHash: string | null = payload.rawTextHash ?? null;
    if (rawHash) {
      const cached = await prisma.analysis.findFirst({
        where: {
          site: { domain },
          policy: { rawTextHash: rawHash }
        },
        orderBy: { createdAt: 'desc' },
        select: {
          clarityScoreFinal: true,
          safetyScoreFinal: true,
          verdict: true,
          aiOutput: true
        }
      });
      if (cached && cached.aiOutput) {
        const ai = cached.aiOutput as any;
        return res.json({
          clarity: cached.clarityScoreFinal,
          safety: cached.safetyScoreFinal,
          verdict: cached.verdict,
          bullets: ai.bullets ?? [],
          advice: ai.advice ?? ''
        });
      }
    }

    // Policy snapshot (optionally include a text hash from client)
    const policy = await prisma.policy.create({
      data: {
        siteId: site.id,
        url,
        lang: payload.lang ?? null,
        rawTextHash: payload.rawTextHash ?? 'n/a'
      }
    });

    // Clarity inputs — map to expected fields (with safe fallbacks)
    const clarity = scoreClarity({
      rights_listed: !!payload?.disclosures?.rights_listed,
      contact_present: !!payload?.disclosures?.contact_present,
      pd_retention_present: !!payload?.disclosures?.pd_retention_present,
      cookie_categories_explained: payload?.disclosures?.cookie_categories_explained ?? true,
      cookie_lifespans_disclosed: payload?.disclosures?.cookie_lifespans_disclosed ?? true,
      has_category_choices: !!payload?.consent?.has_category_choices,
      reject_non_essential: payload?.consent?.reject_non_essential ?? 'unclear',
      cmp_name: payload?.consent?.cmp_name ?? null,
      last_updated_present: payload?.disclosures?.last_updated_present ?? false,
      readability_hint: payload?.readability_hint ?? 'moderate'
    });

    const base = getBaselinesFor(payload.siteType ?? 'retail');

    // Safety inputs — accept either precomputed metrics or infer basic ones
    const adsP75 = payload?.metrics?.ads_p75_days
      ?? Math.max(...(payload?.durations?.ads_days || [0]));
    const analyticsP75 = payload?.metrics?.analytics_p75_days
      ?? Math.max(...(payload?.durations?.analytics_days || [0]));
    const veryLongVendors = payload?.metrics?.very_long_vendors ?? 0;
    const thirdCount = payload?.third_parties?.count
      ?? payload?.third_parties?.count === 0 ? 0 : 0;

    const safety = scoreSafety({
      site_category: (payload.siteType ?? 'retail') as any,
      ads_p75_days: Number.isFinite(adsP75) ? adsP75 : 0,
      analytics_p75_days: Number.isFinite(analyticsP75) ? analyticsP75 : 0,
      very_long_count: Number.isFinite(veryLongVendors) ? veryLongVendors : 0,
      third_parties_count: Number.isFinite(thirdCount) ? thirdCount : 0,
      bands: base.third_party_bands,
      consent_penalties: {
        no_choices: !payload?.consent?.has_category_choices,
        no_reject: payload?.consent?.reject_non_essential === 'no',
        unclear_reject: payload?.consent?.reject_non_essential === 'unclear'
      },
      sensitive_trackers: !!payload?.metrics?.sensitive_trackers,
      baseline_ads_p75: base.ads_p75_days,
      baseline_analytics_p75: base.analytics_p75_days
    });

    // AI-first finalization (graceful fallback to rules-only)
    let finalClarity = clarity;
    let finalSafety = safety;
    let v: ReturnType<typeof verdict> = verdict(finalClarity, finalSafety);
    let aiOutput: any = null;
    try {
      const ai = await aiSummarizeFinal({
        siteType: payload.siteType ?? null,
        baselines: base,
        extraction: payload,
        rule_scores: { clarity_rule_score: clarity, safety_rule_score: safety }
      });
      finalClarity = ai.clarity_final;
      finalSafety = ai.safety_final;
      v = ai.verdict;
      aiOutput = ai;
    } catch {
      aiOutput = {
        bullets: [
          'We analyzed the site’s policy and cookie practices.',
          'If available, turn off advertising cookies; keep essential cookies on.'
        ],
        advice: 'Proceed carefully and only accept what you need.',
        clarity_final: finalClarity,
        safety_final: finalSafety,
        verdict: v
      };
    }

    // Persist extraction snapshot (optional fields guarded)
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
        siteId: site.id,
        policyId: policy.id,
        clarityScoreRule: Math.round(clarity),
        safetyScoreRule: Math.round(safety),
        clarityScoreFinal: Math.round(finalClarity),
        safetyScoreFinal: Math.round(finalSafety),
        verdict: v,
        aiProvider: 'groq',
        aiVersion: 'llama-3.1-8b-instruct',
        aiOutput
      }
    });

    res.json({
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
