ALTER TABLE "SuppressionList"
  ADD CONSTRAINT "suppression_list_contact_required"
  CHECK ("companyId" IS NOT NULL OR "email" IS NOT NULL OR "phone" IS NOT NULL);
