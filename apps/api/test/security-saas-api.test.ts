import assert from "node:assert/strict";
import Fastify from "fastify";
import { saasApiRoutes } from "../src/routes/saas-api.js";
import { generateSaasApiKey, revokeSaasApiKey } from "../src/auth/saas-auth.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runSaasApiSecurityTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: SAAS API SECURITY & ISOLATION TEST SUITE          ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(saasApiRoutes, { prefix: "/api/v1" });
  await app.ready();

  const timestamp = Date.now();
  const companyAName = `SaaS Tenant A Co ${timestamp}`;
  const companyBName = `SaaS Tenant B Co ${timestamp}`;

  let companyAId: string = "";
  let companyBId: string = "";
  let rawKeyA: string = "";
  let keyRecordAId: string = "";
  let rawKeyB: string = "";
  let keyRecordBId: string = "";
  let rawKeyRevoked: string = "";
  let keyRecordRevokedId: string = "";

  try {
    // ── Setup: Create Two Distinct Companies ──────────────────────────────────
    console.log(`[Setup] Creating Tenant A: "${companyAName}"...`);
    const compA = await prisma.company.create({
      data: {
        name: companyAName,
        tallyCompanyName: companyAName,
      },
    });
    companyAId = compA.id;

    console.log(`[Setup] Creating Tenant B: "${companyBName}"...`);
    const compB = await prisma.company.create({
      data: {
        name: companyBName,
        tallyCompanyName: companyBName,
      },
    });
    companyBId = compB.id;

    // ── Setup: Issue Scoped SaaS API Keys ────────────────────────────────────
    console.log("[Setup] Issuing API key for Company A...");
    const keyAData = await generateSaasApiKey({
      companyId: companyAId,
      name: "Tenant A Primary Key",
    });
    rawKeyA = keyAData.apiKey;
    keyRecordAId = keyAData.keyRecord.id;

    console.log("[Setup] Issuing API key for Company B...");
    const keyBData = await generateSaasApiKey({
      companyId: companyBId,
      name: "Tenant B Primary Key",
    });
    rawKeyB = keyBData.apiKey;
    keyRecordBId = keyBData.keyRecord.id;

    console.log("[Setup] Issuing & revoking an API key for Company A...");
    const revokedKeyData = await generateSaasApiKey({
      companyId: companyAId,
      name: "Tenant A Revoked Key",
    });
    rawKeyRevoked = revokedKeyData.apiKey;
    keyRecordRevokedId = revokedKeyData.keyRecord.id;
    await revokeSaasApiKey(keyRecordRevokedId);

    // ── Setup: Seed Financial Data for Company A ──────────────────────────────
    console.log("[Setup] Seeding ledgers and vouchers for Company A...");
    const ledgerCash = await prisma.ledger.create({
      data: {
        companyId: companyAId,
        name: "Cash-in-Hand",
        parent: "Current Assets",
        masterId: 1001,
        alterId: 1,
      },
    });

    const ledgerSales = await prisma.ledger.create({
      data: {
        companyId: companyAId,
        name: "Sales Account",
        parent: "Sales Accounts",
        masterId: 1002,
        alterId: 1,
      },
    });

    const voucher1 = await prisma.voucher.create({
      data: {
        companyId: companyAId,
        voucherNumber: "INV-001",
        voucherType: "Sales",
        date: new Date("2026-03-01T10:00:00.000Z"),
        partyName: "Customer Alpha",
        amount: 2500.0,
        masterId: 5001,
        alterId: 1,
        voucherEntries: {
          create: [
            { ledgerId: ledgerCash.id, amount: 2500.0, type: "debit" },
            { ledgerId: ledgerSales.id, amount: 2500.0, type: "credit" },
          ],
        },
      },
    });

    const voucher2 = await prisma.voucher.create({
      data: {
        companyId: companyAId,
        voucherNumber: "INV-002",
        voucherType: "Sales",
        date: new Date("2026-03-15T14:30:00.000Z"),
        partyName: "Customer Beta",
        amount: 4500.0,
        masterId: 5002,
        alterId: 1,
        voucherEntries: {
          create: [
            { ledgerId: ledgerCash.id, amount: 4500.0, type: "debit" },
            { ledgerId: ledgerSales.id, amount: 4500.0, type: "credit" },
          ],
        },
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SECURITY TEST 1: No API Key -> Expected: 401
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 1] Request without API key...");
    const res1 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}`,
    });
    assert.equal(res1.statusCode, 401, "Test 1 Failed: Expected 401 Unauthorized for missing API key");
    const body1 = res1.json();
    assert.equal(body1.success, false);
    console.log("  ✔ Test 1 Passed: 401 Unauthorized returned when no API key is provided.");

    // ─────────────────────────────────────────────────────────────────────────
    // SECURITY TEST 2: Invalid API Key -> Expected: 401
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 2] Request with invalid API key...");
    const res2 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}`,
      headers: {
        authorization: "Bearer fl_live_invalidkey99999999999999999999",
      },
    });
    assert.equal(res2.statusCode, 401, "Test 2 Failed: Expected 401 Unauthorized for invalid API key");
    const body2 = res2.json();
    assert.equal(body2.success, false);
    console.log("  ✔ Test 2 Passed: 401 Unauthorized returned for forged/invalid API key.");

    // ─────────────────────────────────────────────────────────────────────────
    // SECURITY TEST 3: Revoked API Key -> Expected: 401
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 3] Request with revoked API key...");
    const res3 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}`,
      headers: {
        authorization: `Bearer ${rawKeyRevoked}`,
      },
    });
    assert.equal(res3.statusCode, 401, "Test 3 Failed: Expected 401 Unauthorized for revoked API key");
    const body3 = res3.json();
    assert.equal(body3.success, false);
    assert.match(body3.error, /revoked/i, "Error message must indicate key is revoked");
    console.log("  ✔ Test 3 Passed: 401 Unauthorized returned for revoked API key.");

    // ─────────────────────────────────────────────────────────────────────────
    // SECURITY TEST 4: Company A key requesting Company B data -> Expected: 403
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Company A key requesting Company B data (Cross-Tenant Access)...");
    
    // Test on metadata endpoint
    const res4Meta = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyBId}`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res4Meta.statusCode, 403, "Test 4 Failed: Expected 403 Forbidden for cross-company metadata access");

    // Test on ledgers endpoint
    const res4Ledgers = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyBId}/ledgers`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res4Ledgers.statusCode, 403, "Test 4 Failed: Expected 403 Forbidden for cross-company ledgers access");

    // Test on trial balance endpoint
    const res4TB = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyBId}/trial-balance`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res4TB.statusCode, 403, "Test 4 Failed: Expected 403 Forbidden for cross-company trial-balance access");

    // Test on vouchers endpoint
    const res4Vouchers = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyBId}/vouchers`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res4Vouchers.statusCode, 403, "Test 4 Failed: Expected 403 Forbidden for cross-company vouchers access");

    console.log("  ✔ Test 4 Passed: 403 Forbidden strictly enforced across all endpoints for cross-company access.");

    // ─────────────────────────────────────────────────────────────────────────
    // SECURITY TEST 5: Valid Company Request -> Expected: 200
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 5] Valid company request with authorized key...");
    const res5 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res5.statusCode, 200, "Test 5 Failed: Expected 200 OK for valid company request");
    const body5 = res5.json();
    assert.equal(body5.success, true);
    assert.equal(body5.data.id, companyAId);
    assert.equal(body5.data.name, companyAName);
    console.log("  ✔ Test 5 Passed: 200 OK returned with correct company metadata.");

    // ─────────────────────────────────────────────────────────────────────────
    // ADDITIONAL TEST 6: Canonical Ledgers with Cursor Pagination
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 6] GET /api/v1/companies/:companyId/ledgers with limit & pagination...");
    const res6 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/ledgers?limit=1`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res6.statusCode, 200);
    const body6 = res6.json();
    assert.equal(body6.success, true);
    assert.equal(body6.data.length, 1, "Should respect limit=1");
    assert.equal(body6.pagination.hasMore, true, "Should indicate hasMore=true");
    assert.ok(body6.pagination.nextCursor, "Should provide nextCursor");

    // Fetch next page using cursor
    const res6Page2 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/ledgers?limit=1&cursor=${body6.pagination.nextCursor}`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res6Page2.statusCode, 200);
    const body6Page2 = res6Page2.json();
    assert.equal(body6Page2.data.length, 1);
    assert.notEqual(body6Page2.data[0].id, body6.data[0].id, "Page 2 must contain different ledger");
    console.log("  ✔ Test 6 Passed: Cursor-based database pagination verified on ledgers.");

    // ─────────────────────────────────────────────────────────────────────────
    // ADDITIONAL TEST 7: Canonical Trial Balance with Date Filter & Balanced Totals
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 7] GET /api/v1/companies/:companyId/trial-balance with date filtering...");
    const res7 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/trial-balance?startDate=2026-03-01&endDate=2026-03-31`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res7.statusCode, 200);
    const body7 = res7.json();
    assert.equal(body7.success, true);
    assert.ok(body7.data.length >= 2, "Should return aggregated trial balance entries");
    assert.equal(body7.totals.isBalanced, true, "Debit total must match credit total");
    assert.equal(body7.totals.debitTotal, 7000.0, "Total debit should be 2500 + 4500 = 7000");
    assert.equal(body7.totals.creditTotal, 7000.0, "Total credit should be 2500 + 4500 = 7000");
    console.log("  ✔ Test 7 Passed: Trial balance accurately aggregates and validates double-entry balance.");

    // ─────────────────────────────────────────────────────────────────────────
    // ADDITIONAL TEST 8: Canonical Vouchers with Cursor Pagination & Date Filter
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 8] GET /api/v1/companies/:companyId/vouchers with cursor pagination & date filter...");
    const res8 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/vouchers?limit=1&startDate=2026-03-01&endDate=2026-03-31`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res8.statusCode, 200);
    const body8 = res8.json();
    assert.equal(body8.success, true);
    assert.equal(body8.data.length, 1, "Should return 1 voucher with limit=1");
    assert.equal(body8.pagination.hasMore, true);
    assert.ok(body8.pagination.nextCursor);
    assert.ok(body8.data[0].entries.length >= 2, "Voucher must contain entries");
    console.log("  ✔ Test 8 Passed: Voucher cursor pagination and date filtering verified.");

    // ─────────────────────────────────────────────────────────────────────────
    // ADDITIONAL TEST 9: NDJSON Streaming
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 9] GET /api/v1/companies/:companyId/vouchers?stream=true (NDJSON Streaming)...");
    const res9 = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/vouchers?stream=true`,
      headers: {
        authorization: `Bearer ${rawKeyA}`,
      },
    });
    assert.equal(res9.statusCode, 200);
    assert.match(res9.headers["content-type"] ?? "", /application\/x-ndjson/);
    const lines = res9.payload.trim().split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 2, "Stream should return 2 vouchers as individual JSON lines");
    const streamedVoucher1 = JSON.parse(lines[0]);
    assert.ok(streamedVoucher1.id);
    assert.ok(streamedVoucher1.voucherNumber);
    console.log("  ✔ Test 9 Passed: NDJSON chunked streaming successfully verified.");

    console.log("\n===================================================================");
    console.log("   ALL SAAS API SECURITY & FUNCTIONAL TESTS PASSED (100% SUCCESS)  ");
    console.log("===================================================================\n");
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────────
    console.log("[Cleanup] Removing test records...");
    if (keyRecordAId || keyRecordBId || keyRecordRevokedId) {
      await prisma.apiKey.deleteMany({
        where: {
          id: {
            in: [keyRecordAId, keyRecordBId, keyRecordRevokedId].filter(Boolean),
          },
        },
      });
    }

    if (companyAId || companyBId) {
      // Cascade delete vouchers & entries
      await prisma.voucherEntry.deleteMany({
        where: {
          voucher: {
            companyId: { in: [companyAId, companyBId].filter(Boolean) },
          },
        },
      });
      await prisma.voucher.deleteMany({
        where: {
          companyId: { in: [companyAId, companyBId].filter(Boolean) },
        },
      });
      await prisma.ledger.deleteMany({
        where: {
          companyId: { in: [companyAId, companyBId].filter(Boolean) },
        },
      });
      await prisma.company.deleteMany({
        where: {
          id: { in: [companyAId, companyBId].filter(Boolean) },
        },
      });
    }

    await prisma.$disconnect();
    await pool.end();
  }
}

runSaasApiSecurityTests().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});
