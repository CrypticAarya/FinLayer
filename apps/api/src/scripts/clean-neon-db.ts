#!/usr/bin/env tsx
import prisma from "../db/prisma.js";

async function main() {
  console.log("Cleaning test records from database...");
  await prisma.syncAuditLog.deleteMany({});
  await prisma.voucherEntry.deleteMany({});
  await prisma.voucher.deleteMany({});
  await prisma.syncRun.deleteMany({});
  await prisma.syncJob.deleteMany({});
  await prisma.syncLog.deleteMany({});
  await prisma.syncHistory.deleteMany({});
  await prisma.trialBalanceEntry.deleteMany({});
  await prisma.ledger.deleteMany({});
  await prisma.connectorHeartbeat.deleteMany({});
  await prisma.connector.deleteMany({});
  await prisma.saasCompanyMapping.deleteMany({});
  await prisma.apiKey.deleteMany({});
  await prisma.company.deleteMany({});
  console.log("✅ Database reset cleanly: 0 rows in all entity tables.");
}

main()
  .catch((err) => {
    console.error("Clean error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
