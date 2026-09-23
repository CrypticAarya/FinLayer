import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import prisma from "../src/db/prisma.js";
import { generateConnectorToken, hashConnectorToken } from "../src/auth/connector-auth.js";
import { generateSaasApiKey } from "../src/auth/saas-auth.js";
import { config as connectorConfig } from "../../connector/src/config.js";
import { setConnectorToken } from "../../connector/src/api/client.js";
import { syncFinancialDataPipeline } from "../../connector/src/jobs/job-worker.js";

async function runE2ETallySyncVerification() {
  console.log("===================================================================");
  console.log("   FINLAYER E2E TEST: TALLY -> CONNECTOR -> API -> SAAS API        ");
  console.log("===================================================================\n");

  const timestamp = Date.now();
  const testCompanyName = `E2E Test Enterprise ${timestamp}`;
  const tallyPort = 9888;
  const apiBaseUrl = "http://localhost:4000";
  const testStatePath = `/tmp/finlayer-e2e-state-${timestamp}.json`;

  let tallyServer: http.Server | null = null;
  let companyId: string;
  let connectorId: string;
  let saasApiKey: string;

  try {
    // ─── Step 1: Start Mock Tally HTTP Server ────────────────────────────────
    console.log(`[Step 1] Starting Mock TallyPrime HTTP Server on port ${tallyPort}...`);

    tallyServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/xml" });

        // Tally Route 1: Trial Balance
        if (body.includes("<ID>Trial Balance</ID>")) {
          console.log("  [Mock Tally] Received request for Trial Balance. Serving XML...");
          const xml = `
<ENVELOPE>
  <BODY>
    <DATA>
      <TRIALBALANCE>
        <LEDGER NAME="Cash in Hand">
          <PARENT>Current Assets</PARENT>
          <CLOSINGBALANCE>-15000</CLOSINGBALANCE>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        </LEDGER>
        <LEDGER NAME="HDFC Current Account">
          <PARENT>Bank Accounts</PARENT>
          <CLOSINGBALANCE>-35000</CLOSINGBALANCE>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        </LEDGER>
        <LEDGER NAME="Software Sales Revenue">
          <PARENT>Sales Accounts</PARENT>
          <CLOSINGBALANCE>40000</CLOSINGBALANCE>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        </LEDGER>
        <LEDGER NAME="Cloud Hosting Expense">
          <PARENT>Direct Expenses</PARENT>
          <CLOSINGBALANCE>-10000</CLOSINGBALANCE>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        </LEDGER>
        <LEDGER NAME="Shareholder Capital">
          <PARENT>Capital Account</PARENT>
          <CLOSINGBALANCE>20000</CLOSINGBALANCE>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        </LEDGER>
      </TRIALBALANCE>
    </DATA>
  </BODY>
</ENVELOPE>`;
          res.end(xml);
        }
        // Tally Route 2: List of Ledgers
        else if (body.includes("<ID>List of Ledgers</ID>")) {
          console.log("  [Mock Tally] Received request for List of Ledgers. Serving XML...");
          const xml = `
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        <LEDGER NAME="Cash in Hand">
          <PARENT>Current Assets</PARENT>
          <MASTERID>1001</MASTERID>
          <ALTERID>1</ALTERID>
        </LEDGER>
        <LEDGER NAME="HDFC Current Account">
          <PARENT>Bank Accounts</PARENT>
          <MASTERID>1002</MASTERID>
          <ALTERID>1</ALTERID>
        </LEDGER>
        <LEDGER NAME="Software Sales Revenue">
          <PARENT>Sales Accounts</PARENT>
          <MASTERID>1003</MASTERID>
          <ALTERID>1</ALTERID>
        </LEDGER>
        <LEDGER NAME="Cloud Hosting Expense">
          <PARENT>Direct Expenses</PARENT>
          <MASTERID>1004</MASTERID>
          <ALTERID>1</ALTERID>
        </LEDGER>
        <LEDGER NAME="Shareholder Capital">
          <PARENT>Capital Account</PARENT>
          <MASTERID>1005</MASTERID>
          <ALTERID>1</ALTERID>
        </LEDGER>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>`;
          res.end(xml);
        }
        // Tally Route 3: Vouchers (DayBook)
        else if (body.includes("<ID>DayBook</ID>")) {
          console.log("  [Mock Tally] Received request for Vouchers (DayBook). Serving XML...");
          const xml = `
<ENVELOPE>
  <BODY>
    <DATA>
      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Receipt">
          <VOUCHERNUMBER>INV-2026-001</VOUCHERNUMBER>
          <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
          <DATE>20260401</DATE>
          <PARTYNAME>Software Sales Revenue</PARTYNAME>
          <MASTERID>5001</MASTERID>
          <ALTERID>1</ALTERID>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>HDFC Current Account</LEDGERNAME>
            <AMOUNT>-40000</AMOUNT>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Software Sales Revenue</LEDGERNAME>
            <AMOUNT>40000</AMOUNT>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
        <VOUCHER VCHTYPE="Payment">
          <VOUCHERNUMBER>EXP-2026-001</VOUCHERNUMBER>
          <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
          <DATE>20260402</DATE>
          <PARTYNAME>Cloud Hosting Expense</PARTYNAME>
          <MASTERID>5002</MASTERID>
          <ALTERID>1</ALTERID>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Cloud Hosting Expense</LEDGERNAME>
            <AMOUNT>-10000</AMOUNT>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Cash in Hand</LEDGERNAME>
            <AMOUNT>10000</AMOUNT>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
          res.end(xml);
        } else {
          console.log("  [Mock Tally] Unknown request:", body.slice(0, 100));
          res.end("<ENVELOPE><BODY><DATA></DATA></BODY></ENVELOPE>");
        }
      });
    });

    await new Promise<void>((resolve) => {
      tallyServer!.listen(tallyPort, "127.0.0.1", () => {
        console.log(`  ✔ Mock TallyPrime HTTP server listening on http://127.0.0.1:${tallyPort}`);
        resolve();
      });
    });

    // ─── Step 2: Register Test Company & Connector on API ────────────────────
    console.log(`\n[Step 2] Creating test company and authenticated connector in database...`);
    const company = await prisma.company.create({
      data: {
        name: testCompanyName,
        tallyCompanyName: testCompanyName,
      },
    });
    companyId = company.id;

    const rawToken = generateConnectorToken();
    const tokenHash = hashConnectorToken(rawToken);

    const connector = await prisma.connector.create({
      data: {
        deviceId: `e2e-dev-${timestamp}`,
        name: "E2E Test Connector",
        companyId,
        tallyCompanyName: testCompanyName,
        tokenHash,
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    connectorId = connector.id;

    // Generate SaaS API key for this company to test GET /trial-balance
    const saasKeyObj = await generateSaasApiKey({
      companyId,
      name: "E2E Test SaaS Key",
    });
    saasApiKey = saasKeyObj.apiKey;

    console.log(`  ✔ Company Created: id=${companyId}, name="${testCompanyName}"`);
    console.log(`  ✔ Connector Created: id=${connectorId}`);
    console.log(`  ✔ SaaS API Key Created: ${saasApiKey.slice(0, 12)}...`);

    // ─── Step 3: Configure Isolated Connector State & Run syncFinancialDataPipeline ───
    console.log(`\n[Step 3] Configuring isolated connector state & tokens...`);
    await fs.writeFile(
      testStatePath,
      JSON.stringify(
        {
          deviceId: `e2e-dev-${timestamp}`,
          connectorId,
          companyId,
          company: testCompanyName,
          tallyCompanyName: testCompanyName,
          connectorToken: rawToken,
          setupStatus: "ACTIVE",
          registeredAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    process.env.FINLAYER_STATE_PATH = testStatePath;

    connectorConfig.apiUrl = apiBaseUrl;
    connectorConfig.tallyUrl = `http://127.0.0.1:${tallyPort}/`;
    connectorConfig.companyName = testCompanyName;
    setConnectorToken(rawToken);

    console.log(`  Executing syncFinancialDataPipeline()...`);
    const syncStart = Date.now();
    await syncFinancialDataPipeline();
    const syncDuration = Date.now() - syncStart;
    console.log(`  ✔ syncFinancialDataPipeline completed successfully in ${syncDuration}ms.`);

    // ─── Step 4: Verify Database Persistence ────────────────────────────────
    console.log(`\n[Step 4] Verifying data stored in PostgreSQL database...`);

    // A. Verify Ledgers stored
    const storedLedgers = await prisma.ledger.findMany({
      where: { companyId },
    });
    console.log(`  [DB Check] Stored Ledgers count: ${storedLedgers.length}`);
    assert.strictEqual(storedLedgers.length, 5, "Database must contain exactly 5 stored ledgers");
    const ledgerNames = storedLedgers.map((l) => l.name);
    assert.ok(ledgerNames.includes("Cash in Hand"), "Must contain Cash in Hand");
    assert.ok(ledgerNames.includes("HDFC Current Account"), "Must contain HDFC Current Account");
    assert.ok(ledgerNames.includes("Software Sales Revenue"), "Must contain Software Sales Revenue");
    console.log(`  ✔ Ledgers successfully persisted in database: ${ledgerNames.join(", ")}`);

    // B. Verify Vouchers stored
    const storedVouchers = await prisma.voucher.findMany({
      where: { companyId },
      include: { voucherEntries: true },
    });
    console.log(`  [DB Check] Stored Vouchers count: ${storedVouchers.length}`);
    assert.strictEqual(storedVouchers.length, 2, "Database must contain exactly 2 stored vouchers");
    for (const v of storedVouchers) {
      assert.strictEqual(v.voucherEntries.length, 2, `Voucher ${v.voucherNumber} must have 2 entries`);
    }
    console.log(
      `  ✔ Vouchers successfully persisted with line item entries: ${storedVouchers
        .map((v) => v.voucherNumber)
        .join(", ")}`
    );

    // C. Verify Trial Balance entries stored
    const storedTb = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
    });
    console.log(`  [DB Check] Stored Trial Balance entries count: ${storedTb.length}`);
    assert.strictEqual(storedTb.length, 5, "Database must contain exactly 5 Trial Balance entries");
    console.log(`  ✔ Trial Balance snapshot entries successfully persisted in database.`);

    // ─── Step 5: Query SaaS API GET /api/v1/companies/:companyId/trial-balance ──
    console.log(`\n[Step 5] Querying SaaS API GET /api/v1/companies/:companyId/trial-balance...`);
    const tbRes = await fetch(`${apiBaseUrl}/api/v1/companies/${companyId}/trial-balance`, {
      headers: {
        Authorization: `Bearer ${saasApiKey}`,
        Accept: "application/json",
      },
    });

    assert.strictEqual(tbRes.status, 200, `SaaS API must return 200 OK (got ${tbRes.status})`);
    const tbJson = (await tbRes.json()) as any;

    console.log("  [SaaS API Response]:", JSON.stringify(tbJson, null, 2));

    assert.strictEqual(tbJson.success, true, "Response success must be true");
    assert.strictEqual(tbJson.companyId, companyId, "Response companyId must match");
    assert.ok(Array.isArray(tbJson.data), "Response data must be an array");
    assert.strictEqual(tbJson.data.length, 5, "Response data must contain 5 accounts");

    const totals = tbJson.totals;
    assert.ok(totals, "Response must include totals");
    console.log(`  Debit Total:  ₹${totals.debitTotal}`);
    console.log(`  Credit Total: ₹${totals.creditTotal}`);
    console.log(`  isBalanced:   ${totals.isBalanced}`);

    // In our mock dataset:
    // Cash in Hand (Dr 15000), HDFC (Dr 35000), Cloud Hosting (Dr 10000) = 60,000
    // Software Sales (Cr 40000), Shareholder Capital (Cr 20000) = 60,000
    assert.strictEqual(totals.debitTotal, 60000, "Debit total must be 60000");
    assert.strictEqual(totals.creditTotal, 60000, "Credit total must be 60000");
    assert.strictEqual(totals.isBalanced, true, "Trial balance must be balanced");

    // Also test GET /api/v1/companies/:companyId/ledgers
    console.log(`\n[Step 6] Querying SaaS API GET /api/v1/companies/:companyId/ledgers...`);
    const ledgersRes = await fetch(`${apiBaseUrl}/api/v1/companies/${companyId}/ledgers`, {
      headers: {
        Authorization: `Bearer ${saasApiKey}`,
        Accept: "application/json",
      },
    });
    assert.strictEqual(ledgersRes.status, 200, "SaaS API ledgers must return 200");
    const ledgersJson = (await ledgersRes.json()) as any;
    assert.strictEqual(ledgersJson.data.length, 5, "SaaS API ledgers must return 5 ledgers");
    console.log(`  ✔ Ledgers retrieved via SaaS API: ${ledgersJson.data.length} records`);

    // Also test GET /api/v1/companies/:companyId/vouchers
    console.log(`\n[Step 7] Querying SaaS API GET /api/v1/companies/:companyId/vouchers...`);
    const vouchersRes = await fetch(`${apiBaseUrl}/api/v1/companies/${companyId}/vouchers`, {
      headers: {
        Authorization: `Bearer ${saasApiKey}`,
        Accept: "application/json",
      },
    });
    assert.strictEqual(vouchersRes.status, 200, "SaaS API vouchers must return 200");
    const vouchersJson = (await vouchersRes.json()) as any;
    assert.strictEqual(vouchersJson.data.length, 2, "SaaS API vouchers must return 2 vouchers");
    console.log(`  ✔ Vouchers retrieved via SaaS API: ${vouchersJson.data.length} records`);

    console.log("\n===================================================================");
    console.log("  ✔ ALL CHECKS PASSED: TALLY -> CONNECTOR -> API -> SAAS API      ");
    console.log("  ✔ Extraction, Transformation, Storage & SaaS API 100% Verified! ");
    console.log("===================================================================\n");
  } finally {
    // ─── Cleanup ─────────────────────────────────────────────────────────────
    if (tallyServer) {
      tallyServer.close();
      console.log("[Cleanup] Mock Tally server stopped.");
    }
    await fs.unlink(testStatePath).catch(() => {});
    delete process.env.FINLAYER_STATE_PATH;

    if (companyId!) {
      await prisma.trialBalanceEntry.deleteMany({ where: { companyId } }).catch(() => {});
      await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId } } }).catch(() => {});
      await prisma.voucher.deleteMany({ where: { companyId } }).catch(() => {});
      await prisma.ledger.deleteMany({ where: { companyId } }).catch(() => {});
      await prisma.syncRun.deleteMany({ where: { companyId } }).catch(() => {});
      await prisma.syncLog.deleteMany({ where: { companyId } }).catch(() => {});
      await prisma.apiKey.deleteMany({ where: { companyId } }).catch(() => {});
      await prisma.connector.deleteMany({ where: { companyId } }).catch(() => {});
      await prisma.company.deleteMany({ where: { id: companyId } }).catch(() => {});
      console.log("[Cleanup] Test records cleaned up from database.");
    }
  }
}

runE2ETallySyncVerification().catch((err) => {
  console.error("\n❌ E2E TEST FAILED:", err);
  process.exit(1);
});
