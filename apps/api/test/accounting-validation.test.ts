import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { syncRoutes } from "../src/routes/sync.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runAccountingValidationTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: ACCOUNTING VALIDATION & INTEGRITY TEST SUITE      ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(syncRoutes);
  await app.ready();

  const testCompanyName = `Test Co Validation ${Date.now()}`;
  let companyId: string;
  let testConnectorId: string;

  try {
    // ── Setup: Create Test Company & Known Ledgers ──────────────────────────
    console.log(`[Setup] Creating test company: "${testCompanyName}"...`);
    const company = await prisma.company.create({
      data: {
        name: testCompanyName,
        tallyCompanyName: testCompanyName,
      },
    });
    companyId = company.id;

    // ── Setup: Test Connector for Authentication ───────────────────────────
    const testToken = `fl_conn_${crypto.randomBytes(32).toString("hex")}`;
    const tokenHash = crypto.createHash("sha256").update(testToken).digest("hex");
    const testConnector = await prisma.connector.create({
      data: {
        deviceId: `test-device-val-${Date.now()}`,
        name: "Validation Test Connector",
        companyId,
        tallyCompanyName: testCompanyName,
        tokenHash,
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    testConnectorId = testConnector.id;
    const authHeaders = { authorization: `Bearer ${testToken}` };

    console.log(`[Setup] Seeding verified ledgers...`);
    await prisma.ledger.create({
      data: {
        companyId,
        name: "HDFC Bank",
        parent: "Bank Accounts",
        masterId: 501,
        alterId: 1,
      },
    });

    await prisma.ledger.create({
      data: {
        companyId,
        name: "Consulting Revenue",
        parent: "Direct Income",
        masterId: 502,
        alterId: 1,
      },
    });

    await prisma.ledger.create({
      data: {
        companyId,
        name: "Office Supplies",
        parent: "Indirect Expenses",
        masterId: 503,
        alterId: 1,
      },
    });

    // ── TEST 1: Balanced Voucher (Accepted) ─────────────────────────────────
    console.log("\n[Test 1] Ingesting balanced voucher (Debit 2500.00 === Credit 2500.00)...");
    const balancedVoucher = {
      masterId: 3001,
      alterId: 1,
      voucherNumber: "INV-BAL-001",
      voucherType: "Sales",
      date: "2026-03-15T00:00:00.000Z",
      partyName: "HDFC Bank",
      amount: 2500,
      entries: [
        { ledgerName: "HDFC Bank", amount: 2500, type: "debit" },
        { ledgerName: "Consulting Revenue", amount: 2500, type: "credit" },
      ],
    };

    const res1 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "validation-run-1",
        vouchers: [balancedVoucher],
      },
    });

    assert.equal(res1.statusCode, 200);
    const body1 = res1.json();
    assert.equal(body1.created, 1, `Expected created: 1, got ${body1.created}`);
    assert.equal(body1.failed, 0, `Expected failed: 0, got ${body1.failed}`);
    assert.equal(body1.validationFailed, 0, `Expected validationFailed: 0, got ${body1.validationFailed}`);

    const dbVoucher1 = await prisma.voucher.findUnique({
      where: { companyId_masterId: { companyId, masterId: 3001 } },
      include: { voucherEntries: true },
    });
    assert.ok(dbVoucher1, "Balanced voucher must be persisted in database");
    assert.equal(dbVoucher1.voucherEntries.length, 2, "Voucher must have 2 entries");
    console.log("  ✓ Test 1 Passed: Balanced voucher successfully validated and committed.");

    // ── TEST 2: Debit != Credit (Rejected) ──────────────────────────────────
    console.log("\n[Test 2] Ingesting unbalanced voucher (Debit 5000.00 != Credit 4500.00)...");
    const unbalancedVoucher = {
      masterId: 3002,
      alterId: 1,
      voucherNumber: "INV-UNBAL-002",
      voucherType: "Sales",
      date: "2026-03-15T00:00:00.000Z",
      partyName: "HDFC Bank",
      amount: 5000,
      entries: [
        { ledgerName: "HDFC Bank", amount: 5000, type: "debit" },
        { ledgerName: "Consulting Revenue", amount: 4500, type: "credit" },
      ],
    };

    const res2 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "validation-run-2",
        vouchers: [unbalancedVoucher],
      },
    });

    assert.equal(res2.statusCode, 200);
    const body2 = res2.json();
    assert.equal(body2.created, 0, `Expected created: 0, got ${body2.created}`);
    assert.equal(body2.failed, 1, `Expected failed: 1, got ${body2.failed}`);
    assert.equal(body2.validationFailed, 1, `Expected validationFailed: 1, got ${body2.validationFailed}`);

    const dbVoucher2 = await prisma.voucher.findUnique({
      where: { companyId_masterId: { companyId, masterId: 3002 } },
    });
    assert.equal(dbVoucher2, null, "Unbalanced voucher must NEVER be saved to the database");
    console.log("  ✓ Test 2 Passed: Unbalanced voucher strictly rejected; zero database mutation.");

    // ── TEST 3: Missing Ledger Reference (Rejected) ─────────────────────────
    console.log("\n[Test 3] Ingesting voucher referencing an unknown ledger...");
    const missingLedgerVoucher = {
      masterId: 3003,
      alterId: 1,
      voucherNumber: "INV-MISSING-LEDGER-003",
      voucherType: "Payment",
      date: "2026-03-15T00:00:00.000Z",
      partyName: "NonExistent Vendor XYZ",
      amount: 1200,
      entries: [
        { ledgerName: "Office Supplies", amount: 1200, type: "debit" },
        { ledgerName: "NonExistent_Bank_Account_999", amount: 1200, type: "credit" },
      ],
    };

    const res3 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "validation-run-3",
        vouchers: [missingLedgerVoucher],
      },
    });

    assert.equal(res3.statusCode, 200);
    const body3 = res3.json();
    assert.equal(body3.created, 0, `Expected created: 0, got ${body3.created}`);
    assert.equal(body3.failed, 1, `Expected failed: 1, got ${body3.failed}`);
    assert.equal(body3.validationFailed, 1, `Expected validationFailed: 1, got ${body3.validationFailed}`);

    const dbVoucher3 = await prisma.voucher.findUnique({
      where: { companyId_masterId: { companyId, masterId: 3003 } },
    });
    assert.equal(dbVoucher3, null, "Voucher with missing ledger must NOT be persisted in database");
    console.log("  ✓ Test 3 Passed: Missing ledger voucher rejected cleanly; zero partial records.");

    // ── TEST 4: 1,000 Balanced Vouchers (All Accepted) ──────────────────────
    console.log("\n[Test 4] Benchmarking 1,000 strictly balanced vouchers...");
    const bulk1000 = Array.from({ length: 1000 }, (_, i) => {
      const amt = 100 + (i % 500);
      return {
        masterId: 20000 + i,
        alterId: 1,
        guid: `guid-val-1000-${i}`,
        voucherNumber: `BAL-BULK-${String(i + 1).padStart(5, "0")}`,
        voucherType: "Payment",
        date: "2026-03-15T00:00:00.000Z",
        partyName: "Office Supplies",
        amount: amt,
        entries: [
          { ledgerName: "Office Supplies", amount: amt, type: "debit" },
          { ledgerName: "HDFC Bank", amount: amt, type: "credit" },
        ],
      };
    });

    const startTime = Date.now();
    const res4 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "validation-run-bulk",
        vouchers: bulk1000,
      },
    });
    const duration = Date.now() - startTime;

    assert.equal(res4.statusCode, 200);
    const body4 = res4.json();
    assert.equal(body4.created, 1000, `Expected created: 1000, got ${body4.created}`);
    assert.equal(body4.failed, 0, `Expected failed: 0, got ${body4.failed}`);
    assert.equal(body4.validationFailed, 0, `Expected validationFailed: 0, got ${body4.validationFailed}`);

    const finalDbCount = await prisma.voucher.count({ where: { companyId } });
    assert.equal(finalDbCount, 1001, `Expected 1001 total vouchers in DB (1 from Test 1 + 1000 from Test 4), found ${finalDbCount}`);
    console.log(`  ✓ Test 4 Passed: 1,000 balanced vouchers validated and committed in ${duration}ms (${(duration / 1000).toFixed(2)}s).`);

    console.log("\n===================================================================");
    console.log("   ALL 4 ACCOUNTING VALIDATION TESTS PASSED WITH 100% SUCCESS!     ");
    console.log("===================================================================\n");
  } finally {
    if (companyId!) {
      console.log(`[Cleanup] Cleaning up test validation records...`);
      await prisma.voucherEntry.deleteMany({
        where: { voucher: { companyId } },
      });
      await prisma.voucher.deleteMany({
        where: { companyId },
      });
      await prisma.syncAuditLog.deleteMany({
        where: { syncRun: { companyId } },
      });
      await prisma.syncRun.deleteMany({
        where: { companyId },
      });
      await prisma.ledger.deleteMany({
        where: { companyId },
      });
      if (testConnectorId!) {
        await prisma.connector.deleteMany({
          where: { id: testConnectorId },
        });
      }
      await prisma.company.delete({
        where: { id: companyId },
      });
      console.log(`[Cleanup] Done.`);
    }
    await app.close();
    await prisma.$disconnect();
    await pool.end();
  }
}

runAccountingValidationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
