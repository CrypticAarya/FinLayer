import prisma from "../apps/api/src/db/prisma.js";

async function main() {
  const vouchers = await prisma.voucher.findMany({
    select: { id: true, companyId: true, voucherNumber: true, voucherType: true, date: true, amount: true }
  });
  console.log("Existing vouchers:", JSON.stringify(vouchers, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
