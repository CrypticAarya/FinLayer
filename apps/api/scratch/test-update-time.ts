import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
  const comp = await prisma.company.create({ data: { name: "CompT", tallyCompanyName: "CompT" } });
  const v = await prisma.voucher.create({
    data: {
      companyId: comp.id,
      masterId: 1,
      alterId: 1,
      voucherNumber: "V1",
      voucherType: "Sales",
      date: new Date("2026-01-01"),
      amount: 10,
    },
  });

  const exportStart = new Date();
  console.log("exportStart:", exportStart.toISOString());

  await new Promise((r) => setTimeout(r, 100));

  const updated = await prisma.voucher.update({
    where: { id: v.id },
    data: { amount: 20 },
  });
  console.log("updatedAt:", updated.updatedAt.toISOString());
  console.log("updatedAt > exportStart:", updated.updatedAt > exportStart);

  const results = await prisma.voucher.findMany({
    where: { companyId: comp.id, updatedAt: { lte: exportStart } },
  });
  console.log("Found with lte exportStart:", results.length);

  await prisma.voucher.deleteMany({ where: { companyId: comp.id } });
  await prisma.company.deleteMany({ where: { id: comp.id } });
  await prisma.$disconnect();
  await pool.end();
}

check().catch(console.error);
