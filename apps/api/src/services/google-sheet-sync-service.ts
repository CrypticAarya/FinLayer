import prisma from "../db/prisma.js";
import { decrypt } from "../utils/crypto.js";
import { isGoogleOAuthConfigured, isDemoMode } from "./google-sheets-service.js";
import { calculateFinancialSummary, type FinancialSummary } from "./financial-summary-service.js";

export interface SheetUpdateResult {
  success: boolean;
  tab: string;
  rowsWritten: number;
  cleared: boolean;
  error?: string;
}

export interface CompanySyncToSheetsResult {
  success: boolean;
  companyId: string;
  spreadsheetId?: string;
  dashboard?: SheetUpdateResult;
  trialBalance?: SheetUpdateResult;
  ledgers?: SheetUpdateResult;
  transactions?: SheetUpdateResult;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

// ─── In-Memory Mock Store for Testing / Development ───────────────────────────
// spreadsheetId -> (tabName -> 2D array of rows)
const mockGoogleSheetsStore = new Map<string, Map<string, any[][]>>();

export function getMockGoogleSheetTab(
  spreadsheetId: string,
  tabName: string
): any[][] | undefined {
  return mockGoogleSheetsStore.get(spreadsheetId)?.get(tabName);
}

export function resetMockGoogleSheetStore(): void {
  mockGoogleSheetsStore.clear();
}

/**
 * Refreshes the Google OAuth access token using a stored refresh token.
 */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  // If in demo mode, mock mode, or dev mock/demo token, return mock access token immediately
  if (
    !clientId ||
    !clientSecret ||
    refreshToken.startsWith("mock_") ||
    refreshToken.startsWith("demo_") ||
    isDemoMode()
  ) {
    return `demo_access_token_${Date.now()}`;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "(no body)");
    throw new Error(`Google token refresh error: ${res.status} ${res.statusText} — ${errorText}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Clears an existing tab in Google Sheets.
 */
async function clearTab(
  spreadsheetId: string,
  tabName: string,
  accessToken: string
): Promise<void> {
  if (
    isDemoMode() ||
    !isGoogleOAuthConfigured() ||
    spreadsheetId.startsWith("1mock_") ||
    spreadsheetId.startsWith("mock_") ||
    spreadsheetId.startsWith("1demo_") ||
    spreadsheetId.startsWith("demo_")
  ) {
    let sheetMap = mockGoogleSheetsStore.get(spreadsheetId);
    if (!sheetMap) {
      sheetMap = new Map();
      mockGoogleSheetsStore.set(spreadsheetId, sheetMap);
    }
    sheetMap.set(tabName, []);
    return;
  }

  const encodedRange = encodeURIComponent(`'${tabName}'!A:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}:clear`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "(no body)");
    throw new Error(`Google Sheets clear error on tab "${tabName}": ${res.status} ${res.statusText} — ${errorText}`);
  }
}

/**
 * Writes data matrix (headers + rows) to a tab starting at A1.
 */
async function writeTab(
  spreadsheetId: string,
  tabName: string,
  values: any[][],
  accessToken: string
): Promise<void> {
  if (
    isDemoMode() ||
    !isGoogleOAuthConfigured() ||
    spreadsheetId.startsWith("1mock_") ||
    spreadsheetId.startsWith("mock_") ||
    spreadsheetId.startsWith("1demo_") ||
    spreadsheetId.startsWith("demo_")
  ) {
    let sheetMap = mockGoogleSheetsStore.get(spreadsheetId);
    if (!sheetMap) {
      sheetMap = new Map();
      mockGoogleSheetsStore.set(spreadsheetId, sheetMap);
    }
    sheetMap.set(tabName, values);
    console.log(`[DEMO_MODE] Wrote ${values.length} rows to tab "${tabName}" in sheet "${spreadsheetId}"`);
    return;
  }

  const encodedRange = encodeURIComponent(`'${tabName}'!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      range: `'${tabName}'!A1`,
      majorDimension: "ROWS",
      values,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "(no body)");
    throw new Error(`Google Sheets write error on tab "${tabName}": ${res.status} ${res.statusText} — ${errorText}`);
  }
}

/**
 * Helper to get GoogleConnection and valid access token for a company.
 */
async function getCompanyGoogleAuth(companyId: string) {
  const connection = await prisma.googleConnection.findUnique({
    where: { companyId },
  });

  if (!connection) {
    return null;
  }

  const plainRefreshToken = decrypt(connection.refreshToken);
  const accessToken = await refreshGoogleAccessToken(plainRefreshToken);

  return {
    connection,
    accessToken,
  };
}

