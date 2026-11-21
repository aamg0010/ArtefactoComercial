/*
  Warnings:

  - Added the required column `title` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CompanyCadenceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FINISHED');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "authorId" TEXT,
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "SuppressionList" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "companyCadenceId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "result" TEXT,
ADD COLUMN     "scriptId" TEXT,
ADD COLUMN     "title" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "CompanyCadence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cadenceId" TEXT NOT NULL,
    "scriptId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "CompanyCadenceStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "CompanyCadence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCadence_companyId_cadenceId_key" ON "CompanyCadence"("companyId", "cadenceId");

-- CreateIndex
CREATE INDEX "SuppressionList_companyId_idx" ON "SuppressionList"("companyId");

-- AddForeignKey
ALTER TABLE "CadenceStep" ADD CONSTRAINT "CadenceStep_cadenceId_fkey" FOREIGN KEY ("cadenceId") REFERENCES "Cadence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyCadenceId_fkey" FOREIGN KEY ("companyCadenceId") REFERENCES "CompanyCadence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_cadenceStepId_fkey" FOREIGN KEY ("cadenceStepId") REFERENCES "CadenceStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCadence" ADD CONSTRAINT "CompanyCadence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCadence" ADD CONSTRAINT "CompanyCadence_cadenceId_fkey" FOREIGN KEY ("cadenceId") REFERENCES "Cadence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCadence" ADD CONSTRAINT "CompanyCadence_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionList" ADD CONSTRAINT "SuppressionList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
