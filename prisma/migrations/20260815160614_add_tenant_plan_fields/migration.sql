-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "planExpiresAt" TIMESTAMP(3);
