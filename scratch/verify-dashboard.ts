/**
 * scratch/verify-dashboard.ts
 *
 * Verification script for Step 5: FinLayer SaaS Dashboard Layer.
 *
 * Verifies:
 * 1. Test company creation with Trial Balance, Ledgers, Vouchers, Connector (with OS), and SyncHistory.
 * 2. GET /dashboard/financial-summary/:companyId computes revenue, expenses, profit, cash, receivables, payables.
 * 3. GET /dashboard/sync-history/:companyId returns chronological sync audit events.
 * 4. GET /dashboard/data includes company overview, status indicators, and connector device OS.
 * 5. Google Sheets "Dashboard" tab is populated with structured financial summary metrics.
 * 6. HTML pages (/dashboard, /dashboard/ledgers, /dashboard/vouchers, /dashboard/trial-balance, /dashboard/sync-history) load with 200 OK.
 */

import prisma from "../apps/api/src/db/prisma.js";
import { encrypt } from "../apps/api/src/utils/crypto.js";
import { calculateFinancialSummary } from "../apps/api/src/services/financial-summary-service.js";
import { syncCompanyFinancialDataToGoogleSheets, getMockGoogleSheetTab } from "../apps/api/src/services/google-sheet-sync-service.js";

const API_URL = process.env.API_URL || "http://127.0.0.1:4000";

