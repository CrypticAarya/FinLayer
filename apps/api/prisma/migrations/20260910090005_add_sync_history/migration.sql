-- CreateTable
CREATE TABLE "SyncHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "googleStatus" TEXT,
    "googleError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncHistory_companyId_idx" ON "SyncHistory"("companyId");

-- CreateIndex
CREATE INDEX "SyncHistory_companyId_createdAt_idx" ON "SyncHistory"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "SyncHistory" ADD CONSTRAINT "SyncHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
