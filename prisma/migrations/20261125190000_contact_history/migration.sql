ALTER TABLE "Activity" ADD COLUMN "interlocutor" VARCHAR(200), ADD COLUMN "meetingDetails" TEXT;
ALTER TABLE "EmailDispatch" ADD COLUMN "approvedById" TEXT, ADD COLUMN "recipient" TEXT, ADD COLUMN "subject" TEXT, ADD COLUMN "body" TEXT, ADD COLUMN "signatureName" TEXT, ADD COLUMN "signatureTitle" TEXT, ADD COLUMN "trygestionId" TEXT;
ALTER TABLE "EmailDispatch" ADD CONSTRAINT "EmailDispatch_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
