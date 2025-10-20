import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../src/db';
import { scoreClarity, scoreSafety, verdict } from '../src/scoring';
import { aiSummarize } from '../src/ai';

"import { getBaselinesFor } from '../src/baselines';"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = req.body ?? JSON.parse(req.body as any); // extension sends JSON
    // TODO: validate payload against your contracts (zod recommended)

    // 1) derive domain & hashes (simple domain parse)
    const url: string = payload.siteUrl;
    const domain = new URL(url).hostname.replace(/^www\./, '');

    // 2) upsert site
    const site = await prisma.site.upsert({
      where: { domain },
      update: {},
      create: { domain, category: payload.siteType ?? null }
    });

    // 3) create policy snapshot (hash text if you include it)
    const policy = await prisma.policy.create({
      data: {
        siteId: site.id,
        url,
        lang: payload.lang ?? null,
        rawTextHash: payload.rawTextHash ?? 'n/a'
      }
    });

    // 4) compute rule scores (you’ll pass the exact fields you extract)
    const clarity = scoreClarity({
      rights_listed: payload.disclosures.rights_listed,
      contact_present: payload.disclosures.contact_present,
      pd_retention_present: payload.disclosures.pd_retention_present,
      cookie_categories_explained: payload.disclosures.cookie_categories_explained ?? true,
      cookie_lifespans_disclosed: payload.disclosures.cookie_lifespans_disclosed ?? true,
      has_category_choices: payload.consent.has_category_choices,
      reject_non_essential: payload.consent.reject_non_essential,
      cmp_name: payload.consent.cmp_name,
      last_updated_present: payload.disclosures.last_updated_present ?? false,
      readability_hint: payload.readability_hint ?? 'moderate'
    });

    // Load baselines for category (from DB or JSON file)
    const base = getBaselinesFor(payload.siteType ?? 'retail'); // implement getBaselinesFor in baselines.ts

    const safety = scoreSafety({
      site_category: payload.siteType ?? 'retail',
      ads_p75_days: payload.metrics.ads_p75_days,
      analytics_p75_days: payload.metrics.analytics_p75_days,
      very_long_count: payload.metrics.very_long_vendors ?? 0,
      third_parties_count: payload.third_parties.count,
      bands: base.third_party_bands,
      consent_penalties: {
        no_choices: !payload.consent.has_category_choices,
        no_reject: payload.consent.reject_non_essential === 'no',
        unclear_reject: payload.consent.reject_non_essential === 'unclear'
      },
      sensitive_trackers: payload.metrics.sensitive_trackers ?? false,
      baseline_ads_p75: base.ads_p75_days,
      baseline_analytics_p75: base.analytics_p75_days
    });

    let finalClarity = clarity;
    let finalSafety = safety;

    // 5) AI summary
    let aiOutput: any = null;
    try {
      aiOutput = await aiSummarize({
        siteType: payload.siteType,
        clarity_rule_score: clarity,
        safety_rule_score: safety,
        extraction: payload,
        baselines: base
      });

      const d = aiOutput.optional_adjustments ?? {};
      if (typeof d.clarity_delta === 'number') finalClarity = clamp01(finalClarity + d.clarity_delta);
      if (typeof d.safety_delta === 'number') finalSafety = clamp01(finalSafety + d.safety_delta);
    } catch (e) {
      // if AI fails, we'll return rules-only copy; you can also generate template bullets
      aiOutput = { bullets: [
        'We analyzed the site’s policy and cookie practices.',
        'If available, turn off advertising cookies; keep essential cookies on.',
      ], advice: 'Proceed carefully and only accept what you need.' };
    }

    const v = verdict(finalClarity, finalSafety);

    // 6) persist extraction & analysis
    await prisma.extraction.create({
      data: {
        policyId: policy.id,
        extractionJson: payload,
        adsP75Days: payload.metrics.ads_p75_days,
        analyticsP75Days: payload.metrics.analytics_p75_days,
        thirdPartiesCount: payload.third_parties.count,
        hasChoices: payload.consent.has_category_choices,
        rejectNonEssential: payload.consent.reject_non_essential,
        rightsListed: payload.disclosures.rights_listed,
        contactPresent: payload.disclosures.contact_present,
        pdRetentionPresent: payload.disclosures.pd_retention_present,
        lastUpdatedPresent: payload.disclosures.last_updated_present ?? false,
        readabilityHint: payload.readability_hint ?? 'moderate'
      }
    });

    await prisma.analysis.create({
      data: {
        siteId: site.id,
        policyId: policy.id,
        clarityScoreRule: clarity,
        safetyScoreRule: safety,
        clarityScoreFinal: finalClarity,
        safetyScoreFinal: finalSafety,
        verdict: v,
        aiProvider: 'groq',
        aiVersion: 'llama-3.1-8b-instant',
        aiOutput
      }
    });

    // 7) respond
    res.status(200).json({
      clarity: finalClarity,
      safety: finalSafety,
      verdict: v,
      bullets: aiOutput.bullets ?? [],
      advice: aiOutput.advice ?? ''
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Internal error' });
  }
}

function clamp01(n: number) { return Math.max(0, Math.min(100, n)); }
function getBaselinesFor(siteType: string) {
  // simplest: embed your JSON baselines here or import from src/baselines.ts
  return {
    ads_p75_days: 180,
    analytics_p75_days: 365,
    third_party_bands: { few: 5, some: 19, many: 49 }
  } as any;
}
