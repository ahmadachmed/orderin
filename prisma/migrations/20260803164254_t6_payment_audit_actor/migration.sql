-- AlterTable
ALTER TABLE "OrderStatusLog" ADD COLUMN     "actorName" TEXT,
ADD COLUMN     "actorType" TEXT,
ADD COLUMN     "paymentStatus" "PaymentStatus";
