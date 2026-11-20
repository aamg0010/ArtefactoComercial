-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "dueAt" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Task_companyId_cadenceStepId_key" ON "Task"("companyId", "cadenceStepId");

