/**
 * FinLayer SaaS API — JavaScript / Node.js Integration Quickstart
 * 
 * Demonstrates:
 * 1. API key authentication using native fetch (Node 18+)
 * 2. Fetching company metadata
 * 3. Fetching and validating Trial Balance
 * 4. Fetching vouchers with cursor pagination
 * 
 * Usage:
 *   node quickstart.js
 */

const BASE_URL = process.env.FINLAYER_BASE_URL || "http://localhost:4000/api/v1";
const API_KEY = process.env.FINLAYER_API_KEY || "fl_live_your_api_key_here";
const COMPANY_ID = process.env.FINLAYER_COMPANY_ID || "cmu84468l00001s3tnvjagcrz";

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Accept": "application/json",
      ...options.headers,
    },
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`API Error [${res.status}]: ${body.error || res.statusText}`);
  }
  return body;
}

async function main() {
  console.log("===================================================================");
  console.log(" FinLayer SaaS API: JavaScript Integration Quickstart");
  console.log(` Base URL:    ${BASE_URL}`);
  console.log(` Company ID:  ${COMPANY_ID}`);
  console.log("===================================================================\n");

  try {
    // ─── 1. Fetch Company Details ───────────────────────────────────────────
    console.log("[1/3] Fetching Company Metadata...");
    const companyRes = await request(`/companies/${COMPANY_ID}`);
    const company = companyRes.data;
    console.log(`  ✓ Company Name:   "${company.name}"`);
    console.log(`  ✓ Tally System:   ${company.tallyCompanyName || "N/A"}`);
    console.log(`  ✓ Sync Status:    ${company.connectorStatus || "ONLINE"}`);
    console.log(`  ✓ Last Sync At:   ${company.lastSyncAt ? new Date(company.lastSyncAt).toLocaleString() : "Real-time"}\n`);

    // ─── 2. Fetch Trial Balance & Verify Double-Entry Equation ───────────────
    console.log("[2/3] Fetching Trial Balance...");
    const tbRes = await request(`/companies/${COMPANY_ID}/trial-balance`);
    const { totals, data: ledgers } = tbRes;
    console.log(`  ✓ Accounts Count: ${ledgers.length}`);
    console.log(`  ✓ Total Debit:    ₹ ${totals.debitTotal.toFixed(2)}`);
    console.log(`  ✓ Total Credit:   ₹ ${totals.creditTotal.toFixed(2)}`);
    const diff = Math.abs(totals.debitTotal - totals.creditTotal);
    console.log(`  ✓ Net Difference: ₹ ${diff.toFixed(2)}`);
    console.log(`  ✓ Balance Status: ${totals.isBalanced ? "BALANCED (Debit === Credit)" : "UNBALANCED"}\n`);

    // ─── 3. Fetch Vouchers with Cursor Pagination ───────────────────────────
    console.log("[3/3] Fetching Vouchers (first page, limit=5)...");
    const vouchersRes = await request(`/companies/${COMPANY_ID}/vouchers?limit=5`);
    const { data: vouchers, pagination } = vouchersRes;
    console.log(`  ✓ Vouchers Count: ${vouchers.length} (total: ${pagination.totalCount || vouchers.length})`);
    console.log(`  ✓ Has Next Page:  ${pagination.hasMore}`);
    if (pagination.nextCursor) {
      console.log(`  ✓ Next Cursor:    "${pagination.nextCursor}"`);
    }

    if (vouchers.length > 0) {
      const sample = vouchers[0];
      console.log(`\n  Sample Voucher:`);
      console.log(`    Number: #${sample.voucherNumber} (${sample.voucherType})`);
      console.log(`    Date:   ${new Date(sample.date).toLocaleDateString()}`);
      console.log(`    Amount: ₹ ${sample.amount.toFixed(2)}`);
      console.log(`    Legs:`);
      for (const entry of sample.entries) {
        console.log(`      • [${entry.type.toUpperCase()}] ${entry.ledgerName.padEnd(24)} ₹ ${entry.amount.toFixed(2)}`);
      }
    }

    console.log("\n===================================================================");
    console.log(" SUCCESS: FinLayer SaaS API integration verified successfully!");
    console.log("===================================================================\n");
  } catch (err) {
    console.error("\n❌ Integration flow failed:", err.message);
    process.exit(1);
  }
}

main();
