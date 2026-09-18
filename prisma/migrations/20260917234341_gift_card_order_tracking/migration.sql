-- AlterTable
ALTER TABLE "GiftCard" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "orderId" TEXT;

-- CreateIndex
CREATE INDEX "GiftCard_orderId_idx" ON "GiftCard"("orderId");
