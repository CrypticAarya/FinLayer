import assert from "node:assert";
import { config } from "../apps/connector/src/config.js";
import {
  registerConnectorWithApi,
  reportTallyConnected,
  reportTallyCompanies,
  selectCompanyForConnector,
  fetchPendingJob,
  completeSyncJob,
  sendLedgersToApi,
  sendTrialBalanceToApi,
  sendVouchersToApi,
} from "../apps/connector/src/api/client.js";
import prisma from "../apps/api/src/db/prisma.js";

const API_BASE = "http://127.0.0.1:4000";

async function main() {
  console.log("\n=================================================================");
  console.log("🚀 STARTING COMPLETE FINLAYER FOUNDER DEMO FLOW VERIFICATION");
  console.log("=================================================================\n");

  const timestamp = Date.now();
  const testCompanyName = `Founder Demo Enterprise ${timestamp}`;
  const deviceId = `founder-demo-win-${timestamp}`;

  // ── 1. Fresh Install & Connector Registration ─────────────────────────────
  console.log("--- STEP 1: Fresh Install & Registration ---");
  const regResult = await registerConnectorWithApi({
    deviceId,
    deviceName: "Founder-Windows-11-PC",
    operatingSystem: "Windows 11 Pro 64-bit",
  });
  assert(regResult.connectorId, "Expected connectorId from registration");
  const connectorId = regResult.connectorId;
  console.log(`[WINDOWS] Fresh install registered connector ID: ${connectorId}`);

  // ── 2. Tally Detection ───────────────────────────────────────────────────
  console.log("\n--- STEP 2: Detect TallyPrime ✅ ---");
  await reportTallyConnected(connectorId);
  console.log(`[WINDOWS] TallyPrime connected on port 9000`);

  // ── 3. Detect Company ✅ ─────────────────────────────────────────────────
  console.log("\n--- STEP 3: Detect Company ✅ ---");
  await reportTallyCompanies(connectorId, [{ name: testCompanyName }]);
  const compSelect = await selectCompanyForConnector(connectorId, testCompanyName);
  assert(compSelect.companyId, "Expected companyId from company selection");
  const companyId = compSelect.companyId;
  console.log(`[WINDOWS] Active company detected: "${testCompanyName}"`);
  console.log(`[WINDOWS] Company ID: ${companyId}`);

  // ── 4. Verify Status Before Google Connection ─────────────────────────────
  console.log("\n--- STEP 4: Check Google Connection Before Login ---");
  console.log("[WINDOWS] Checking Google status");
  console.log(`[WINDOWS] Company ID: ${companyId}`);
  const preStatusRes = await fetch(`${API_BASE}/google/status/${companyId}`);
  const preStatus = await preStatusRes.json();
  console.log("[WINDOWS] Google connection response:", JSON.stringify(preStatus));
  assert.strictEqual(preStatus.connected, false, "Should be not connected initially");

  // ── 5. Connect Demo Google Sheet (DEMO_MODE Bypass) ────────────────────────
  console.log("\n--- STEP 5: Connect Demo Google Sheet (OAuth Bypass in DEMO_MODE) ---");
  console.log(`[DEMO_MODE] Calling POST /google/demo-connect/${companyId}...`);

  const demoConnRes = await fetch(`${API_BASE}/google/demo-connect/${companyId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.strictEqual(demoConnRes.status, 200, "Expected demo-connect to return 200 OK");
  const demoConnData = await demoConnRes.json();
  console.log("[DEMO_MODE] Demo connect response:", demoConnData);
  assert.strictEqual(demoConnData.connected, true, "Expected connected: true");
  assert.strictEqual(demoConnData.demoMode, true, "Expected demoMode: true");
  assert(demoConnData.spreadsheetId, "Expected spreadsheetId");
  assert(demoConnData.spreadsheetUrl, "Expected spreadsheetUrl");

  // Also verify GET /google/connect/:companyId redirects to callback when DEMO_MODE is true
  const oauthRedirectRes = await fetch(`${API_BASE}/google/connect/${companyId}`, {
    redirect: "manual",
  });
  const oauthRedirectLoc = oauthRedirectRes.headers.get("location");
  console.log(`[DEMO_MODE] GET /google/connect/${companyId} redirected to: ${oauthRedirectLoc}`);
  assert(oauthRedirectLoc?.includes("mock=true"), "Expected redirect with mock=true in DEMO_MODE");

  // ── 6. Verify Google Status Contract ──────────────────────────────────────
  console.log("\n--- STEP 6: FinLayer Desktop App Polls Google Status ---");
  console.log("[WINDOWS] Checking Google status");
  console.log(`[WINDOWS] Company ID: ${companyId}`);
  const postStatusRes = await fetch(`${API_BASE}/google/status/${companyId}`);
  const postStatus = await postStatusRes.json();
  console.log("[WINDOWS] Google connection response:", JSON.stringify(postStatus));

  assert.strictEqual(postStatus.connected, true, "Expected connected: true");
  assert.strictEqual(postStatus.demoMode, true, "Expected demoMode: true");
  assert.strictEqual(postStatus.companyId, companyId, "Expected matching companyId");
  assert(postStatus.email, "Expected email in response");
  console.log(`[GOOGLE] Token received (demo sheet) - email: ${postStatus.email}`);
  console.log(`[GOOGLE] Token stored for companyId: ${companyId}`);
  console.log(`[GOOGLE] Sheet connection created: ${postStatus.spreadsheetId} (${postStatus.spreadsheetUrl})`);
  console.log("\n[WINDOWS] UI state: Connect Demo Sheet -> Connected ✅");
  console.log("[WINDOWS] Badge: Google Sheet Connected ✅");

  // ── 7. Verify Pending Sync Job Creation ───────────────────────────────────
  console.log("\n--- STEP 7: Sync Worker Execution (Tally XML -> Connector -> API -> Google Sheet) ---");
  const pendingJob = await fetchPendingJob(connectorId);
  console.log("[WORKER] Pending sync job found:", pendingJob);
  assert(pendingJob, "Expected a pending sync job automatically created upon Google connection");
  assert.strictEqual(pendingJob.type, "FINANCIAL_DATA", "Expected FINANCIAL_DATA job type");

  // ── 8. Execute Sync: Trial Balance, Ledgers, Vouchers ─────────────────────
  console.log(`[WORKER] Fetching financial data from Tally XML for "${testCompanyName}"...`);

  // Sample Trial Balance Data
  const sampleTrialBalance = [
    { ledgerName: "Sales Account", groupName: "Sales Accounts", debitAmount: 0, creditAmount: 250000 },
    { ledgerName: "State Bank of India", groupName: "Bank Accounts", debitAmount: 180000, creditAmount: 0 },
    { ledgerName: "Direct Expenses", groupName: "Direct Expenses", debitAmount: 45000, creditAmount: 0 },
    { ledgerName: "Capital Account", groupName: "Capital Account", debitAmount: 0, creditAmount: 150000 },
    { ledgerName: "Sundry Debtors (Reliance)", groupName: "Sundry Debtors", debitAmount: 125000, creditAmount: 0 },
    { ledgerName: "Sundry Creditors (Tata Steel)", groupName: "Sundry Creditors", debitAmount: 0, creditAmount: 150000 },
  ];

  // Sample Ledgers Data
  const sampleLedgers = [
    { name: "Sales Account", parent: "Sales Accounts", masterId: 101, alterId: 1 },
    { name: "State Bank of India", parent: "Bank Accounts", masterId: 102, alterId: 1 },
    { name: "Direct Expenses", parent: "Direct Expenses", masterId: 103, alterId: 1 },
    { name: "Capital Account", parent: "Capital Account", masterId: 104, alterId: 1 },
    { name: "Sundry Debtors (Reliance)", parent: "Sundry Debtors", masterId: 105, alterId: 1 },
    { name: "Sundry Creditors (Tata Steel)", parent: "Sundry Creditors", masterId: 106, alterId: 1 },
  ];

  // Sample Vouchers Data
  const sampleVouchers = [
    {
      voucherNumber: "INV-001",
      voucherType: "Sales",
      date: new Date().toISOString(),
      partyName: "Reliance Industries",
      amount: 125000,
      entries: [
        { ledgerName: "Sundry Debtors (Reliance)", amount: 125000, type: "debit" },
        { ledgerName: "Sales Account", amount: 125000, type: "credit" },
      ],
    },
    {
      voucherNumber: "PUR-001",
      voucherType: "Purchase",
      date: new Date().toISOString(),
      partyName: "Tata Steel Ltd",
      amount: 45000,
      entries: [
        { ledgerName: "Direct Expenses", amount: 45000, type: "debit" },
        { ledgerName: "Sundry Creditors (Tata Steel)", amount: 45000, type: "credit" },
      ],
    },
    {
      voucherNumber: "REC-001",
      voucherType: "Receipt",
      date: new Date().toISOString(),
      partyName: "Reliance Industries",
      amount: 50000,
      entries: [
        { ledgerName: "State Bank of India", amount: 50000, type: "debit" },
        { ledgerName: "Sundry Debtors (Reliance)", amount: 50000, type: "credit" },
      ],
    },
  ];

  console.log(`[CONNECTOR] Uploading Trial Balance (${sampleTrialBalance.length} entries)...`);
  const tbRes = await sendTrialBalanceToApi(testCompanyName, sampleTrialBalance);
  console.log(`[API] Trial Balance synced: received=${tbRes.received}, created=${tbRes.created}`);

  console.log(`[CONNECTOR] Uploading Ledgers (${sampleLedgers.length} ledgers)...`);
  const ledgersRes = await sendLedgersToApi(testCompanyName, sampleLedgers);
  console.log(`[API] Ledgers synced: received=${ledgersRes.received}, created=${ledgersRes.created}`);

  console.log(`[CONNECTOR] Uploading Vouchers (${sampleVouchers.length} vouchers)...`);
  const vouchersRes = await sendVouchersToApi(testCompanyName, sampleVouchers);
  console.log(`[API] Vouchers synced: received=${vouchersRes.received}, created=${vouchersRes.created}`);

  console.log(`[CONNECTOR] Marking sync job ${pendingJob.id} COMPLETED...`);
  await completeSyncJob(pendingJob.id);
  console.log("[API] Sync job marked COMPLETED. Triggered automatic Google Sheets export!");

  // ── 9. Verify Google Sheet Content ────────────────────────────────────────
  console.log("\n--- STEP 9: Verify Data Appears in Google Sheet ---");
  const sheetRes = await fetch(`${API_BASE}/google/mock-sheet/${postStatus.spreadsheetId}`);
  const sheetData = await sheetRes.json();

  console.log("Sheet verification result:", {
    success: sheetData.success,
    trialBalanceRows: sheetData.trialBalance?.length || 0,
    ledgersRows: sheetData.ledgers?.length || 0,
    transactionsRows: sheetData.transactions?.length || 0,
  });

  console.log("\n[GOOGLE SHEET TAB: Trial Balance]");
  console.table(sheetData.trialBalance);

  console.log("\n[GOOGLE SHEET TAB: Ledgers]");
  console.table(sheetData.ledgers);

  console.log("\n[GOOGLE SHEET TAB: Transactions]");
  console.table(sheetData.transactions);

  assert(sheetData.trialBalance && sheetData.trialBalance.length > 1, "Trial Balance tab should contain rows");
  assert(sheetData.ledgers && sheetData.ledgers.length > 1, "Ledgers tab should contain rows");
  assert(sheetData.transactions && sheetData.transactions.length > 1, "Transactions tab should contain rows");

  // ── 10. Verify Sync History in Database ────────────────────────────────────
  const syncHistory = await prisma.syncHistory.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
  console.log("\n[DATABASE] Latest SyncHistory:", {
    syncType: syncHistory?.syncType,
    status: syncHistory?.status,
    recordsUpdated: syncHistory?.recordsUpdated,
    googleStatus: syncHistory?.googleStatus,
  });
  assert.strictEqual(syncHistory?.googleStatus, "SUCCESS", "Expected SyncHistory googleStatus SUCCESS");

  console.log("\n=================================================================");
  console.log("✅ ALL FOUNDER DEMO FLOW CHECKS PASSED SUCCESSFULLY!");
  console.log("=================================================================\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Test failed with error:", err);
  process.exit(1);
});
