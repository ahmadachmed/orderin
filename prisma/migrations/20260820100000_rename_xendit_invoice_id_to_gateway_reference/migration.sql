-- RenameColumn
ALTER TABLE "Payment" RENAME COLUMN "xenditInvoiceId" TO "gatewayReference";

-- RenameIndex
ALTER INDEX "Payment_xenditInvoiceId_key" RENAME TO "Payment_gatewayReference_key";
