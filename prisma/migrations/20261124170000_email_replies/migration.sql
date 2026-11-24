-- CreateEnum
CREATE TYPE "EmailReplyStatus" AS ENUM ('NEW', 'HANDLED');

-- CreateTable
CREATE TABLE "EmailReply" (
    "id" TEXT NOT NULL,
    "trygestionId" TEXT NOT NULL,
    "companyId" TEXT,
    "taskId" TEXT,
    "externalRef" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "excerpt" TEXT,
    "category" TEXT,
    "priority" TEXT,
    "method" TEXT NOT NULL,
    "status" "EmailReplyStatus" NOT NULL DEFAULT 'NEW',
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,
    "handledAction" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailReplySync" (
    "id" TEXT NOT NULL DEFAULT 'trygestion',
    "cursor" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailReplySync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailReply_trygestionId_key" ON "EmailReply"("trygestionId");

-- CreateIndex
CREATE INDEX "EmailReply_status_receivedAt_idx" ON "EmailReply"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailReply_companyId_status_receivedAt_idx" ON "EmailReply"("companyId", "status", "receivedAt");

-- AddForeignKey
ALTER TABLE "EmailReply" ADD CONSTRAINT "EmailReply_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailReply" ADD CONSTRAINT "EmailReply_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailReply" ADD CONSTRAINT "EmailReply_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

