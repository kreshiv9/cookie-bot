import { prisma } from "../db";
import { getBaselinesFor } from "../baselines";

async function main() {
  const cats = ["retail","news","saas","finance_health","gov_ngo"];
  for (const siteCategory of cats) {
    const base = getBaselinesFor(siteCategory);
    const existing = await prisma.baseline.findFirst({ where: { siteCategory } });
    if (existing) {
      await prisma.baseline.update({
        where: { id: existing.id },
        data: {
          adsP75Days: base.ads_p75_days,
          analyticsP75Days: base.analytics_p75_days,
          thirdPartyBands: base.third_party_bands,
          notes: base.notes || null
        }
      });
    } else {
      await prisma.baseline.create({
        data: {
          siteCategory,
          adsP75Days: base.ads_p75_days,
          analyticsP75Days: base.analytics_p75_days,
          thirdPartyBands: base.third_party_bands,
          notes: base.notes || null
        }
      });
    }
    console.log(`Seeded baseline for ${siteCategory}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
