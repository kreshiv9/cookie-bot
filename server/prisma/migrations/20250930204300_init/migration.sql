-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "lang" TEXT,
    "rawTextHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "extractionJson" JSONB NOT NULL,
    "adsP75Days" INTEGER NOT NULL,
    "analyticsP75Days" INTEGER NOT NULL,
    "thirdPartiesCount" INTEGER NOT NULL,
    "hasChoices" BOOLEAN NOT NULL,
    "rejectNonEssential" TEXT NOT NULL,
    "rightsListed" BOOLEAN NOT NULL,
    "contactPresent" BOOLEAN NOT NULL,
    "pdRetentionPresent" BOOLEAN NOT NULL,
    "lastUpdatedPresent" BOOLEAN NOT NULL,
    "readabilityHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "clarityScoreRule" INTEGER NOT NULL,
    "safetyScoreRule" INTEGER NOT NULL,
    "clarityScoreFinal" INTEGER NOT NULL,
    "safetyScoreFinal" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "aiProvider" TEXT,
    "aiVersion" TEXT,
    "aiOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Baseline" (
    "id" TEXT NOT NULL,
    "siteCategory" TEXT NOT NULL,
    "adsP75Days" INTEGER NOT NULL,
    "analyticsP75Days" INTEGER NOT NULL,
    "thirdPartyBands" JSONB NOT NULL,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Baseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Site_domain_key" ON "Site"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_policyId_key" ON "Extraction"("policyId");

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
