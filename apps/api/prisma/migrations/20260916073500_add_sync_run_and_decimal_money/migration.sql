-- AlterTable
ALTER TABLE "Voucher" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(15,2);

-- AlterTable
ALTER TABLE "VoucherEntry" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(15,2);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SYNC_STARTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAuditLog" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_companyId_idx" ON "SyncRun"("companyId");

-- CreateIndex
CREATE INDEX "SyncRun_companyId_status_idx" ON "SyncRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "SyncRun_companyId_startedAt_idx" ON "SyncRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "SyncAuditLog_syncRunId_idx" ON "SyncAuditLog"("syncRunId");

-- CreateIndex
CREATE INDEX "SyncAuditLog_syncRunId_createdAt_idx" ON "SyncAuditLog"("syncRunId", "createdAt");

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAuditLog" ADD CONSTRAINT "SyncAuditLog_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill tenant-scoped legacy SyncRun for existing vouchers before adding FK constraint
INSERT INTO "SyncRun" ("id", "companyId", "status", "startedAt", "completedAt", "recordsFetched", "recordsCreated", "recordsUpdated", "recordsFailed", "createdAt", "updatedAt")
SELECT 
    'legacy-backfill-' || "companyId", 
    "companyId", 
    'SYNC_COMPLETED', 
    NOW(), 
    NOW(), 
    COUNT(*), 
    COUNT(*), 
    0, 
    0, 
    NOW(), 
    NOW()
FROM "Voucher"
WHERE "syncRunId" IS NULL OR "syncRunId" = 'legacy-backfill' OR "syncRunId" LIKE 'legacy-backfill-%'
GROUP BY "companyId"
ON CONFLICT ("id") DO NOTHING;

-- Assign tenant-scoped syncRunId to existing legacy vouchers
UPDATE "Voucher"
SET "syncRunId" = 'legacy-backfill-' || "companyId"
WHERE "syncRunId" IS NULL OR "syncRunId" = 'legacy-backfill';

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

