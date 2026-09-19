-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "alterId" INTEGER,
ADD COLUMN     "guid" TEXT,
ADD COLUMN     "masterId" INTEGER,
ADD COLUMN     "syncRunId" TEXT;

-- CreateIndex
CREATE INDEX "Voucher_guid_idx" ON "Voucher"("guid");

-- CreateIndex
CREATE INDEX "Voucher_syncRunId_idx" ON "Voucher"("syncRunId");
