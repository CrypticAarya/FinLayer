/**
 * scratch/verify-financial-sync.ts
 *
 * End-to-End verification script for Step 4: Financial Data Sync Pipeline.
 *
 * Verifies:
 * 1. Mock Tally server responds to Trial Balance, Ledgers, and Vouchers XML queries.
 * 2. Create FINANCIAL_DATA sync job for a test company & connector.
 * 3. Connector receives and executes the pipeline (fetches TB, Ledgers, Vouchers, sends to API).
 * 4. API stores data in PostgreSQL (TrialBalanceEntry, Ledger, Voucher, VoucherEntry).
 * 5. Google Sheet mock export updates tabs ("Trial Balance", "Ledgers", "Transactions") with exact headers.
 * 6. Job status becomes COMPLETED and SyncHistory status is SUCCESS with googleStatus SUCCESS.
 */

import http from "node:http";
import prisma from "../apps/api/src/db/prisma.js";
import { encrypt } from "../apps/api/src/utils/crypto.js";
import { getMockGoogleSheetTab, syncCompanyFinancialDataToGoogleSheets } from "../apps/api/src/services/google-sheet-sync-service.js";
import { fetchPendingJob, completeSyncJob, sendLedgersToApi, sendVouchersToApi, sendTrialBalanceToApi } from "../apps/connector/src/api/client.js";
import { fetchLedgersFromTally, fetchVouchersFromTally, getTrialBalance } from "../apps/connector/src/services/tally-service.js";
import { config } from "../apps/connector/src/config.js";

const MOCK_TALLY_PORT = 9876;
const API_URL = process.env.API_URL || "http://127.0.0.1:4000";

// Mock Tally XML Payloads
const MOCK_TB_XML = `
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        <LEDGER>
          <NAME>HDFC Bank</NAME>
          <PARENT>Bank Accounts</PARENT>
          <DEBITAMOUNT>150000.00</DEBITAMOUNT>
          <CREDITAMOUNT>0.00</CREDITAMOUNT>
        </LEDGER>
        <LEDGER>
          <NAME>Sales Revenue</NAME>
          <PARENT>Sales Accounts</PARENT>
          <DEBITAMOUNT>0.00</DEBITAMOUNT>
          <CREDITAMOUNT>150000.00</CREDITAMOUNT>
        </LEDGER>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>
`;

const MOCK_LEDGERS_XML = `
<ENVELOPE>
  <BODY>
    <DATA>
      <COLLECTION>
        <LEDGER NAME="HDFC Bank">
          <PARENT>Bank Accounts</PARENT>
          <MASTERID>1001</MASTERID>
          <ALTERID>1</ALTERID>
        </LEDGER>
        <LEDGER NAME="Sales Revenue">
          <PARENT>Sales Accounts</PARENT>
          <MASTERID>1002</MASTERID>
          <ALTERID>1</ALTERID>
        </LEDGER>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>
`;

const MOCK_VOUCHERS_XML = `
<ENVELOPE>
  <BODY>
    <DATA>
      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Sales">
          <DATE>20260401</DATE>
          <VOUCHERNUMBER>INV-2026-001</VOUCHERNUMBER>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>HDFC Bank</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>HDFC Bank</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-50000</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Sales Revenue</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>50000</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>
`;

