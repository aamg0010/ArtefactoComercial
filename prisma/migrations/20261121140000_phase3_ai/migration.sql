-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('BORRADOR', 'APPROVED');

-- AlterTable
ALTER TABLE "ResearchReport" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'SEED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Script" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "status" "ScriptStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringWeights" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "sector" INTEGER NOT NULL DEFAULT 25,
    "size" INTEGER NOT NULL DEFAULT 15,
    "intent" INTEGER NOT NULL DEFAULT 20,
    "contact" INTEGER NOT NULL DEFAULT 15,
    "proximity" INTEGER NOT NULL DEFAULT 15,
    "crossSell" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringWeights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "researchReportId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "suggestedPriority" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRun_companyId_createdAt_idx" ON "AiRun"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Score_researchReportId_key" ON "Score"("researchReportId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_name_key" ON "Template"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchReport_companyId_version_key" ON "ResearchReport"("companyId", "version");

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_researchReportId_fkey" FOREIGN KEY ("researchReportId") REFERENCES "ResearchReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
