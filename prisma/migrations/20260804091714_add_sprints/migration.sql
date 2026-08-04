-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sprintId" UUID;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "sprintDurationDays" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Sprint" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "status" "SprintStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sprint_tenantId_status_idx" ON "Sprint"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Order_sprintId_idx" ON "Order"("sprintId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
