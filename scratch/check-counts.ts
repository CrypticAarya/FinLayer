import prisma from "../apps/api/src/db/prisma.js";

async function main() {
  const [companies, vouchers, entries, ledgers] = await Promise.all([
    prisma.company.count(),
    prisma.voucher.count(),
    prisma.voucherEntry.count(),
    prisma.ledger.count()
  ]);
  console.log("Database counts:", { companies, vouchers, entries, ledgers });
  await prisma.$disconnect();
}

main().catch(console.error);
