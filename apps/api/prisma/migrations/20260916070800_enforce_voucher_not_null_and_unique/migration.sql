-- AlterTable: Backfill historical vouchers with deterministic negative masterId and alterId = 1
UPDATE "Voucher"
SET 
  "masterId" = sub.rn,
  "alterId" = COALESCE("Voucher"."alterId", 1)
FROM (
  SELECT id, (-ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt" ASC, "id" ASC))::INTEGER as rn
  FROM "Voucher"
  WHERE "masterId" IS NULL
) sub
WHERE "Voucher".id = sub.id;

-- Ensure any remaining NULL alterIds are set to 1
UPDATE "Voucher"
SET "alterId" = 1
WHERE "alterId" IS NULL;

-- AlterTable: Enforce NOT NULL now that all rows are populated
ALTER TABLE "Voucher" ALTER COLUMN "alterId" SET NOT NULL,
ALTER COLUMN "masterId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_companyId_masterId_key" ON "Voucher"("companyId", "masterId");

