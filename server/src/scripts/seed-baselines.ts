import { prisma } from "../db";
import { getBaselinesFor } from "../baselines";

async function main() {
  const cats = ["retail","news","saas","finance_health","gov_ngo"];
  for (const siteCategory of cats) {
    const base = getBaselinesFor(siteCategory);
    const existing = await prisma.baseline.findFirst({ where: { siteCategory } });
    // Build partial update/create data respecting null placeholders
    const hasAds = typeof base.ads_p75_days === 'number';
    const hasAna = typeof base.analytics_p75_days === 'number';
    const bands = base.third_party_bands;
    const hasBands = typeof bands?.few === 'number' && typeof bands?.some === 'number' && typeof bands?.many === 'number';

    if (existing) {
      const dataUpdate: any = { notes: base.notes || null };
      if (hasAds) dataUpdate.adsP75Days = base.ads_p75_days;
      if (hasAna) dataUpdate.analyticsP75Days = base.analytics_p75_days;
      if (hasBands) dataUpdate.thirdPartyBands = bands;
      if (Object.keys(dataUpdate).length > 0) {
        await prisma.baseline.update({ where: { id: existing.id }, data: dataUpdate });
      }
    } else {
      // Only create when all required numeric fields are present
      if (hasAds && hasAna && hasBands) {
        await prisma.baseline.create({
          data: {
            siteCategory,
            adsP75Days: base.ads_p75_days as number,
            analyticsP75Days: base.analytics_p75_days as number,
            thirdPartyBands: bands as any,
            notes: base.notes || null
          }
        });
      } else {
        console.log(`Skipping baseline create for ${siteCategory}: placeholders not set`);
      }
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
