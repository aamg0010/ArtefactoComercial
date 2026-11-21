-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "comarca" TEXT,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "nextActionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;
