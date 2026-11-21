-- Firma editable de cada usuario para los emails de Mi dia
ALTER TABLE "User" ADD COLUMN "signatureName" TEXT;
ALTER TABLE "User" ADD COLUMN "signatureTitle" TEXT;
