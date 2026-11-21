-- DropForeignKey
ALTER TABLE "SuppressionList" DROP CONSTRAINT "SuppressionList_companyId_fkey";

-- DropIndex
DROP INDEX "Company_normalizedName_country_key";

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "address" TEXT,
ADD COLUMN     "detectedAt" TIMESTAMP(3),
ADD COLUMN     "discoveryRunId" TEXT,
ADD COLUMN     "researchQueuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SuppressionList" ADD COLUMN     "city" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "country" "Country",
ADD COLUMN     "domain" TEXT;

-- CreateTable
CREATE TABLE "SearchProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "country" "Country" NOT NULL DEFAULT 'ES',
    "provinces" TEXT[],
    "comarcas" TEXT[],
    "municipalities" TEXT[],
    "keywords" TEXT[],
    "cnaeCodes" TEXT[],
    "productLine" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'google-places',
    "maxResults" INTEGER NOT NULL DEFAULT 10,
    "csvCandidates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "queries" JSONB NOT NULL,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "suppressed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "matches" JSONB NOT NULL,
    "errorCodes" JSONB NOT NULL,

    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CompanySource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceRun_profileId_startedAt_idx" ON "SourceRun"("profileId", "startedAt");

-- CreateIndex
CREATE INDEX "CompanySource_companyId_idx" ON "CompanySource"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySource_source_sourceRef_key" ON "CompanySource"("source", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "Company_normalizedName_country_city_key" ON "Company"("normalizedName", "country", "city");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "SourceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionList" ADD CONSTRAINT "SuppressionList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "SearchProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySource" ADD CONSTRAINT "CompanySource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SQL-only safeguards (not expressible in Prisma's datamodel).
ALTER TABLE "SuppressionList" DROP CONSTRAINT "suppression_list_contact_required";
ALTER TABLE "SuppressionList" ADD CONSTRAINT "suppression_list_contact_required"
  CHECK ("companyId" IS NOT NULL OR "email" IS NOT NULL OR "phone" IS NOT NULL OR "domain" IS NOT NULL OR "companyName" IS NOT NULL);
ALTER TABLE "SearchProfile" ADD CONSTRAINT "search_profile_result_limit" CHECK ("maxResults" BETWEEN 1 AND 200);

-- Preserve opt-out identifiers before ON DELETE SET NULL runs. This also covers
-- the existing company deletion path, not only new prospecting actions.
CREATE FUNCTION preserve_company_suppression() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SuppressionList" WHERE "companyId" = OLD.id) THEN
    UPDATE "SuppressionList" SET
      "domain" = COALESCE("domain", OLD."normalizedDomain"),
      "companyName" = COALESCE("companyName", OLD.name),
      "city" = COALESCE("city", OLD.city),
      "country" = COALESCE("country", OLD.country),
      "phone" = COALESCE("phone", OLD.phone)
    WHERE "companyId" = OLD.id;
    UPDATE "CompanySource" SET blocked = true WHERE "companyId" = OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER preserve_company_suppression_before_delete
BEFORE DELETE ON "Company" FOR EACH ROW EXECUTE FUNCTION preserve_company_suppression();
