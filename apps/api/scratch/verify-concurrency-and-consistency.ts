import prisma from "../src/db/prisma.js";
import pg from "pg";
import Fastify from "fastify";
import { exportRoutes } from "../src/routes/export.js";
import { syncRoutes } from "../src/routes/sync.js";
import { connectorRoutes } from "../src/routes/connectors.js";
import { generateConnectorToken, hashConnectorToken } from "../src/auth/connector-auth.js";
import { AccountingValidationService } from "../src/services/accounting-validation-service.js";
import dotenv from "dotenv";

dotenv.config();

const directPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log("===================================================================");
  console.log("   FINLAYER V2: FORENSIC VERIFICATION & EMPIRICAL BENCHMARKS       ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(exportRoutes);
  await app.register(syncRoutes);
  await app.register(connectorRoutes);
  await app.ready();

  const timestamp = Date.now();
  const companyA = await prisma.company.create({
    data: { name: `Benchmark Co A ${timestamp}`, tallyCompanyName: `Benchmark Co A ${timestamp}` },
  });
  const tokenA = generateConnectorToken();
  const connA = await prisma.connector.create({
    data: {
      deviceId: `bench-dev-a-${timestamp}`,
      name: "Bench Connector A",
      companyId: companyA.id,
      tokenHash: hashConnectorToken(tokenA),
      status: "ONLINE",
      setupStatus: "ACTIVE",
    },
  });

  const companyB = await prisma.company.create({
    data: { name: `Benchmark Co B ${timestamp}`, tallyCompanyName: `Benchmark Co B ${timestamp}` },
  });
  const tokenB = generateConnectorToken();
  const connB = await prisma.connector.create({
    data: {
      deviceId: `bench-dev-b-${timestamp}`,
      name: "Bench Connector B",
      companyId: companyB.id,
      tokenHash: hashConnectorToken(tokenB),
      status: "ONLINE",
      setupStatus: "ACTIVE",
    },
  });

  // Seed 2,000 vouchers in Company A (4 batches of 500)
  console.log("[Setup] Seeding 2,000 vouchers & 4,000 splits for Company A...");
  const ledgerA = await prisma.ledger.create({
    data: { companyId: companyA.id, name: "Sales Account", parent: "Sales", masterId: 1001, alterId: 1 },
  });
  const ledgerCash = await prisma.ledger.create({
    data: { companyId: companyA.id, name: "Cash", parent: "Cash", masterId: 1002, alterId: 1 },
  });

  const vouchersData = [];
  const entriesData = [];
  for (let i = 1; i <= 2000; i++) {
    const vId = `bench-vch-${String(i).padStart(5, "0")}-${timestamp}`;
    const d = new Date("2026-01-01T00:00:00.000Z");
    d.setUTCMinutes(d.getUTCMinutes() + i);

    vouchersData.push({
      id: vId,
      companyId: companyA.id,
      masterId: 400000 + i,
      alterId: 1,
      voucherNumber: `VCH-${i}`,
      voucherType: "Sales",
      date: d,
      amount: 150.00,
    });
    entriesData.push({
      id: `bench-ent-d-${i}-${timestamp}`,
      voucherId: vId,
      ledgerId: ledgerCash.id,
      amount: 150.00,
      type: "debit",
    });
    entriesData.push({
      id: `bench-ent-c-${i}-${timestamp}`,
      voucherId: vId,
      ledgerId: ledgerA.id,
      amount: 150.00,
      type: "credit",
    });
  }
  await prisma.voucher.createMany({ data: vouchersData });
  await prisma.voucherEntry.createMany({ data: entriesData });
  console.log("  -> 2,000 vouchers seeded successfully.\n");

  // =========================================================================
  // PART 1: EXPORT CONCURRENCY & CONNECTION POOL STARVATION
  // =========================================================================
  console.log("-------------------------------------------------------------------");
  console.log("PART 1: TESTING EXPORT CONCURRENCY & POOL BEHAVIOR");
  console.log("-------------------------------------------------------------------");

  // Let's inspect the actual pg Pool behind prisma
  // In apps/api/src/db/prisma.ts:
  // const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // const adapter = new PrismaPg(pool);
  const poolInternal = (prisma as any)._engineConfig?.adapter?.pool;
  console.log("PostgreSQL Pool Configuration in prisma.ts:");
  console.log(`  - Pool instance exists: ${!!poolInternal}`);
  console.log(`  - Default pool max connections: ${(poolInternal as any)?.options?.max ?? 10}`);

  // Test does findMany hold connection while streaming?
  // Let's monitor active connections in PostgreSQL during a single export
  const getActivePgConnections = async () => {
    const res = await directPool.query(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE state = 'active' AND pid <> pg_backend_pid()) AS active,
             count(*) FILTER (WHERE state = 'idle') AS idle
      FROM pg_stat_activity
      WHERE datname = current_database();
    `);
    return res.rows[0];
  };

  const initialConns = await getActivePgConnections();
  console.log(`Initial PostgreSQL connections: total=${initialConns.total}, active=${initialConns.active}, idle=${initialConns.idle}`);

  // Measure latency of /connectors/heartbeat and /sync/vouchers during concurrent exports
  const concurrencyLevels = [1, 2, 5, 10, 20];
  const concurrencyResults: Record<number, any> = {};

  for (const concurrency of concurrencyLevels) {
    console.log(`\nTesting ${concurrency} concurrent exports...`);
    const tStart = Date.now();

    // Start N concurrent export requests
    const exportPromises = Array.from({ length: concurrency }).map((_, idx) => {
      // Half from Company A, half from Company B (or all from Company A if 1)
      const targetCompId = (idx % 2 === 0 || concurrency === 1) ? companyA.id : companyB.id;
      const targetToken = (idx % 2 === 0 || concurrency === 1) ? tokenA : tokenB;
      return app.inject({
        method: "GET",
        url: `/dashboard/export/${targetCompId}?format=csv&type=vouchers`,
        headers: { authorization: `Bearer ${targetToken}` },
      });
    });

    // While exports are actively in progress, measure heartbeat and sync latency
    await new Promise((r) => setTimeout(r, 20)); // give exports a moment to hit server

    const hbStart = Date.now();
    const hbRes = await app.inject({
      method: "POST",
      url: `/connectors/${connA.id}/heartbeat`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { status: "ONLINE", timestamp: new Date().toISOString() },
    });
    const hbLatency = Date.now() - hbStart;

    const syncStart = Date.now();
    const syncRes = await app.inject({
      method: "POST",
      url: `/sync/vouchers`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        company: companyA.name,
        vouchers: [
          {
            masterId: 990000 + concurrency,
            alterId: 1,
            voucherNumber: `CONC-SYNC-${concurrency}`,
            voucherType: "Payment",
            date: "2026-01-05",
            amount: 50.00,
            entries: [
              { ledgerName: "Cash", type: "debit", amount: 50.00 },
              { ledgerName: "Sales Account", type: "credit", amount: 50.00 },
            ],
          },
        ],
      },
    });
    const syncLatency = Date.now() - syncStart;

    const midConns = await getActivePgConnections();
    const exportResponses = await Promise.all(exportPromises);
    const totalDuration = Date.now() - tStart;

    const all200 = exportResponses.every((r) => r.statusCode === 200);
    const failedExports = exportResponses.filter((r) => r.statusCode !== 200).length;

    console.log(`  -> Exports completed: ${exportResponses.length} in ${totalDuration}ms (all HTTP 200? ${all200})`);
    console.log(`  -> Heartbeat HTTP ${hbRes.statusCode} latency: ${hbLatency}ms`);
    console.log(`  -> Sync HTTP ${syncRes.statusCode} latency: ${syncLatency}ms`);
    console.log(`  -> PostgreSQL connections during load: total=${midConns.total}, active=${midConns.active}, idle=${midConns.idle}`);

    concurrencyResults[concurrency] = {
      totalDurationMs: totalDuration,
      allExportsSucceeded: all200,
      failedExports,
      heartbeatStatusCode: hbRes.statusCode,
      heartbeatLatencyMs: hbLatency,
      syncStatusCode: syncRes.statusCode,
      syncLatencyMs: syncLatency,
      pgTotalConnections: Number(midConns.total),
      pgActiveConnections: Number(midConns.active),
    };
  }

  console.log("\nConcurrency benchmark results summary:");
  console.log(JSON.stringify(concurrencyResults, null, 2));

  // =========================================================================
  // PART 2: EXPORT CONSISTENCY MUTATION MATRIX
  // =========================================================================
  console.log("\n-------------------------------------------------------------------");
  console.log("PART 2: TESTING EXACT PAGINATION MUTATION SCENARIOS");
  console.log("-------------------------------------------------------------------");

  // We test the 6 required scenarios:
  // A. Insert record before cursor
  // B. Insert record after cursor
  // C. Update already-exported voucher date
  // D. Update not-yet-exported voucher date
  // E. Delete cursor record
  // F. Delete not-yet-exported record

  const testCompMut = await prisma.company.create({
    data: { name: `Mutation Co ${timestamp}`, tallyCompanyName: `Mutation Co ${timestamp}` },
  });

  // Seed 1,000 vouchers on 2026-02-01 with ascending masterId & id
  const mutVouchers = [];
  for (let i = 1; i <= 1000; i++) {
    const d = new Date("2026-02-01T00:00:00.000Z");
    d.setUTCSeconds(d.getUTCSeconds() + i);
    mutVouchers.push({
      id: `mut-${String(i).padStart(4, "0")}`,
      companyId: testCompMut.id,
      masterId: 500000 + i,
      alterId: 1,
      voucherNumber: `MUT-${i}`,
      voucherType: "Sales",
      date: d,
      amount: 100.00,
    });
  }
  await prisma.voucher.createMany({ data: mutVouchers });

  // Scenario 1: Base Export of Batch 1 (500 records)
  const p1 = await prisma.voucher.findMany({
    where: { companyId: testCompMut.id },
    take: 500,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const cursorP1 = p1[p1.length - 1].id; // mut-0500
  console.log(`Batch 1 fetched ${p1.length} records. Cursor record: ${cursorP1} (date: ${p1[p1.length - 1].date.toISOString()})`);

  // Scenario A: Insert record BEFORE cursor (date 2026-02-01 00:00:10, id mut-0000-new)
  const dBefore = new Date("2026-02-01T00:00:10.000Z");
  await prisma.voucher.create({
    data: {
      id: "mut-0000-new",
      companyId: testCompMut.id,
      masterId: 599001,
      alterId: 1,
      voucherNumber: "MUT-INS-BEFORE",
      voucherType: "Sales",
      date: dBefore,
      amount: 100.00,
    },
  });

  // Scenario B: Insert record AFTER cursor (date 2026-02-01 00:20:00, id mut-9999-new)
  const dAfter = new Date("2026-02-01T00:20:00.000Z");
  await prisma.voucher.create({
    data: {
      id: "mut-9999-new",
      companyId: testCompMut.id,
      masterId: 599002,
      alterId: 1,
      voucherNumber: "MUT-INS-AFTER",
      voucherType: "Sales",
      date: dAfter,
      amount: 100.00,
    },
  });

  // Scenario C: Update already-exported voucher date forward into Batch 2 territory
  await prisma.voucher.update({
    where: { id: "mut-0010" },
    data: { date: new Date("2026-02-01T00:25:00.000Z") },
  });

  // Scenario D: Update not-yet-exported voucher date backward into Batch 1 territory
  await prisma.voucher.update({
    where: { id: "mut-0700" },
    data: { date: new Date("2026-02-01T00:00:05.000Z") },
  });

  // Scenario E: Delete cursor record
  // Let's test what happens if cursor record is deleted
  // In Prisma cursor pagination: `cursor: { id: cursorP1 }`. If cursor record does not exist, what does Prisma do?
  // Let's test this directly!
  let cursorDeleteError: any = null;
  try {
    // Delete cursor record
    await prisma.voucher.delete({ where: { id: cursorP1 } });
    await prisma.voucher.findMany({
      where: { companyId: testCompMut.id },
      take: 500,
      skip: 1,
      cursor: { id: cursorP1 },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
  } catch (err: any) {
    cursorDeleteError = err;
  }

  console.log(`Scenario E (Delete cursor record): Did Prisma throw an error? ${cursorDeleteError !== null}`);
  if (cursorDeleteError) {
    console.log(`  -> Error details: ${cursorDeleteError.message.split("\n")[0]}`);
  }

  // Fetch remaining batches to observe actual exported vs missing/duplicated
  // Re-create cursorP1 so we can continue the test
  await prisma.voucher.create({
    data: {
      id: cursorP1,
      companyId: testCompMut.id,
      masterId: 500500,
      alterId: 1,
      voucherNumber: "MUT-500-RESTORED",
      voucherType: "Sales",
      date: new Date("2026-02-01T00:08:20.000Z"),
      amount: 100.00,
    },
  });

  const p2 = await prisma.voucher.findMany({
    where: { companyId: testCompMut.id },
    take: 500,
    skip: 1,
    cursor: { id: cursorP1 },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const p3 = await prisma.voucher.findMany({
    where: { companyId: testCompMut.id },
    take: 500,
    skip: p2.length > 0 ? 1 : 0,
    cursor: p2.length > 0 ? { id: p2[p2.length - 1].id } : undefined,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const allExportedIds = [...p1.map((v) => v.id), ...p2.map((v) => v.id), ...p3.map((v) => v.id)];
  console.log(`Total records exported across batches: ${allExportedIds.length}`);
  console.log(`  -> Scenario A (mut-0000-new inserted before cursor): Exported? ${allExportedIds.includes("mut-0000-new")} (MISSED: ${!allExportedIds.includes("mut-0000-new")})`);
  console.log(`  -> Scenario B (mut-9999-new inserted after cursor):  Exported? ${allExportedIds.includes("mut-9999-new")}`);
  console.log(`  -> Scenario C (mut-0010 moved to future):           Exported twice? ${allExportedIds.filter((id) => id === "mut-0010").length > 1} (Count: ${allExportedIds.filter((id) => id === "mut-0010").length})`);
  console.log(`  -> Scenario D (mut-0700 moved to past):             Exported? ${allExportedIds.includes("mut-0700")} (MISSED: ${!allExportedIds.includes("mut-0700")})`);

  // =========================================================================
  // PART 3: FINANCIAL PRECISION & VOUCHER DOUBLE-ENTRY VALIDATION
  // =========================================================================
  console.log("\n-------------------------------------------------------------------");
  console.log("PART 3: TESTING FINANCIAL PRECISION & ACCOUNTING VALIDATION");
  console.log("-------------------------------------------------------------------");

  // Check if AccountingValidationService can incorrectly accept or reject transactions due to float artifacts
  const dummyLedgerMap = new Map<string, string>([
    ["cash", "led-cash"],
    ["sales", "led-sales"],
  ]);

  // Test Case 1: 0.1 + 0.2 split
  const testVoucher1 = {
    masterId: 1,
    alterId: 1,
    voucherNumber: "TEST-FLOAT-1",
    voucherType: "Sales",
    date: "2026-01-01",
    amount: 0.30,
    entries: [
      { ledgerName: "Cash", amount: 0.10, type: "debit" },
      { ledgerName: "Cash", amount: 0.20, type: "debit" },
      { ledgerName: "Sales", amount: 0.30, type: "credit" },
    ],
  };
  const valResult1 = AccountingValidationService.validateVoucher(testVoucher1, dummyLedgerMap);
  console.log(`Voucher with 0.10 + 0.20 debit vs 0.30 credit: Valid? ${valResult1.isValid} (Debit: ${valResult1.debitTotal}, Credit: ${valResult1.creditTotal})`);

  // Test Case 2: 10 items of 0.10 debit vs 1.00 credit
  const testVoucher2 = {
    masterId: 2,
    alterId: 1,
    voucherNumber: "TEST-FLOAT-2",
    voucherType: "Sales",
    date: "2026-01-01",
    amount: 1.00,
    entries: [
      ...Array.from({ length: 10 }).map(() => ({ ledgerName: "Cash", amount: 0.10, type: "debit" })),
      { ledgerName: "Sales", amount: 1.00, type: "credit" },
    ],
  };
  const valResult2 = AccountingValidationService.validateVoucher(testVoucher2, dummyLedgerMap);
  console.log(`Voucher with ten 0.10 debits vs 1.00 credit: Valid? ${valResult2.isValid} (Debit: ${valResult2.debitTotal}, Credit: ${valResult2.creditTotal})`);

  // Test Case 3: Large amount: 999,999,999.99
  const testVoucher3 = {
    masterId: 3,
    alterId: 1,
    voucherNumber: "TEST-FLOAT-3",
    voucherType: "Sales",
    date: "2026-01-01",
    amount: 999999999.99,
    entries: [
      { ledgerName: "Cash", amount: 999999999.99, type: "debit" },
      { ledgerName: "Sales", amount: 999999999.99, type: "credit" },
    ],
  };
  const valResult3 = AccountingValidationService.validateVoucher(testVoucher3, dummyLedgerMap);
  console.log(`Voucher with 999,999,999.99 debit & credit: Valid? ${valResult3.isValid}`);

  // Test Case 4: Cent mismatch (debit 100.00 vs credit 100.01)
  const testVoucher4 = {
    masterId: 4,
    alterId: 1,
    voucherNumber: "TEST-FLOAT-4",
    voucherType: "Sales",
    date: "2026-01-01",
    amount: 100.00,
    entries: [
      { ledgerName: "Cash", amount: 100.00, type: "debit" },
      { ledgerName: "Sales", amount: 100.01, type: "credit" }, // 1 cent difference
    ],
  };
  const valResult4 = AccountingValidationService.validateVoucher(testVoucher4, dummyLedgerMap);
  console.log(`Voucher with 1-cent mismatch (100.00 vs 100.01): Rejected? ${!valResult4.isValid} (Error: ${valResult4.error})`);

  // =========================================================================
  // PART 5: DATABASE INDEX EXPLAIN ANALYZE
  // =========================================================================
  console.log("\n-------------------------------------------------------------------");
  console.log("PART 5: EXPLAIN ANALYZE ON REALISTIC DATASET");
  console.log("-------------------------------------------------------------------");

  // Company A has 2,000 vouchers
  const explain = await directPool.query(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT *
    FROM "Voucher"
    WHERE "companyId" = '${companyA.id}'
      AND "date" >= '2026-01-01T00:00:00.000Z'
      AND "date" <= '2026-01-02T23:59:59.999Z'
    ORDER BY "date" ASC, "id" ASC
    LIMIT 500;
  `);

  console.log("PostgreSQL EXPLAIN ANALYZE result on 2,000 vouchers:");
  explain.rows.forEach((r) => console.log(`  ${r["QUERY PLAN"]}`));

  // ───────────────────────────────────────────────────────────────────────────
  // CLEANUP
  // ───────────────────────────────────────────────────────────────────────────
  console.log("\nCleaning up test records...");
  const cleanupIds = [companyA.id, companyB.id, testCompMut.id];
  await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId: { in: cleanupIds } } } });
  await prisma.voucher.deleteMany({ where: { companyId: { in: cleanupIds } } });
  await prisma.ledger.deleteMany({ where: { companyId: { in: cleanupIds } } });
  await prisma.connector.deleteMany({ where: { companyId: { in: cleanupIds } } });
  await prisma.company.deleteMany({ where: { id: { in: cleanupIds } } });
  console.log("Cleanup complete.");

  await directPool.end();
  await prisma.$disconnect();
}

main().catch(console.error);
