-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CALL', 'EMAIL', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'NOTE', 'MEETING');

-- CreateTable
CREATE TABLE "Cadence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cadence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadenceStep" (
    "id" TEXT NOT NULL,
    "cadenceId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "type" "TaskType" NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cadenceStepId" TEXT,
    "assigneeId" TEXT,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "result" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionList" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cadence_name_key" ON "Cadence"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CadenceStep_cadenceId_dayOffset_type_key" ON "CadenceStep"("cadenceId", "dayOffset", "type");

-- CreateIndex
CREATE INDEX "Task_companyId_dueAt_status_idx" ON "Task"("companyId", "dueAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionList_email_key" ON "SuppressionList"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionList_phone_key" ON "SuppressionList"("phone");