/**
 * Updates the 'Trial Balance' sheet tab:
 * - Clears old data
 * - Adds headers: ["Ledger Name", "Group Name", "Debit Amount", "Credit Amount"]
 * - Appends rows & summary row
 */
export async function updateTrialBalanceSheet(
  companyId: string,
  items?: Array<{ ledgerName: string; groupName: string; debitAmount: number; creditAmount: number }>
): Promise<SheetUpdateResult> {
  const auth = await getCompanyGoogleAuth(companyId);
  if (!auth) {
    return {
      success: false,
      tab: "Trial Balance",
      rowsWritten: 0,
      cleared: false,
      error: "No GoogleConnection found for this company",
    };
  }

  const { connection, accessToken } = auth;
  const tabName = "Trial Balance";

  // 1. Fetch entries from DB if not passed
  const entries = items || (await prisma.trialBalanceEntry.findMany({
    where: { companyId },
    orderBy: [{ groupName: "asc" }, { ledgerName: "asc" }],
  }));

  // 2. Clear old data
  await clearTab(connection.spreadsheetId, tabName, accessToken);

  // 3. Build headers and rows
  const headers = ["Ledger Name", "Group Name", "Debit Amount", "Credit Amount"];
  const rows: any[][] = [headers];

  let totalDebit = 0;
  let totalCredit = 0;

  for (const entry of entries) {
    rows.push([
      entry.ledgerName,
      entry.groupName,
      entry.debitAmount,
      entry.creditAmount,
    ]);
    totalDebit += Number(entry.debitAmount) || 0;
    totalCredit += Number(entry.creditAmount) || 0;
  }

  // Summary row
  rows.push(["Total", "", totalDebit, totalCredit]);

  // 4. Write new data
  await writeTab(connection.spreadsheetId, tabName, rows, accessToken);

  return {
    success: true,
    tab: tabName,
    rowsWritten: rows.length,
    cleared: true,
  };
}

/**
 * Updates the 'Ledgers' sheet tab:
 * - Clears old data
 * - Adds headers: ["Master ID", "Ledger Name", "Parent Group", "Alter ID"]
 * - Appends ledger rows
 */
export async function updateLedgersSheet(
  companyId: string,
  ledgers?: Array<{ name: string; parent: string; masterId: number; alterId: number }>
): Promise<SheetUpdateResult> {
  const auth = await getCompanyGoogleAuth(companyId);
  if (!auth) {
    return {
      success: false,
      tab: "Ledgers",
      rowsWritten: 0,
      cleared: false,
      error: "No GoogleConnection found for this company",
    };
  }

  const { connection, accessToken } = auth;
  const tabName = "Ledgers";

  // 1. Fetch ledgers from DB if not passed
  const ledgerList = ledgers || (await prisma.ledger.findMany({
    where: { companyId },
    orderBy: [{ name: "asc" }, { masterId: "asc" }],
  }));

  // 2. Clear old data
  await clearTab(connection.spreadsheetId, tabName, accessToken);

  // 3. Build headers and rows
  const headers = ["Master ID", "Ledger Name", "Group / Parent", "Alter ID"];
  const rows: any[][] = [headers];

  for (const l of ledgerList) {
    rows.push([
      l.masterId,
      l.name,
      l.parent,
      l.alterId,
    ]);
  }

  // 4. Write new data
  await writeTab(connection.spreadsheetId, tabName, rows, accessToken);

  return {
    success: true,
    tab: tabName,
    rowsWritten: rows.length,
    cleared: true,
  };
}

/**
 * Updates the 'Transactions' sheet tab:
 * - Clears old data
 * - Adds headers: ["Date", "Voucher Number", "Voucher Type", "Party Name", "Total Amount", "Ledger Name", "Type", "Entry Amount"]
 * - Appends transaction rows
 */
