import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { syncRoutes } from "../src/routes/sync.js";
import { exportRoutes } from "../src/routes/export.js";
import { generateConnectorToken, hashConnectorToken } from "../src/auth/connector-auth.js";
import prisma from "../src/db/prisma.js";
// @ts-ignore
import { XMLParser, XMLValidator } from "../../connector/node_modules/fast-xml-parser/src/fxp.js";

async function runTrialBalanceAtomicityTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: TRIAL BALANCE ATOMIC REPLACEMENT & SAFETY SUITE   ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(syncRoutes);
  await app.register(exportRoutes);
  await app.ready();

  const timestamp = Date.now();
  const testCompanyName = `TB Atomicity Co ${timestamp}`;
  let companyId: string;
  let testConnectorId: string;
  let authToken: string;

  // For tenant isolation test
  const tenantBName = `TB Tenant B Co ${timestamp}`;
  let companyBId: string;
  let authTokenB: string;

  try {
    // ── Setup: Test Company & Authenticated Connector ──────────────────────────
    console.log(`[Setup] Creating test company: "${testCompanyName}"...`);
    const company = await prisma.company.create({
      data: {
        name: testCompanyName,
        tallyCompanyName: testCompanyName,
      },
    });
    companyId = company.id;

    authToken = generateConnectorToken();
    const tokenHash = hashConnectorToken(authToken);
    const connector = await prisma.connector.create({
      data: {
        deviceId: `dev-tb-atom-${timestamp}`,
        name: "Trial Balance Atomicity Connector",
        companyId,
        tallyCompanyName: testCompanyName,
        tokenHash,
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    testConnectorId = connector.id;

    const authHeaders = { authorization: `Bearer ${authToken}` };

    // Setup Company B for tenant isolation testing
    const companyB = await prisma.company.create({
      data: { name: tenantBName, tallyCompanyName: tenantBName },
    });
    companyBId = companyB.id;
    authTokenB = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-tb-b-${timestamp}`,
        name: "Trial Balance Connector B",
        companyId: companyBId,
        tallyCompanyName: tenantBName,
        tokenHash: hashConnectorToken(authTokenB),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    const authHeadersB = { authorization: `Bearer ${authTokenB}` };

    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

    // =========================================================================
    // TEST 1 — NORMAL REPLACEMENT (STALE RECORD PRUNING)
    // =========================================================================
    console.log("[Test 1] Testing Normal Replacement & Stale Record Pruning...");

    // Dataset A: Cash, Bank, Sales, Loan
    const datasetA = [
      { ledgerName: "Cash", groupName: "Current Assets", debitAmount: 1000.0, creditAmount: 0 },
      { ledgerName: "Bank", groupName: "Bank Accounts", debitAmount: 2000.0, creditAmount: 0 },
      { ledgerName: "Sales", groupName: "Sales Accounts", debitAmount: 0, creditAmount: 1500.0 },
      { ledgerName: "Loan", groupName: "Secured Loans", debitAmount: 0, creditAmount: 1500.0 },
    ];

    const resA = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeaders,
      payload: { company: testCompanyName, trialBalance: datasetA },
    });
    assert.strictEqual(resA.statusCode, 200, "Dataset A sync must return 200");

    const dbA = await prisma.trialBalanceEntry.findMany({ where: { companyId } });
    assert.strictEqual(dbA.length, 4, "Dataset A must store exactly 4 records");

    // Dataset B: Cash, Bank, Sales (Loan intentionally omitted/settled)
    const datasetB = [
      { ledgerName: "Cash", groupName: "Current Assets", debitAmount: 1200.0, creditAmount: 0 },
      { ledgerName: "Bank", groupName: "Bank Accounts", debitAmount: 1800.0, creditAmount: 0 },
      { ledgerName: "Sales", groupName: "Sales Accounts", debitAmount: 0, creditAmount: 3000.0 },
    ];

    const resB = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeaders,
      payload: { company: testCompanyName, trialBalance: datasetB },
    });
    assert.strictEqual(resB.statusCode, 200, "Dataset B sync must return 200");

    // Verification:
    const dbB = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      orderBy: { ledgerName: "asc" },
    });

    assert.strictEqual(dbB.length, 3, "After Dataset B, database must contain exactly 3 rows");
    const loanEntry = dbB.find((r) => r.ledgerName === "Loan");
    assert.strictEqual(loanEntry, undefined, "Loan must NOT exist in database after Dataset B sync");

    const cashEntry = dbB.find((r) => r.ledgerName === "Cash");
    assert.ok(cashEntry, "Cash must exist");
    assert.strictEqual(cashEntry.debitAmount, 1200.0, "Cash debit must be 1200.00");

    const bankEntry = dbB.find((r) => r.ledgerName === "Bank");
    assert.ok(bankEntry, "Bank must exist");
    assert.strictEqual(bankEntry.debitAmount, 1800.0, "Bank debit must be 1800.00");

    const salesEntry = dbB.find((r) => r.ledgerName === "Sales");
    assert.ok(salesEntry, "Sales must exist");
    assert.strictEqual(salesEntry.creditAmount, 3000.0, "Sales credit must be 3000.00");

    // Verify CSV Export does NOT contain Loan
    const csvExport = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyId}?format=csv&type=trial-balance`,
      headers: authHeaders,
    });
    assert.strictEqual(csvExport.statusCode, 200);
    assert.ok(!csvExport.body.includes("Loan"), "CSV export must NOT contain Loan");
    const csvDataLines = csvExport.body.trim().split("\r\n").slice(1);
    assert.strictEqual(csvDataLines.length, 3, "CSV export must have exactly 3 data rows");

    // Verify XML Export does NOT contain Loan
    const xmlExport = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyId}?format=xml&type=trial-balance`,
      headers: authHeaders,
    });
    assert.strictEqual(xmlExport.statusCode, 200);
    assert.strictEqual(XMLValidator.validate(xmlExport.body), true);
    assert.ok(!xmlExport.body.includes("Loan"), "XML export must NOT contain Loan");
    const parsedXml = xmlParser.parse(xmlExport.body);
    assert.strictEqual(parseInt(parsedXml.FINLAYER_EXPORT.TRIAL_BALANCE["@_count"], 10), 3);

    console.log("  ✔ Test 1 Passed: Normal replacement verified. Stale records pruned, zero phantom records in DB, CSV, or XML.\n");

    // =========================================================================
    // TEST 2 — EMPTY PAYLOAD PROTECTION
    // =========================================================================
    console.log("[Test 2] Testing Empty Payload Protection (trialBalance: [])...");

    // Capture state before empty payload attempt
    const preEmptyRows = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      orderBy: { ledgerName: "asc" },
    });
    assert.strictEqual(preEmptyRows.length, 3);

    const emptyRes = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeaders,
      payload: { company: testCompanyName, trialBalance: [] },
    });

    // Must be rejected with 4xx validation response
    assert.strictEqual(emptyRes.statusCode, 400, "Empty trialBalance payload must be rejected with 400");

    // Verify existing rows, balances, CSV, and XML remain completely unchanged
    const postEmptyRows = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      orderBy: { ledgerName: "asc" },
    });
    assert.strictEqual(postEmptyRows.length, 3, "Row count must remain unchanged at 3");
    assert.deepStrictEqual(
      postEmptyRows.map((r) => ({ name: r.ledgerName, dr: r.debitAmount, cr: r.creditAmount })),
      preEmptyRows.map((r) => ({ name: r.ledgerName, dr: r.debitAmount, cr: r.creditAmount })),
      "All balances must remain unchanged"
    );

    const postEmptyCsv = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyId}?format=csv&type=trial-balance`,
      headers: authHeaders,
    });
    assert.strictEqual(postEmptyCsv.body.trim().split("\r\n").slice(1).length, 3);

    console.log("  ✔ Test 2 Passed: Empty payload safely rejected with 400. Existing trial balance preserved 100%.\n");

    // =========================================================================
    // TEST 3 — MID-TRANSACTION FAILURE (ROLLBACK VERIFICATION)
    // =========================================================================
    console.log("[Test 3] Testing Mid-Transaction Failure Rollback...");

    // Initial baseline: Dataset A (Cash, Bank, Sales)
    const baselineRows = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      orderBy: { ledgerName: "asc" },
    });
    assert.strictEqual(baselineRows.length, 3);

    // Attempt Dataset with a faulty ledger name triggering PostgreSQL encoding error (code 22021)
    const faultyPayload = [
      { ledgerName: "Cash New", groupName: "Current Assets", debitAmount: 9000, creditAmount: 0 },
      { ledgerName: "Faulty\u0000Ledger", groupName: "Current Assets", debitAmount: 100, creditAmount: 0 },
      { ledgerName: "Never Inserted", groupName: "Current Assets", debitAmount: 200, creditAmount: 0 },
    ];

    const failRes = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeaders,
      payload: { company: testCompanyName, trialBalance: faultyPayload },
    });

    assert.strictEqual(failRes.statusCode, 500, "Database failure must return 500");

    // Verify Dataset A remains completely intact after transaction rollback
    const postFailureRows = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      orderBy: { ledgerName: "asc" },
    });

    assert.strictEqual(postFailureRows.length, 3, "Row count must equal Dataset A (3)");
    assert.strictEqual(postFailureRows.find((r) => r.ledgerName === "Cash")?.debitAmount, 1200.0);
    assert.strictEqual(postFailureRows.find((r) => r.ledgerName === "Cash New"), undefined);
    assert.strictEqual(postFailureRows.find((r) => r.ledgerName.includes("Faulty")), undefined);
    assert.strictEqual(postFailureRows.find((r) => r.ledgerName === "Never Inserted"), undefined);

    console.log("  ✔ Test 3 Passed: Mid-transaction failure cleanly rolled back. Zero partial or orphan records.\n");

    // =========================================================================
    // TEST 4 — ACCOUNTING TOTALS VERIFICATION
    // =========================================================================
    console.log("[Test 4] Verifying Accounting Totals...");

    // Ingest a comprehensive balanced dataset
    const totalsDataset = [
      { ledgerName: "Cash", groupName: "Current Assets", debitAmount: 5500.25, creditAmount: 0.0 },
      { ledgerName: "Bank", groupName: "Bank Accounts", debitAmount: 4499.75, creditAmount: 0.0 },
      { ledgerName: "Sales", groupName: "Sales Accounts", debitAmount: 0.0, creditAmount: 8000.0 },
      { ledgerName: "Rent", groupName: "Indirect Expenses", debitAmount: 2000.0, creditAmount: 0.0 },
      { ledgerName: "Capital", groupName: "Capital Account", debitAmount: 0.0, creditAmount: 4000.0 },
    ];
    // Expected: Debit total = 5500.25 + 4499.75 + 2000.0 = 12000.00
    // Expected: Credit total = 8000.0 + 4000.0 = 12000.00

    const totalsRes = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeaders,
      payload: { company: testCompanyName, trialBalance: totalsDataset },
    });
    assert.strictEqual(totalsRes.statusCode, 200);

    const totalsDb = await prisma.trialBalanceEntry.findMany({ where: { companyId } });
    const sumDebit = totalsDb.reduce((acc, r) => acc + r.debitAmount, 0);
    const sumCredit = totalsDb.reduce((acc, r) => acc + r.creditAmount, 0);

    assert.strictEqual(sumDebit.toFixed(2), "12000.00", "Sum of debitAmount must be 12000.00");
    assert.strictEqual(sumCredit.toFixed(2), "12000.00", "Sum of creditAmount must be 12000.00");

    // Verify XML totals header
    const totalsXmlRes = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyId}?format=xml&type=trial-balance`,
      headers: authHeaders,
    });
    const parsedTotalsXml = xmlParser.parse(totalsXmlRes.body);
    const tbHeader = parsedTotalsXml.FINLAYER_EXPORT.TRIAL_BALANCE;
    assert.strictEqual(tbHeader["@_debitTotal"], "12000.00");
    assert.strictEqual(tbHeader["@_creditTotal"], "12000.00");

    console.log("  ✔ Test 4 Passed: Accounting debit/credit totals strictly match expected financial figures.\n");

    // =========================================================================
    // TEST 5 — TENANT ISOLATION
    // =========================================================================
    console.log("[Test 5] Verifying Strict Tenant Isolation...");

    // Company A has 5 ledgers (totalsDataset)
    // Company B seeds: Cash (500 Dr), Loan (500 Cr)
    const datasetCompB = [
      { ledgerName: "Cash", groupName: "Current Assets", debitAmount: 500.0, creditAmount: 0.0 },
      { ledgerName: "Loan", groupName: "Loans", debitAmount: 0.0, creditAmount: 500.0 },
    ];

    const syncB1 = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeadersB,
      payload: { company: tenantBName, trialBalance: datasetCompB },
    });
    assert.strictEqual(syncB1.statusCode, 200);

    // Verify Company B has 2 rows
    const compBRows = await prisma.trialBalanceEntry.findMany({ where: { companyId: companyBId } });
    assert.strictEqual(compBRows.length, 2);

    // Sync Company A with a new dataset of 2 ledgers
    const datasetCompA2 = [
      { ledgerName: "Cash", groupName: "Current Assets", debitAmount: 100.0, creditAmount: 0.0 },
      { ledgerName: "Revenue", groupName: "Sales", debitAmount: 0.0, creditAmount: 100.0 },
    ];
    const syncA2 = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeaders,
      payload: { company: testCompanyName, trialBalance: datasetCompA2 },
    });
    assert.strictEqual(syncA2.statusCode, 200);

    // Verify Company B was completely untouched!
    const postSyncBRows = await prisma.trialBalanceEntry.findMany({
      where: { companyId: companyBId },
      orderBy: { ledgerName: "asc" },
    });
    assert.strictEqual(postSyncBRows.length, 2, "Company B must still have exactly 2 rows");
    assert.strictEqual(postSyncBRows.find((r) => r.ledgerName === "Cash")?.debitAmount, 500.0);
    assert.strictEqual(postSyncBRows.find((r) => r.ledgerName === "Loan")?.creditAmount, 500.0);

    // Sync Company B with 1 ledger (Cash only, Loan settled)
    const datasetCompB2 = [
      { ledgerName: "Cash", groupName: "Current Assets", debitAmount: 700.0, creditAmount: 0.0 },
    ];
    const syncB2 = await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeadersB,
      payload: { company: tenantBName, trialBalance: datasetCompB2 },
    });
    assert.strictEqual(syncB2.statusCode, 200);

    // Verify Company A was completely untouched!
    const postSyncARows = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      orderBy: { ledgerName: "asc" },
    });
    assert.strictEqual(postSyncARows.length, 2, "Company A must still have exactly 2 rows");
    assert.strictEqual(postSyncARows.find((r) => r.ledgerName === "Cash")?.debitAmount, 100.0);
    assert.strictEqual(postSyncARows.find((r) => r.ledgerName === "Revenue")?.creditAmount, 100.0);

    console.log("  ✔ Test 5 Passed: Cross-tenant isolation verified. Zero deletion or bleeding between tenants.\n");

    // =========================================================================
    // TEST 6 — CONCURRENT EXPORT INTEGRITY (25 RACE ITERATIONS)
    // =========================================================================
    console.log("[Test 6] Running Concurrent Export Test (25 Race Iterations)...");

    const concLedgers = Array.from({ length: 15 }).map((_, i) => `Ledger-Conc-${String(i + 1).padStart(2, "0")}`);
    
    // State 1: 15 rows with 100.00 each
    const state1 = concLedgers.map((name) => ({
      ledgerName: name,
      groupName: "Group 1",
      debitAmount: 100.0,
      creditAmount: 100.0,
    }));

    // State 2: 15 rows with 250.00 each
    const state2 = concLedgers.map((name) => ({
      ledgerName: name,
      groupName: "Group 2",
      debitAmount: 250.0,
      creditAmount: 250.0,
    }));

    // Seed State 1
    await app.inject({
      method: "POST",
      url: "/sync/trial-balance",
      headers: authHeaders,
      payload: { company: testCompanyName, trialBalance: state1 },
    });

    const totalRaces = 25;
    for (let i = 1; i <= totalRaces; i++) {
      const targetState = i % 2 === 0 ? state1 : state2;

      // Trigger sync and exports concurrently
      const syncPromise = app.inject({
        method: "POST",
        url: "/sync/trial-balance",
        headers: authHeaders,
        payload: { company: testCompanyName, trialBalance: targetState },
      });

      const csvPromise = app.inject({
        method: "GET",
        url: `/dashboard/export/${companyId}?format=csv&type=trial-balance`,
        headers: authHeaders,
      });

      const xmlPromise = app.inject({
        method: "GET",
        url: `/dashboard/export/${companyId}?format=xml&type=trial-balance`,
        headers: authHeaders,
      });

      const [sRes, csvRes, xmlRes] = await Promise.all([syncPromise, csvPromise, xmlPromise]);

      assert.strictEqual(sRes.statusCode, 200);
      assert.strictEqual(csvRes.statusCode, 200);
      assert.strictEqual(xmlRes.statusCode, 200);

      // 1. Verify CSV coherence
      const csvLines = csvRes.body.trim().split("\r\n").slice(1);
      assert.strictEqual(csvLines.length, 15, `CSV iteration ${i}: must have 15 rows`);
      const firstDebit = parseFloat(csvLines[0].split(",")[4]);
      assert.ok(firstDebit === 100.0 || firstDebit === 250.0);

      for (const line of csvLines) {
        const debit = parseFloat(line.split(",")[4]);
        assert.strictEqual(
          debit,
          firstDebit,
          `CSV iteration ${i}: Detected mixed state! Expected ${firstDebit}, found ${debit}`
        );
      }

      // 2. Verify XML coherence
      const parsedXmlRes = xmlParser.parse(xmlRes.body);
      const tbNode = parsedXmlRes.FINLAYER_EXPORT.TRIAL_BALANCE;
      const count = parseInt(tbNode["@_count"], 10);
      const hdrDebit = parseFloat(tbNode["@_debitTotal"]);
      const hdrCredit = parseFloat(tbNode["@_creditTotal"]);
      assert.strictEqual(count, 15);

      const entries = Array.isArray(tbNode.ENTRY) ? tbNode.ENTRY : [tbNode.ENTRY];
      assert.strictEqual(entries.length, 15);

      let sumDr = 0;
      let sumCr = 0;
      const firstXmlDr = parseFloat(entries[0]["@_debitAmount"]);
      assert.ok(firstXmlDr === 100.0 || firstXmlDr === 250.0);

      for (const ent of entries) {
        const d = parseFloat(ent["@_debitAmount"]);
        const c = parseFloat(ent["@_creditAmount"]);
        sumDr += d;
        sumCr += c;
        assert.strictEqual(
          d,
          firstXmlDr,
          `XML iteration ${i}: Detected mixed XML entries! Expected ${firstXmlDr}, found ${d}`
        );
      }

      assert.strictEqual(
        hdrDebit.toFixed(2),
        sumDr.toFixed(2),
        `XML iteration ${i}: Header debitTotal (${hdrDebit}) !== sum of entries (${sumDr})`
      );
      assert.strictEqual(
        hdrCredit.toFixed(2),
        sumCr.toFixed(2),
        `XML iteration ${i}: Header creditTotal (${hdrCredit}) !== sum of entries (${sumCr})`
      );
    }

    console.log("  ✔ Test 6 Passed: 25 concurrent sync & export races passed with zero tearing or mixed states.\n");

  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log("[Cleanup] Removing test records from PostgreSQL...");
    const cleanupIds = [companyId!, companyBId!].filter(Boolean);
    if (cleanupIds.length > 0) {
      await prisma.trialBalanceEntry.deleteMany({ where: { companyId: { in: cleanupIds } } });
      await prisma.connector.deleteMany({ where: { companyId: { in: cleanupIds } } });
      await prisma.company.deleteMany({ where: { id: { in: cleanupIds } } });
    }
    await app.close();
    await prisma.$disconnect();
    console.log("Cleanup complete.\n");
  }

  console.log("===================================================================");
  console.log("   ALL 6 REQUIRED TRIAL BALANCE TESTS PASSED WITH 100% SUCCESS!    ");
  console.log("===================================================================\n");
}

runTrialBalanceAtomicityTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
