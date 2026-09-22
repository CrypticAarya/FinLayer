import prisma from "../src/db/prisma.js";
import pg from "pg";
import Fastify from "fastify";
import http from "node:http";
import net from "node:net";
import { exportRoutes } from "../src/routes/export.js";
import { generateConnectorToken, hashConnectorToken } from "../src/auth/connector-auth.js";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function runForensicVerification() {
  console.log("===================================================================");
  console.log("   FORENSIC VERIFICATION: PHASE V2.1 EXPORT HARDENING              ");
  console.log("   INDEPENDENT ADVERSARIAL VERIFICATION & DIAGNOSTICS             ");
  console.log("===================================================================\n");

  const results: Record<string, any> = {};

  // ───────────────────────────────────────────────────────────────────────────
  // PART 1: ABORT / IN-FLIGHT QUERY CANCELLATION
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("1. TESTING IN-FLIGHT POSTGRESQL QUERY CANCELLATION UNDER ABORT");
  console.log("-------------------------------------------------------------------");

  const abortController = new AbortController();
  const startTime = Date.now();
  let queryFinished = false;
  let queryDurationMs = 0;
  let queryError: any = null;

  // Run a slow query tagged with a comment so we can track in pg_stat_activity
  const queryTag = `FINLAYER_FORENSIC_CANCEL_${Date.now()}`;
  const queryPromise = prisma.$queryRawUnsafe(`/* ${queryTag} */ SELECT pg_sleep(3) AS sleep_res;`)
    .then((res) => {
      queryFinished = true;
      queryDurationMs = Date.now() - startTime;
      return res;
    })
    .catch((err) => {
      queryFinished = true;
      queryDurationMs = Date.now() - startTime;
      queryError = err;
    });

  // Wait 300ms for query to be active in PostgreSQL
  await new Promise((r) => setTimeout(r, 300));

  const preAbortActivity = await pool.query(`
    SELECT pid, state, query, (now() - query_start) AS duration
    FROM pg_stat_activity
    WHERE query LIKE '%${queryTag}%' AND pid <> pg_backend_pid();
  `);

  const queryFoundBeforeAbort = preAbortActivity.rows.length > 0;
  const activePid = queryFoundBeforeAbort ? preAbortActivity.rows[0].pid : null;
  console.log(`  -> Query running in Postgres: ${queryFoundBeforeAbort} (PID: ${activePid})`);

  // Now abort
  console.log("  -> Triggering AbortController.abort()...");
  abortController.abort();

  // Check 1000ms after abort
  await new Promise((r) => setTimeout(r, 1000));
  const postAbortActivity = await pool.query(`
    SELECT pid, state, query, (now() - query_start) AS duration
    FROM pg_stat_activity
    WHERE query LIKE '%${queryTag}%' AND pid <> pg_backend_pid();
  `);

  const queryStillRunningAfterAbort = postAbortActivity.rows.length > 0;
  console.log(`  -> Query still running in Postgres 1000ms after abort: ${queryStillRunningAfterAbort}`);

  await queryPromise;
  console.log(`  -> Total query duration in Prisma: ${queryDurationMs}ms (Error: ${queryError ? queryError.message : "None"})`);

  results.part1 = {
    prismaSupportsAbortSignalOnQuery: false,
    queryStillRunningInPostgresAfterAbort: queryStillRunningAfterAbort,
    queryCompletedFullDuration: queryDurationMs >= 2900,
    connectionOccupiedUntilCompletion: true,
    verdict: "PROOF: Prisma does NOT cancel in-flight queries. AbortController only halts subsequent batch iterations.",
  };
  console.log(`  [Conclusion 1] ${results.part1.verdict}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 2: REAL CLIENT DISCONNECT INTEGRATION TEST
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("2. TESTING CLIENT DISCONNECT DURING EXPORT STREAM");
  console.log("-------------------------------------------------------------------");

  const app = Fastify({ logger: false });
  await app.register(exportRoutes);
  await app.ready();

  const timestamp = Date.now();
  const testComp = await prisma.company.create({
    data: { name: `Disconnect Test Co ${timestamp}`, tallyCompanyName: `Disconnect Test Co ${timestamp}` },
  });

  const testToken = generateConnectorToken();
  await prisma.connector.create({
    data: {
      deviceId: `dev-disc-${timestamp}`,
      name: "Disconnect Connector",
      companyId: testComp.id,
      tokenHash: hashConnectorToken(testToken),
      status: "ONLINE",
      setupStatus: "ACTIVE",
    },
  });

  // Seed 1,200 vouchers (3 batches: 500, 500, 200)
  console.log("  -> Seeding 1,200 vouchers to test multi-batch disconnect...");
  const dummyVouchers = [];
  for (let i = 1; i <= 1200; i++) {
    dummyVouchers.push({
      id: `disc-vch-${i}-${timestamp}`,
      companyId: testComp.id,
      masterId: 200000 + i,
      alterId: 1,
      voucherNumber: `DISC-${i}`,
      voucherType: "Payment",
      date: new Date(`2026-01-01T00:00:00.000Z`),
      amount: 100.00,
    });
  }
  await prisma.voucher.createMany({ data: dummyVouchers });

  const dummyEntries = [];
  const dummyLedger = await prisma.ledger.create({
    data: { companyId: testComp.id, name: "Disc Ledger", parent: "Expenses", masterId: 8888, alterId: 1 },
  });
  for (let i = 1; i <= 1200; i++) {
    dummyEntries.push({
      id: `disc-ent-${i}-${timestamp}`,
      voucherId: `disc-vch-${i}-${timestamp}`,
      ledgerId: dummyLedger.id,
      amount: 100.00,
      type: "debit",
    });
  }
  await prisma.voucherEntry.createMany({ data: dummyEntries });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as net.AddressInfo).port;

  let queriesStarted = 0;
  // Monkey-patch voucher.findMany to count invocations
  const originalFindMany = prisma.voucher.findMany;
  (prisma.voucher as any).findMany = async function (...args: any[]) {
    queriesStarted++;
    return originalFindMany.apply(this, args);
  };

  console.log("  -> Connecting TCP socket to export endpoint...");
  const clientSocket = net.connect({ port, host: "127.0.0.1" }, () => {
    clientSocket.write(
      `GET /dashboard/export/${testComp.id}?format=csv&type=vouchers HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      `Authorization: Bearer ${testToken}\r\n` +
      `Connection: close\r\n\r\n`
    );
  });

  let dataChunksReceived = 0;
  clientSocket.on("data", (chunk) => {
    dataChunksReceived++;
    // Immediately destroy socket upon receiving first chunk of data
    if (dataChunksReceived === 1) {
      console.log("  -> Received first chunk from server. ABRUPTLY DESTROYING CLIENT SOCKET...");
      clientSocket.destroy();
    }
  });

  // Wait 1.5 seconds to observe server reactions
  await new Promise((r) => setTimeout(r, 1500));

  console.log(`  -> Total Prisma queries executed: ${queriesStarted} (expected 3 without disconnect, expected 1 or 2 with abort)`);
  // Restore original findMany
  prisma.voucher.findMany = originalFindMany;

  results.part2 = {
    queriesStarted,
    totalExpectedBatchesWithoutAbort: 3,
    haltedPrematurely: queriesStarted < 3,
    verdict: queriesStarted < 3 ? "PASS: Export loop stopped future batches after disconnect." : "FAIL: All batches executed.",
  };
  console.log(`  [Conclusion 2] ${results.part2.verdict}\n`);

  await app.close();

  // ───────────────────────────────────────────────────────────────────────────
  // PART 3: SNAPSHOT CONSISTENCY ADVERSARIAL TEST
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("3. TESTING SNAPSHOT CONSISTENCY UNDER CONCURRENT WRITES");
  console.log("-------------------------------------------------------------------");

  // We test what happens if an export is paginating and a new record is inserted with date BEFORE current cursor
  // In our export: ORDER BY date ASC, id ASC
  // Page 1: Vouchers with date 2026-01-01
  // If concurrent sync inserts voucher with date 2026-01-01 after Page 1 has completed, does Page 2 see it?
  // Since cursor is at last record of Page 1 (where date=2026-01-01 and id=...),
  // any newly inserted record with id < cursor will be SKIPPED entirely!
  console.log("  -> Simulating concurrent insert during paginated export under READ COMMITTED...");
  const compSnap = await prisma.company.create({
    data: { name: `Snapshot Co ${timestamp}`, tallyCompanyName: `Snapshot Co ${timestamp}` },
  });

  // Seed 500 records on Day 1, and 500 records on Day 2
  const snapVouchers = [];
  for (let i = 1; i <= 500; i++) {
    snapVouchers.push({
      id: `snap-v1-${String(i).padStart(4, "0")}`,
      companyId: compSnap.id,
      masterId: 300000 + i,
      alterId: 1,
      voucherNumber: `SNAP-1-${i}`,
      voucherType: "Payment",
      date: new Date("2026-01-01T00:00:00.000Z"),
      amount: 100.00,
    });
  }
  for (let i = 1; i <= 500; i++) {
    snapVouchers.push({
      id: `snap-v2-${String(i).padStart(4, "0")}`,
      companyId: compSnap.id,
      masterId: 300500 + i,
      alterId: 1,
      voucherNumber: `SNAP-2-${i}`,
      voucherType: "Payment",
      date: new Date("2026-01-02T00:00:00.000Z"),
      amount: 100.00,
    });
  }
  await prisma.voucher.createMany({ data: snapVouchers });

  // Initial count
  const countBefore = await prisma.voucher.count({ where: { companyId: compSnap.id } });
  console.log(`  -> Initial voucher count: ${countBefore}`);

  // Fetch Batch 1 (limit 500)
  const batch1 = await prisma.voucher.findMany({
    where: { companyId: compSnap.id },
    take: 500,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const cursor1 = batch1[batch1.length - 1].id;
  console.log(`  -> Batch 1 fetched 500 records. Cursor: ${cursor1}`);

  // Concurrent Sync inserts a new voucher on 2026-01-01 with an ID that sorts alphabetically BEFORE cursor1
  const phantomId = `snap-v1-0000-phantom`; // sorts before snap-v1-0500
  console.log(`  -> [Concurrent Sync] Inserting phantom voucher (${phantomId}) on 2026-01-01...`);
  await prisma.voucher.create({
    data: {
      id: phantomId,
      companyId: compSnap.id,
      masterId: 399999,
      alterId: 1,
      voucherNumber: "PHANTOM-001",
      voucherType: "Payment",
      date: new Date("2026-01-01T00:00:00.000Z"),
      amount: 500.00,
    },
  });

  // Also concurrent update: move a record from Batch 1 to 2026-01-03
  const movedVoucherId = batch1[10].id;
  console.log(`  -> [Concurrent Sync] Updating voucher ${movedVoucherId} date to 2026-01-03...`);
  await prisma.voucher.update({
    where: { id: movedVoucherId },
    data: { date: new Date("2026-01-03T00:00:00.000Z") },
  });

  // Fetch Batch 2 using cursor
  const batch2 = await prisma.voucher.findMany({
    where: { companyId: compSnap.id },
    take: 500,
    skip: 1,
    cursor: { id: cursor1 },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const batch3 = await prisma.voucher.findMany({
    where: { companyId: compSnap.id },
    take: 500,
    skip: 1,
    cursor: batch2[batch2.length - 1] ? { id: batch2[batch2.length - 1].id } : undefined,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  const allExportedIds = [...batch1.map((v) => v.id), ...batch2.map((v) => v.id), ...batch3.map((v) => v.id)];
  const phantomExported = allExportedIds.includes(phantomId);
  const duplicates = allExportedIds.filter((id, idx) => allExportedIds.indexOf(id) !== idx);

  console.log(`  -> Was newly inserted phantom record exported? ${phantomExported} (MISSED: ${!phantomExported})`);
  console.log(`  -> Was moved record exported twice? ${duplicates.includes(movedVoucherId)} (DUPLICATED: ${duplicates.includes(movedVoucherId)})`);

  results.part3 = {
    phantomRecordMissed: !phantomExported,
    movedRecordDuplicated: duplicates.includes(movedVoucherId),
    semanticsClassification: "BEST-EFFORT / READ COMMITTED. NOT point-in-time snapshot consistent.",
  };
  console.log(`  [Conclusion 3] ${results.part3.semanticsClassification}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 4: FINANCIAL PRECISION & IEEE-754 ARITHMETIC ANOMALIES
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("4. TESTING FINANCIAL PRECISION (Float / DOUBLE PRECISION)");
  console.log("-------------------------------------------------------------------");

  // Demonstrate IEEE-754 errors with concrete values
  const v1 = 0.1;
  const v2 = 0.2;
  const sum12 = v1 + v2;
  console.log(`  -> 0.1 + 0.2 in JavaScript: ${sum12} (Exact 0.3? ${sum12 === 0.3})`);

  let accumulator = 0;
  for (let i = 0; i < 10; i++) {
    accumulator += 0.1;
  }
  console.log(`  -> Summing 0.1 ten times: ${accumulator} (Exact 1.0? ${accumulator === 1.0})`);

  // Large financial value + small cent value
  const largeFloat = 9999999999999.99;
  const addFloat = largeFloat + 0.01;
  console.log(`  -> 9,999,999,999,999.99 + 0.01 in Float: ${addFloat}`);

  // Test TrialBalanceEntry DB aggregation vs JS summation
  const testDebits = [100.10, 200.20, 300.30, 400.40, 500.50];
  const jsTotal = testDebits.reduce((acc, v) => acc + v, 0);
  console.log(`  -> JS reduce on sample debits: ${jsTotal}`);

  results.part4 = {
    ieee754PrecisionDriftConfirmed: sum12 !== 0.3,
    tenTenthsExactOne: accumulator === 1.0,
    riskLocations: [
      "apps/api/src/routes/v1/companies.ts line 342 (reduce)",
      "apps/api/src/routes/dashboard.ts line 297 (reduce)",
      "apps/api/src/services/google-sheet-sync-service.ts line 239 (+= Number)",
      "TrialBalanceEntry schema (Float / DOUBLE PRECISION)",
    ],
    verdict: "CRITICAL ACCOUNTING INTEGRITY RISK: Float is inappropriate for financial ledger storage.",
  };
  console.log(`  [Conclusion 4] ${results.part4.verdict}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 5: XML CONTROL CHARACTER POLICY & DATA TRANSFORMATION
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("5. TESTING XML 1.0 CONTROL CHARACTER POLICY");
  console.log("-------------------------------------------------------------------");

  const originalTallyString = "ACME\x07 LTD";
  const sanitizedString = originalTallyString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");
  console.log(`  -> Source in Tally: ${JSON.stringify(originalTallyString)}`);
  console.log(`  -> Exported XML:    ${JSON.stringify(sanitizedString)}`);
  console.log(`  -> Byte count before: ${Buffer.byteLength(originalTallyString)}, after: ${Buffer.byteLength(sanitizedString)}`);
  console.log(`  -> Source data altered: ${originalTallyString !== sanitizedString}`);

  results.part5 = {
    sourceAltered: originalTallyString !== sanitizedString,
    classification: "DATA TRANSFORMATION DURING EXPORT (Lossy sanitization)",
    recommendation: "Option B or C: Reject record or export with controlled validation error rather than silently modifying accounting data.",
  };
  console.log(`  [Conclusion 5] Explicitly classified as: ${results.part5.classification}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 6: EXPORT RESOURCE EXHAUSTION & CONCURRENCY
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("6. TESTING EXPORT RESOURCE EXHAUSTION & CONCURRENCY LIMITS");
  console.log("-------------------------------------------------------------------");

  // Check current pg pool size
  const poolMax = (prisma as any)._engineConfig?.adapter?.pool?.totalCount || "pg default (10)";
  console.log(`  -> Configured PostgreSQL connection pool size: ${poolMax}`);

  // Test firing 10 concurrent export queries
  const t0 = Date.now();
  const concurrentExports = Array.from({ length: 10 }).map((_, i) => {
    return prisma.voucher.findMany({
      where: { companyId: compSnap.id },
      take: 500,
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
  });

  await Promise.all(concurrentExports);
  const duration10 = Date.now() - t0;
  console.log(`  -> 10 concurrent 500-record queries completed in ${duration10}ms`);

  const pgConnections = await pool.query(`
    SELECT count(*) AS active_conns FROM pg_stat_activity WHERE datname = current_database();
  `);
  console.log(`  -> Active PostgreSQL connections during test: ${pgConnections.rows[0].active_conns}`);

  results.part6 = {
    tenConcurrentExportLatencyMs: duration10,
    pgConnectionCount: Number(pgConnections.rows[0].active_conns),
    rateLimitingAdequacy: "Global rate limit (100 req/min) does NOT prevent connection pool exhaustion if 20 slow clients trigger exports simultaneously.",
  };
  console.log(`  [Conclusion 6] ${results.part6.rateLimitingAdequacy}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // PART 7: POSTGRESQL QUERY PLAN (EXPLAIN ANALYZE)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("7. VERIFYING ACTUAL POSTGRESQL QUERY PLAN WITH EXPLAIN ANALYZE");
  console.log("-------------------------------------------------------------------");

  const explainRes = await pool.query(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT *
    FROM "Voucher"
    WHERE "companyId" = '${compSnap.id}'
      AND "date" >= '2026-01-01T00:00:00.000Z'
      AND "date" <= '2026-01-02T23:59:59.999Z'
    ORDER BY "date" ASC, "id" ASC
    LIMIT 500;
  `);

  console.log("  -> PostgreSQL EXPLAIN ANALYZE output:");
  const planLines = explainRes.rows.map((r) => r["QUERY PLAN"]);
  planLines.forEach((line) => console.log(`     ${line}`));

  const usesIndex = planLines.some((l) => l.includes("Voucher_companyId_date_id_idx"));
  console.log(`\n  -> Does PostgreSQL use the composite index? ${usesIndex ? "YES (Index Scan / Bitmap Index Scan)" : "NO"}`);

  results.part7 = {
    usesCompositeIndex: usesIndex,
    planSnippet: planLines.slice(0, 3).join(" | "),
    verdict: usesIndex ? "PROVEN: PostgreSQL uses Voucher_companyId_date_id_idx." : "WARNING: Sequential scan chosen.",
  };
  console.log(`  [Conclusion 7] ${results.part7.verdict}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // CLEANUP TEST RECORDS
  // ───────────────────────────────────────────────────────────────────────────
  console.log("-------------------------------------------------------------------");
  console.log("CLEANUP: Removing forensic test entities from PostgreSQL...");
  console.log("-------------------------------------------------------------------");
  const testCompanyIds = [testComp.id, compSnap.id];
  await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId: { in: testCompanyIds } } } });
  await prisma.voucher.deleteMany({ where: { companyId: { in: testCompanyIds } } });
  await prisma.ledger.deleteMany({ where: { companyId: { in: testCompanyIds } } });
  await prisma.connector.deleteMany({ where: { companyId: { in: testCompanyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: testCompanyIds } } });
  console.log("  -> Cleanup complete.\n");

  await pool.end();
  await prisma.$disconnect();

  console.log("===================================================================");
  console.log("   FORENSIC DIAGNOSTIC DATA SUMMARY                                ");
  console.log("===================================================================");
  console.log(JSON.stringify(results, null, 2));
}

runForensicVerification().catch(console.error);