export async function updateTransactionsSheet(
  companyId: string,
  vouchers?: any[]
): Promise<SheetUpdateResult> {
  const auth = await getCompanyGoogleAuth(companyId);
  if (!auth) {
    return {
      success: false,
      tab: "Transactions",
      rowsWritten: 0,
      cleared: false,
      error: "No GoogleConnection found for this company",
    };
  }

  const { connection, accessToken } = auth;
  const tabName = "Transactions";

  // 1. Fetch vouchers with voucher entries and ledgers from DB
  const voucherList = vouchers || (await prisma.voucher.findMany({
    where: { companyId },
    include: {
      voucherEntries: {
        include: {
          ledger: true,
        },
      },
    },
    orderBy: { date: "asc" },
  }));

  // 2. Clear old data
  await clearTab(connection.spreadsheetId, tabName, accessToken);

  // 3. Build headers and rows
  const headers = [
    "Date",
    "Voucher Number",
    "Voucher Type",
    "Party Name",
    "Total Amount",
    "Ledger Name",
    "Type",
    "Entry Amount",
  ];
  const rows: any[][] = [headers];

  for (const v of voucherList) {
    const formattedDate = v.date instanceof Date
      ? v.date.toISOString().split("T")[0]
      : String(v.date || "").split("T")[0];

    if (v.voucherEntries && Array.isArray(v.voucherEntries) && v.voucherEntries.length > 0) {
      for (const entry of v.voucherEntries) {
        const ledgerName = entry.ledger?.name || entry.ledgerName || "";
        rows.push([
          formattedDate,
          v.voucherNumber,
          v.voucherType,
          v.partyName || "",
          Number(v.amount),
          ledgerName,
          String(entry.type || "").toUpperCase(),
          Number(entry.amount),
        ]);
      }
    } else if (v.entries && Array.isArray(v.entries) && v.entries.length > 0) {
      for (const entry of v.entries) {
        rows.push([
          formattedDate,
          v.voucherNumber,
          v.voucherType,
          v.partyName || "",
          Number(v.amount),
          entry.ledgerName || "",
          String(entry.type || "").toUpperCase(),
          Number(entry.amount),
        ]);
      }
    } else {
      rows.push([
        formattedDate,
        v.voucherNumber,
        v.voucherType,
        v.partyName || "",
        Number(v.amount),
        "",
        "",
        Number(v.amount),
      ]);
    }
  }

  // 4. Write new data
  await writeTab(connection.spreadsheetId, tabName, rows, accessToken);

  return {
    success: true,
    tab: tabName,
    rowsWritten: rows.length,
    cleared: true,
  };
}

/**
 * Updates the 'Dashboard' sheet tab:
 * - Clears old data
 * - Structure:
 *   Company Name
 *   Last Sync
 *   Revenue, Expenses, Profit
 *   Receivables, Payables, Cash Balance
 */
export async function updateDashboardSheet(
  companyId: string,
  summaryData?: FinancialSummary
): Promise<SheetUpdateResult> {
  const auth = await getCompanyGoogleAuth(companyId);
  if (!auth) {
    return {
      success: false,
      tab: "Dashboard",
      rowsWritten: 0,
      cleared: false,
      error: "No GoogleConnection found for this company",
    };
  }

  const { connection, accessToken } = auth;
  const tabName = "Dashboard";

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      syncHistories: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const lastSync = company?.syncHistories[0];
  const lastSyncTime = lastSync?.completedAt
    ? new Date(lastSync.completedAt).toLocaleString("en-IN")
    : new Date().toLocaleString("en-IN");

  const summary = summaryData || (await calculateFinancialSummary(companyId));

  await clearTab(connection.spreadsheetId, tabName, accessToken);

  const rows: any[][] = [
    ["Company Name", company?.name || "Company"],
    ["Last Sync", lastSyncTime],
    ["", ""],
    ["Financial Metric", "Amount (₹)"],
    ["Revenue", summary.revenue],
    ["Expenses", summary.expenses],
    ["Profit", summary.profit],
    ["", ""],
    ["Liquidity & Working Capital", "Amount (₹)"],
    ["Receivables", summary.receivables],
    ["Payables", summary.payables],
    ["Cash Balance", summary.cashBalance],
  ];

  await writeTab(connection.spreadsheetId, tabName, rows, accessToken);

  return {
    success: true,
    tab: tabName,
    rowsWritten: rows.length,
    cleared: true,
  };
}

/**
 * Coordinated pipeline to update all 4 financial data tabs in the connected spreadsheet:
 * - Dashboard
 * - Trial Balance
 * - Ledgers
 * - Transactions
 */
export async function syncCompanyFinancialDataToGoogleSheets(
  companyId: string
): Promise<CompanySyncToSheetsResult> {
  const connection = await prisma.googleConnection.findUnique({
    where: { companyId },
  });

  if (!connection) {
    return {
      success: true,
      companyId,
      skipped: true,
      reason: "No Google account connected for this company",
    };
  }

  try {
    const dashboard = await updateDashboardSheet(companyId);
    const trialBalance = await updateTrialBalanceSheet(companyId);
    const ledgers = await updateLedgersSheet(companyId);
    const transactions = await updateTransactionsSheet(companyId);

    return {
      success: dashboard.success && trialBalance.success && ledgers.success && transactions.success,
      companyId,
      spreadsheetId: connection.spreadsheetId,
      dashboard,
      trialBalance,
      ledgers,
      transactions,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      companyId,
      spreadsheetId: connection.spreadsheetId,
      error: errorMsg,
    };
  }
}
