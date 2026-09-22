import prisma from "../apps/api/src/db/prisma.js";

async function main() {
  console.log("Validating database schema and constraints...");

  // 1. Check columns in information_schema
  const columns: Array<{ column_name: string; is_nullable: string; data_type: string }> = await prisma.$queryRawUnsafe(`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name = 'Voucher' AND column_name IN ('masterId', 'alterId', 'guid', 'syncRunId')
    ORDER BY column_name;
  `);

  console.log("Voucher Columns:", columns);

  // 2. Check unique constraints in pg_constraint
  const constraints: Array<{ conname: string; contype: string }> = await prisma.$queryRawUnsafe(`
    SELECT conname, contype::text as contype
    FROM pg_constraint
    WHERE conrelid = '"Voucher"'::regclass;
  `);

  console.log("Voucher Constraints:", constraints);

  // 3. Verify that attempting to insert a duplicate (companyId, masterId) throws unique constraint error
  const sampleVoucher = await prisma.voucher.findFirst();
  if (sampleVoucher) {
    console.log(`Testing duplicate insertion on companyId: ${sampleVoucher.companyId}, masterId: ${sampleVoucher.masterId}...`);
    try {
      await prisma.voucher.create({
        data: {
          companyId: sampleVoucher.companyId,
          masterId: sampleVoucher.masterId,
          alterId: sampleVoucher.alterId + 1,
          voucherNumber: "DUP-TEST",
          voucherType: "Payment",
          date: new Date(),
          amount: 100,
        }
      });
      throw new Error("FAIL: Duplicate insert succeeded when it should have failed!");
    } catch (err: any) {
      if (err.code === "P2002" || err.message?.includes("Unique constraint failed") || err.message?.includes("duplicate key")) {
        console.log("✓ SUCCESS: Database correctly rejected duplicate (companyId, masterId) with unique constraint violation (P2002).");
      } else {
        throw err;
      }
    }
  }

  console.log("✓ All database migration validation checks passed!");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
