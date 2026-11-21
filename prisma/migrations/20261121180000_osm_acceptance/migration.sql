-- CreateEnum
CREATE TYPE "CompanyAcceptanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISCARDED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "acceptanceStatus" "CompanyAcceptanceStatus" NOT NULL DEFAULT 'ACCEPTED';

-- AlterTable
ALTER TABLE "CompanySource" ADD COLUMN     "attribution" TEXT,
ADD COLUMN     "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sourceUrl" TEXT;

-- AlterTable
ALTER TABLE "SearchProfile" ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CompanyEvidence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceThrottle" (
    "id" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceThrottle_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CompanyEvidence" ADD CONSTRAINT "CompanyEvidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing custom profiles; the three examples gain the new default.
UPDATE "SearchProfile" SET sources = ARRAY[source] WHERE cardinality(sources) = 0;
UPDATE "SearchProfile" SET sources = ARRAY['openstreetmap', 'google-places']
WHERE id IN ('seed-profile-food', 'seed-profile-livestock', 'seed-profile-services') AND source = 'google-places';

-- Old Google-only placeholders must not enter the research queue until reviewed.
UPDATE "Company" SET "acceptanceStatus" = CASE WHEN "pipelineStage" = 'LOST' THEN 'DISCARDED'::"CompanyAcceptanceStatus" ELSE 'PENDING'::"CompanyAcceptanceStatus" END,
  "researchQueuedAt" = NULL
WHERE source = 'GOOGLE_PLACES' AND website IS NULL AND phone IS NULL AND name LIKE 'Empresa detectada · %'
  AND NOT EXISTS (SELECT 1 FROM "CompanySource" s WHERE s."companyId" = "Company".id AND s.source <> 'google-places');
