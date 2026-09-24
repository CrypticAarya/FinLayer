#!/usr/bin/env tsx
import prisma from "../db/prisma.js";

async function main() {
  console.log("--------------------------------------------------");
  console.log("Checking Neon PostgreSQL Production Database...");
  console.log("--------------------------------------------------");

  // 1. Query PostgreSQL information_schema tables
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;

  console.log(`Found ${tables.length} tables in public schema:`);
  for (const t of tables) {
    console.log(`  ✓ ${t.table_name}`);
  }

  // 2. Test model query counts
  const [
    companies,
    connectors,
    heartbeats,
    ledgers,
    vouchers,
    voucherEntries,
    trialBalanceEntries,
    syncRuns,
    syncAuditLogs,
    apiKeys
  ] = await Promise.all([
    prisma.company.count(),
    prisma.connector.count(),
    prisma.connectorHeartbeat.count(),
    prisma.ledger.count(),
    prisma.voucher.count(),
    prisma.voucherEntry.count(),
    prisma.trialBalanceEntry.count(),
    prisma.syncRun.count(),
    prisma.syncAuditLog.count(),
    prisma.apiKey.count()
  ]);

  console.log("\nTable Row Counts (Fresh Production Database):");
  console.log({
    Company: companies,
    Connector: connectors,
    ConnectorHeartbeat: heartbeats,
    Ledger: ledgers,
    Voucher: vouchers,
    VoucherEntry: voucherEntries,
    TrialBalanceEntry: trialBalanceEntries,
    SyncRun: syncRuns,
    SyncAuditLog: syncAuditLogs,
    ApiKey: apiKeys
  });

  console.log("\n--------------------------------------------------");
  console.log("✅ Neon Database Connection & Schema Verification: SUCCESS!");
  console.log("--------------------------------------------------");
}

main()
  .catch((err) => {
    console.error("❌ Verification failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