async function main() {
  console.log("===============================================================");
  console.log("   STEP 4: FINANCIAL DATA SYNC PIPELINE VERIFICATION");
  console.log("===============================================================\n");

  // 1. Start Mock Tally HTTP Server
  console.log(`[1/6] Starting Mock Tally server on port ${MOCK_TALLY_PORT}...`);
  const tallyServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/xml" });
      if (body.includes("Trial Balance")) {
        res.end(MOCK_TB_XML);
      } else if (body.includes("DayBook") || body.includes("VOUCHER") || body.includes("Voucher")) {
        res.end(MOCK_VOUCHERS_XML);
      } else {
        res.end(MOCK_LEDGERS_XML);
      }
    });
  });

  await new Promise<void>((resolve) => {
    tallyServer.listen(MOCK_TALLY_PORT, "127.0.0.1", () => {
      console.log(`✓ Mock Tally server running at http://127.0.0.1:${MOCK_TALLY_PORT}`);
      resolve();
    });
  });

  try {
    // 2. Setup Test Data in PostgreSQL via Prisma
    console.log("\n[2/6] Provisioning test company and online connector...");
    const companyName = `Test Financial Co ${Date.now()}`;
    const company = await prisma.company.create({
      data: {
        name: companyName,
        tallyCompanyName: companyName,
      },
    });

    const connector = await prisma.connector.create({
      data: {
        companyId: company.id,
        deviceId: `device-verify-${Date.now()}`,
        name: "Verification Connector",
        status: "ONLINE",
        setupStatus: "ACTIVE",
        tallyCompanyName: companyName,
        lastHeartbeat: new Date(),
      },
    });

    const spreadsheetId = `1mock_test_spreadsheet_${Date.now()}`;
    await prisma.googleConnection.create({
      data: {
        companyId: company.id,
        googleEmail: "finance@testco.com",
        refreshToken: encrypt(`mock_refresh_${Date.now()}`),
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      },
    });

    console.log(`✓ Company created: ID="${company.id}", Name="${company.name}"`);
    console.log(`✓ Connector registered: ID="${connector.id}", Status="${connector.status}"`);
    console.log(`✓ Mock Google connection: SpreadsheetID="${spreadsheetId}"`);

    // Override connector configuration dynamically
    config.apiUrl = API_URL;
    config.tallyUrl = `http://127.0.0.1:${MOCK_TALLY_PORT}`;
    config.companyName = companyName;

    // 3. Create FINANCIAL_DATA sync job via Dashboard API
    console.log("\n[3/6] Triggering FINANCIAL_DATA sync job via Dashboard API...");
    const triggerRes = await fetch(`${API_URL}/dashboard/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: company.id,
        type: "FINANCIAL_DATA",
      }),
    });

    if (!triggerRes.ok) {
      const errText = await triggerRes.text();
      throw new Error(`Failed to trigger sync: ${triggerRes.status} — ${errText}`);
    }

    const triggerData = (await triggerRes.json()) as { success: boolean; jobId: string; status: string };
    console.log(`✓ Sync job triggered: JobID="${triggerData.jobId}", Status="${triggerData.status}"`);

    // 4. Connector receives job & executes pipeline
    console.log("\n[4/6] Connector polling and processing job...");
    const pendingJob = await fetchPendingJob(connector.id);
    if (!pendingJob) {
      throw new Error(`Connector failed to find pending job for connector ${connector.id}`);
    }

    console.log(`✓ Connector picked up job: ID="${pendingJob.id}", Type="${pendingJob.type}"`);
    if (pendingJob.type !== "FINANCIAL_DATA") {
      throw new Error(`Expected job type FINANCIAL_DATA, received: ${pendingJob.type}`);
    }

    // Step 2: Fetch & sync Trial Balance
    console.log("  → Fetching Trial Balance from Tally & sending to API...");
    const trialBalance = await getTrialBalance(companyName);
    const tbRes = await sendTrialBalanceToApi(companyName, trialBalance);
    console.log(`    ✓ Trial Balance stored: received=${tbRes.received}, created=${tbRes.created}`);

    // Step 3: Fetch & sync Ledgers
    console.log("  → Fetching Ledgers from Tally & sending to API...");
    const ledgers = await fetchLedgersFromTally(companyName);
    const ledgersRes = await sendLedgersToApi(companyName, ledgers);
    console.log(`    ✓ Ledgers stored: received=${ledgersRes.received}, created=${ledgersRes.created}`);

    // Step 4: Fetch & sync Vouchers
    console.log("  → Fetching Vouchers from Tally & sending to API...");
    const vouchers = await fetchVouchersFromTally(companyName);
    const vouchersRes = await sendVouchersToApi(companyName, vouchers);
    console.log(`    ✓ Vouchers stored: received=${vouchersRes.received}, created=${vouchersRes.created}`);

    // Step 5: Mark complete
    console.log("  → Marking job complete via API...");
    await completeSyncJob(pendingJob.id);
    console.log("    ✓ Job marked complete");

    // 5. Verify PostgreSQL Data & Job Status
    console.log("\n[5/6] Verifying PostgreSQL records & sync history...");
    const completedJob = await prisma.syncJob.findUnique({
      where: { id: pendingJob.id },
    });
    if (completedJob?.status !== "COMPLETED") {
      throw new Error(`Job status expected COMPLETED, got: ${completedJob?.status}`);
    }
    console.log(`✓ Job status verified: ${completedJob.status}`);

    const [dbTbCount, dbLedgerCount, dbVoucherCount] = await Promise.all([
      prisma.trialBalanceEntry.count({ where: { companyId: company.id } }),
      prisma.ledger.count({ where: { companyId: company.id } }),
      prisma.voucher.count({ where: { companyId: company.id } }),
    ]);

    console.log(`✓ Database records: ${dbTbCount} Trial Balance, ${dbLedgerCount} Ledgers, ${dbVoucherCount} Vouchers`);
    if (dbTbCount === 0 || dbLedgerCount === 0 || dbVoucherCount === 0) {
      throw new Error("One or more financial tables have 0 records!");
    }

    const syncHistory = await prisma.syncHistory.findFirst({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
    });

    console.log(`✓ SyncHistory verified: Status="${syncHistory?.status}", GoogleStatus="${syncHistory?.googleStatus}", RecordsUpdated=${syncHistory?.recordsUpdated}`);
    if (syncHistory?.status !== "SUCCESS" || syncHistory?.googleStatus !== "SUCCESS") {
      throw new Error(`SyncHistory check failed: status=${syncHistory?.status}, googleStatus=${syncHistory?.googleStatus}`);
    }

    // 6. Verify Mock Google Sheets Export & Headers
    console.log("\n[6/6] Verifying Mock Google Sheet tabs and headers...");

    const sheetRes = await fetch(`${API_URL}/google/mock-sheet/${spreadsheetId}`);
    let tbTab: any[][] | undefined;
    let ledgersTab: any[][] | undefined;
    let txTab: any[][] | undefined;

    if (sheetRes.ok) {
      const sheetData = (await sheetRes.json()) as any;
      tbTab = sheetData.trialBalance;
      ledgersTab = sheetData.ledgers;
      txTab = sheetData.transactions;
    }

    if (!tbTab || !ledgersTab || !txTab) {
      const directSync = await syncCompanyFinancialDataToGoogleSheets(company.id);
      if (!directSync.success) {
        throw new Error(`Direct Google Sheets sync failed: ${directSync.error}`);
      }
      tbTab = getMockGoogleSheetTab(spreadsheetId, "Trial Balance");
      ledgersTab = getMockGoogleSheetTab(spreadsheetId, "Ledgers");
      txTab = getMockGoogleSheetTab(spreadsheetId, "Transactions");
    }

    if (!tbTab || !ledgersTab || !txTab) {
      throw new Error(`Google Sheet tabs missing: tbTab=${Boolean(tbTab)}, ledgersTab=${Boolean(ledgersTab)}, txTab=${Boolean(txTab)}`);
    }

    // Check Trial Balance tab headers
    const expectedTbHeaders = ["Ledger Name", "Group Name", "Debit Amount", "Credit Amount"];
    console.log(`  → Trial Balance Headers: [${tbTab[0]?.join(", ")}]`);
    if (JSON.stringify(tbTab[0]) !== JSON.stringify(expectedTbHeaders)) {
      throw new Error(`Trial Balance headers mismatch: expected ${JSON.stringify(expectedTbHeaders)}, got ${JSON.stringify(tbTab[0])}`);
    }
    console.log(`    ✓ Rows written: ${tbTab.length} (including summary row)`);

    // Check Ledgers tab headers
    const expectedLedgersHeaders = ["Master ID", "Ledger Name", "Group / Parent", "Alter ID"];
    console.log(`  → Ledgers Headers: [${ledgersTab[0]?.join(", ")}]`);
    if (JSON.stringify(ledgersTab[0]) !== JSON.stringify(expectedLedgersHeaders)) {
      throw new Error(`Ledgers headers mismatch: expected ${JSON.stringify(expectedLedgersHeaders)}, got ${JSON.stringify(ledgersTab[0])}`);
    }
    console.log(`    ✓ Rows written: ${ledgersTab.length}`);

    // Check Transactions tab headers
    const expectedTxHeaders = ["Date", "Voucher Number", "Voucher Type", "Party Name", "Total Amount", "Ledger Name", "Type", "Entry Amount"];
    console.log(`  → Transactions Headers: [${txTab[0]?.join(", ")}]`);
    if (JSON.stringify(txTab[0]) !== JSON.stringify(expectedTxHeaders)) {
      throw new Error(`Transactions headers mismatch: expected ${JSON.stringify(expectedTxHeaders)}, got ${JSON.stringify(txTab[0])}`);
    }
    console.log(`    ✓ Rows written: ${txTab.length}`);

    console.log("\n===============================================================");
    console.log("   🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
    console.log("===============================================================\n");
  } finally {
    tallyServer.close();
  }
}

main().catch((err) => {
  console.error("\n❌ Verification Failed:", err);
  process.exit(1);
});