async function main() {
  console.log("===============================================================");
  console.log("   STEP 5: FINLAYER SAAS DASHBOARD LAYER VERIFICATION");
  console.log("===============================================================\n");

  // 1. Provision Test Company & Financial Data
  console.log("[1/6] Provisioning test company with full financial dataset...");
  const companyName = `Acme SaaS Enterprise ${Date.now()}`;
  const company = await prisma.company.create({
    data: {
      name: companyName,
      tallyCompanyName: companyName,
    },
  });

  // Insert Trial Balance Entries
  await prisma.trialBalanceEntry.createMany({
    data: [
      {
        companyId: company.id,
        ledgerName: "HDFC Current A/c",
        groupName: "Bank Accounts",
        debitAmount: 1420000,
        creditAmount: 0,
      },
      {
        companyId: company.id,
        ledgerName: "Domestic Sales Revenue",
        groupName: "Sales Accounts",
        debitAmount: 0,
        creditAmount: 5000000,
      },
      {
        companyId: company.id,
        ledgerName: "Direct Material Purchases",
        groupName: "Purchase Accounts",
        debitAmount: 2500000,
        creditAmount: 0,
      },
      {
        companyId: company.id,
        ledgerName: "Office & Administrative Expenses",
        groupName: "Indirect Expenses",
        debitAmount: 750000,
        creditAmount: 0,
      },
      {
        companyId: company.id,
        ledgerName: "Enterprise Client Receivables",
        groupName: "Sundry Debtors",
        debitAmount: 860000,
        creditAmount: 0,
      },
      {
        companyId: company.id,
        ledgerName: "Cloud Infrastructure Payables",
        groupName: "Sundry Creditors",
        debitAmount: 0,
        creditAmount: 510000,
      },
    ],
  });

  // Insert Ledgers
  const ledgerBank = await prisma.ledger.create({
    data: {
      companyId: company.id,
      name: "HDFC Current A/c",
      parent: "Bank Accounts",
      masterId: 101,
      alterId: 1,
    },
  });

  const ledgerSales = await prisma.ledger.create({
    data: {
      companyId: company.id,
      name: "Domestic Sales Revenue",
      parent: "Sales Accounts",
      masterId: 102,
      alterId: 1,
    },
  });

  // Insert Voucher
  const voucher = await prisma.voucher.create({
    data: {
      companyId: company.id,
      voucherNumber: "INV-SAAS-001",
      voucherType: "Sales",
      date: new Date("2026-09-01"),
      partyName: "Enterprise Client Receivables",
      amount: 500000,
    },
  });

  await prisma.voucherEntry.createMany({
    data: [
      {
        voucherId: voucher.id,
        ledgerId: ledgerBank.id,
        amount: 500000,
        type: "debit",
      },
      {
        voucherId: voucher.id,
        ledgerId: ledgerSales.id,
        amount: 500000,
        type: "credit",
      },
    ],
  });

  // Insert Connector with Operating System
  const connector = await prisma.connector.create({
    data: {
      companyId: company.id,
      name: "Sarthak's MacBook Pro",
      deviceId: `device-saas-${Date.now()}`,
      operatingSystem: "macOS 15.0 Sequoia",
      status: "ONLINE",
      setupStatus: "ACTIVE",
      tallyCompanyName: companyName,
      lastHeartbeat: new Date(),
    },
  });

  // Insert Sync History records (as in user spec)
  await prisma.syncHistory.createMany({
    data: [
      {
        companyId: company.id,
        syncType: "FINANCIAL_DATA",
        status: "SUCCESS",
        recordsUpdated: 5240,
        googleStatus: "SUCCESS",
        startedAt: new Date("2026-09-10T10:30:00Z"),
        completedAt: new Date("2026-09-10T10:31:15Z"),
      },
      {
        companyId: company.id,
        syncType: "FINANCIAL_DATA",
        status: "SUCCESS",
        recordsUpdated: 4800,
        googleStatus: "SUCCESS",
        startedAt: new Date("2026-09-05T09:00:00Z"),
        completedAt: new Date("2026-09-05T09:01:10Z"),
      },
    ],
  });

  // Insert Mock Google Connection
  const spreadsheetId = `1mock_saas_sheet_${Date.now()}`;
  await prisma.googleConnection.create({
    data: {
      companyId: company.id,
      googleEmail: "cfo@acmesaas.com",
      refreshToken: encrypt(`mock_refresh_${Date.now()}`),
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    },
  });

  console.log(`✓ Company ID: ${company.id}`);
  console.log(`✓ Financial dataset inserted: 6 TB entries, 2 Ledgers, 1 Voucher`);
  console.log(`✓ Connector registered: "${connector.name}" (${connector.operatingSystem})`);

  // 2. Test Financial Summary Calculation & API
  console.log("\n[2/6] Verifying Financial Summary calculation & API...");
  const internalSummary = await calculateFinancialSummary(company.id);
  console.log("  → Internal Calculation:", internalSummary);

  const apiRes = await fetch(`${API_URL}/dashboard/financial-summary/${company.id}`);
  if (!apiRes.ok) {
    throw new Error(`Financial summary API failed: HTTP ${apiRes.status}`);
  }
  const summary = (await apiRes.json()) as typeof internalSummary;
  console.log("  → API Response:", summary);

  if (summary.revenue !== 5000000) throw new Error(`Expected revenue 5000000, got ${summary.revenue}`);
  if (summary.expenses !== 3250000) throw new Error(`Expected expenses 3250000, got ${summary.expenses}`);
  if (summary.profit !== 1750000) throw new Error(`Expected profit 1750000, got ${summary.profit}`);
  if (summary.cashBalance !== 1420000) throw new Error(`Expected cashBalance 1420000, got ${summary.cashBalance}`);
  if (summary.receivables !== 860000) throw new Error(`Expected receivables 860000, got ${summary.receivables}`);
  if (summary.payables !== 510000) throw new Error(`Expected payables 510000, got ${summary.payables}`);
  console.log("  ✓ All 6 financial metrics verified exactly matching expected totals!");

  // 3. Test Sync History API
  console.log("\n[3/6] Verifying GET /dashboard/sync-history/:companyId API...");
  const historyRes = await fetch(`${API_URL}/dashboard/sync-history/${company.id}`);
  if (!historyRes.ok) {
    throw new Error(`Sync history API failed: HTTP ${historyRes.status}`);
  }
  const historyData = (await historyRes.json()) as { success: boolean; history: any[] };
  console.log(`  ✓ Returned ${historyData.history.length} sync history items`);

  const run1 = historyData.history[0];
  const run2 = historyData.history[1];
  console.log(`  → Run 1: ${run1.formattedDate} | Status: ${run1.status} | Records: ${run1.recordsUpdated}`);
  console.log(`  → Run 2: ${run2.formattedDate} | Status: ${run2.status} | Records: ${run2.recordsUpdated}`);

  if (run1.recordsUpdated !== 5240 || run1.status !== "SUCCESS") {
    throw new Error(`Mismatch in history run 1: records=${run1.recordsUpdated}, status=${run1.status}`);
  }
  if (run2.recordsUpdated !== 4800 || run2.status !== "SUCCESS") {
    throw new Error(`Mismatch in history run 2: records=${run2.recordsUpdated}, status=${run2.status}`);
  }

  // 4. Test GET /dashboard/data API
  console.log("\n[4/6] Verifying GET /dashboard/data API (Overview & Devices)...");
  const dashDataRes = await fetch(`${API_URL}/dashboard/data`);
  if (!dashDataRes.ok) throw new Error(`Dashboard data API failed: HTTP ${dashDataRes.status}`);
  const dashData = (await dashDataRes.json()) as { companies: any[] };
  const foundCompany = dashData.companies.find((c: any) => c.id === company.id);

  if (!foundCompany) throw new Error("Test company not returned in /dashboard/data");
  console.log(`  ✓ Company found in list: ${foundCompany.name}`);
  console.log(`  ✓ Connector OS: ${foundCompany.connector?.operatingSystem}`);
  console.log(`  ✓ Connectors count: ${foundCompany.connectors?.length}`);

  if (foundCompany.connector?.operatingSystem !== "macOS 15.0 Sequoia") {
    throw new Error(`Expected connector OS 'macOS 15.0 Sequoia', got: ${foundCompany.connector?.operatingSystem}`);
  }

  // 5. Test Google Sheets Dashboard Tab Population
  console.log("\n[5/6] Verifying Google Sheet 'Dashboard' tab sync...");
  const sheetSyncResult = await syncCompanyFinancialDataToGoogleSheets(company.id);
  if (!sheetSyncResult.success) {
    throw new Error(`Google Sheet sync failed: ${sheetSyncResult.error}`);
  }

  const dashTab = getMockGoogleSheetTab(spreadsheetId, "Dashboard");
  if (!dashTab || dashTab.length === 0) {
    throw new Error("Google Sheet 'Dashboard' tab was not populated!");
  }

  console.log("  → Dashboard Tab Content Preview:");
  dashTab.slice(0, 12).forEach((r) => console.log(`    [${r.join(" : ")}]`));

  // Verify structure: Company Name, Last Sync, Revenue, Expenses, Profit, Receivables, Payables, Cash Balance
  const flatText = JSON.stringify(dashTab);
  if (!flatText.includes("Revenue") || !flatText.includes("Expenses") || !flatText.includes("Profit")) {
    throw new Error("Dashboard tab missing Revenue/Expenses/Profit section!");
  }
  if (!flatText.includes("Receivables") || !flatText.includes("Payables") || !flatText.includes("Cash Balance")) {
    throw new Error("Dashboard tab missing Receivables/Payables/Cash Balance section!");
  }
  console.log(`  ✓ 'Dashboard' tab populated with ${dashTab.length} rows including financial metrics.`);

  // 6. Verify HTML Pages Load
  console.log("\n[6/6] Verifying all HTML pages load with 200 OK...");
  const pages = [
    "/dashboard",
    "/dashboard/ledgers",
    "/dashboard/vouchers",
    "/dashboard/trial-balance",
    "/dashboard/sync-history",
  ];

  for (const page of pages) {
    const pageRes = await fetch(`${API_URL}${page}`);
    if (!pageRes.ok) throw new Error(`Page ${page} failed to load: HTTP ${pageRes.status}`);
    const text = await pageRes.text();
    if (!text.includes("FinLayer") || text.length < 500) {
      throw new Error(`Page ${page} returned incomplete or invalid HTML!`);
    }
    console.log(`  ✓ ${page} -> 200 OK (${text.length} bytes)`);
  }

  console.log("\n===============================================================");
  console.log("   🎉 ALL SAAS DASHBOARD VERIFICATION TESTS PASSED!");
  console.log("===============================================================\n");
}

main().catch((err) => {
  console.error("\n❌ Verification Failed:", err);
  process.exit(1);
});
