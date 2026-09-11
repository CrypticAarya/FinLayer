-- CreateTable
CREATE TABLE "TrialBalanceEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerName" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "debitAmount" DOUBLE PRECISION NOT NULL,
    "creditAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialBalanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialBalanceEntry_companyId_idx" ON "TrialBalanceEntry"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TrialBalanceEntry_companyId_ledgerName_key" ON "TrialBalanceEntry"("companyId", "ledgerName");

-- AddForeignKey
ALTER TABLE "TrialBalanceEntry" ADD CONSTRAINT "TrialBalanceEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
