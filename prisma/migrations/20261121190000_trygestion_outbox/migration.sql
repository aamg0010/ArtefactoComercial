-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('COMPANY_UPSERT', 'CONTACT_UPSERT', 'OPPORTUNITY_STAGE', 'OPPORTUNITY_STATUS', 'ACTIVITY', 'EVENT', 'SUPPRESSION');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "trygestionActividadId" TEXT,
ADD COLUMN     "trygestionEventoId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "trygestionEmpresaId" TEXT,
ADD COLUMN     "trygestionOportunidadId" TEXT,
ADD COLUMN     "trygestionSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "trygestionContactoId" TEXT;

-- CreateTable
CREATE TABLE "EmailDispatch" (
    "taskId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "opportunityId" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDispatch_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncOutbox_idempotencyKey_key" ON "SyncOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncOutbox_status_nextAttemptAt_idx" ON "SyncOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Company_trygestionEmpresaId_key" ON "Company"("trygestionEmpresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_trygestionOportunidadId_key" ON "Company"("trygestionOportunidadId");
