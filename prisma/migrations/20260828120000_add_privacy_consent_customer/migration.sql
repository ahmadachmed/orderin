-- AlterTable
-- UU PDP: record explicit consent timestamp + policy version at customer register.
ALTER TABLE "Customer" ADD COLUMN "privacyConsentAt" TIMESTAMP(3),
ADD COLUMN "privacyConsentVersion" TEXT;
