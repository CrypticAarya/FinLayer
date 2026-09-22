import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({
  adapter,
  log: [{ emit: "stdout", level: "query" }],
});

async function main() {
  console.log("=== Testing Prisma Cursor Pagination with Non-Sequential IDs and Dates ===");

  const comp = await prisma.company.create({
    data: {
      name: `Pagination Test Co ${Date.now()}`,
      tallyCompanyName: `Pagination Test Co ${Date.now()}`,
    },
  });

  const ledger = await prisma.ledger.create({
    data: {
      companyId: comp.id,
      name: "Sales Ledger",
      parent: "Sales Accounts",
      masterId: 9999,
      alterId: 1,
    },
  });

  // Deliberately create records where ID alphabetical order is completely inverted relative to date order!
  // Date 1: ID starts with "Z"
  // Date 2: ID starts with "A"
  // Date 3: ID starts with "Y"
  // Date 4: ID starts with "B"
  // Date 5: ID starts with "X"
  // Date 6: ID starts with "C"
  const records = [
    { id: "Z_voucher_1", date: new Date("2026-01-01"), masterId: 101, num: "VCH-01" },
    { id: "A_voucher_2", date: new Date("2026-01-02"), masterId: 102, num: "VCH-02" },
    { id: "Y_voucher_3", date: new Date("2026-01-03"), masterId: 103, num: "VCH-03" },
    { id: "B_voucher_4", date: new Date("2026-01-04"), masterId: 104, num: "VCH-04" },
    { id: "X_voucher_5", date: new Date("2026-01-05"), masterId: 105, num: "VCH-05" },
    { id: "C_voucher_6", date: new Date("2026-01-06"), masterId: 106, num: "VCH-06" },
  ];

  for (const r of records) {
    await prisma.voucher.create({
      data: {
        id: r.id,
        companyId: comp.id,
        masterId: r.masterId,
        alterId: 1,
        voucherNumber: r.num,
        voucherType: "Sales",
        date: r.date,
        amount: 100,
        voucherEntries: {
          create: [
            { ledgerId: ledger.id, amount: 100, type: "credit" },
          ],
        },
      },
    });
  }

  console.log("\n--- Testing Pagination with batch size = 2 ---");
  const BATCH_SIZE = 2;
  let cursor: string | undefined;
  const retrievedVouchers: string[] = [];
  let pageNum = 0;

  while (true) {
    pageNum++;
    console.log(`\nFetching Page ${pageNum} (cursor: ${cursor})...`);

    const batch = await prisma.voucher.findMany({
      where: { companyId: comp.id },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { date: "asc" },
        { id: "asc" },
      ],
    });

    console.log(`Page ${pageNum} returned ${batch.length} vouchers:`, batch.map(b => `${b.id} (${b.date.toISOString().slice(0, 10)})`));

    if (batch.length === 0) break;

    for (const v of batch) {
      retrievedVouchers.push(v.id);
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log("\n--- Results ---");
  console.log("Expected order:", records.map(r => r.id));
  console.log("Retrieved order:", retrievedVouchers);

  const missing = records.filter(r => !retrievedVouchers.includes(r.id));
  const duplicates = retrievedVouchers.filter((id, index) => retrievedVouchers.indexOf(id) !== index);

  console.log("Missing count:", missing.length, missing.map(m => m.id));
  console.log("Duplicate count:", duplicates.length, duplicates);

  // Cleanup
  await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId: comp.id } } });
  await prisma.voucher.deleteMany({ where: { companyId: comp.id } });
  await prisma.ledger.deleteMany({ where: { companyId: comp.id } });
  await prisma.company.deleteMany({ where: { id: comp.id } });
  await prisma.$disconnect();
  await pool.end();
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
