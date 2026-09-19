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

async function runIdempotencyTests() {
  console.log("===============================================================");
  console.log("   FINLAYER API: VOUCHER IDEMPOTENCY & RESILIENCE TEST SUITE   ");
  console.log("===============================================================\n");

  const app = Fastify({ logger: false });
  await app.register(syncRoutes);
  await app.ready();

  const testCompanyName = `Test Co Idempotency ${Date.now()}`;
  let companyId: string;
  let testConnectorId: string;

  try {
    // ── Setup: Create Test Company & Ledgers ────────────────────────────────
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
        deviceId: `test-device-idemp-${Date.now()}`,
        name: "Idempotency Test Connector",
        companyId,
        tallyCompanyName: testCompanyName,
        tokenHash,
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    testConnectorId = testConnector.id;
    const authHeaders = { authorization: `Bearer ${testToken}` };

    console.log(`[Setup] Seeding test ledgers...`);
    await prisma.ledger.create({
      data: {
        companyId,
        name: "Sales Account",
        parent: "Sales Accounts",
        masterId: 1001,
        alterId: 1,
      },
    });

    await prisma.ledger.create({
      data: {
        companyId,
        name: "Acme Corp Debtors",
        parent: "Sundry Debtors",
        masterId: 1002,
        alterId: 1,
      },
    });

    // ── TEST 1: Initial Ingestion (Case 1: Create) ──────────────────────────
    console.log("\n[Test 1] Ingesting 5 new vouchers...");
    const sampleVouchers = Array.from({ length: 5 }, (_, i) => ({
      masterId: 2000 + i,
      alterId: 1,
      guid: `guid-test-${2000 + i}`,
      voucherNumber: `INV-2026-00${i + 1}`,
      voucherType: "Sales",
      date: "2026-03-15T00:00:00.000Z",
      partyName: "Acme Corp Debtors",
      amount: 5000 + i * 1000,
      entries: [
        { ledgerName: "Acme Corp Debtors", amount: -(5000 + i * 1000), type: "debit" },
        { ledgerName: "Sales Account", amount: 5000 + i * 1000, type: "credit" },
      ],
    }));

    const res1 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "run-001",
        vouchers: sampleVouchers,
      },
    });

    assert.equal(res1.statusCode, 200, `Expected 200 OK, got ${res1.statusCode}`);
    const body1 = res1.json();
    assert.equal(body1.created, 5, `Expected 5 created, got ${body1.created}`);
    assert.equal(body1.unchanged, 0, `Expected 0 unchanged, got ${body1.unchanged}`);
    assert.equal(body1.updated, 0, `Expected 0 updated, got ${body1.updated}`);
    assert.equal(body1.failed, 0, `Expected 0 failed, got ${body1.failed}`);

    const dbCount1 = await prisma.voucher.count({ where: { companyId } });
    assert.equal(dbCount1, 5, `Expected 5 vouchers in DB, got ${dbCount1}`);
    console.log("  ✓ Initial ingestion passed: 5 created, 0 skipped, 0 updated.");

    // ── TEST 2: Duplicate Ingestion (Case 2: Skip / Unchanged) ──────────────
    console.log("\n[Test 2] Re-syncing exact same 5 vouchers (idempotency check)...");
    const res2 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "run-002",
        vouchers: sampleVouchers,
      },
    });

    assert.equal(res2.statusCode, 200);
    const body2 = res2.json();
    assert.equal(body2.created, 0, `Expected 0 created, got ${body2.created}`);
    assert.equal(body2.unchanged, 5, `Expected 5 unchanged, got ${body2.unchanged}`);
    assert.equal(body2.updated, 0, `Expected 0 updated, got ${body2.updated}`);
    assert.equal(body2.failed, 0, `Expected 0 failed, got ${body2.failed}`);

    const dbCount2 = await prisma.voucher.count({ where: { companyId } });
    assert.equal(dbCount2, 5, `Database voucher count must still be 5, got ${dbCount2}`);
    console.log("  ✓ Idempotent re-sync passed: 0 created, 5 skipped (unchanged++), zero duplicates.");

    // ── TEST 3: AlterID Change (Case 3: Atomic Update) ──────────────────────
    console.log("\n[Test 3] Modifying 1 voucher with altered alterId (Case 3: Update)...");
    const modifiedVouchers = JSON.parse(JSON.stringify(sampleVouchers));
    // Modify voucher index 0: alterId 1 -> 2, amount 5000 -> 7500
    modifiedVouchers[0].alterId = 2;
    modifiedVouchers[0].amount = 7500;
    modifiedVouchers[0].entries[0].amount = -7500;
    modifiedVouchers[0].entries[1].amount = 7500;

    const res3 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "run-003",
        vouchers: modifiedVouchers,
      },
    });

    assert.equal(res3.statusCode, 200);
    const body3 = res3.json();
    assert.equal(body3.created, 0, `Expected 0 created, got ${body3.created}`);
    assert.equal(body3.updated, 1, `Expected 1 updated, got ${body3.updated}`);
    assert.equal(body3.unchanged, 4, `Expected 4 unchanged, got ${body3.unchanged}`);
    assert.equal(body3.failed, 0, `Expected 0 failed, got ${body3.failed}`);

    // Verify the DB updated record
    const updatedVoucher = await prisma.voucher.findUnique({
      where: {
        companyId_masterId: {
          companyId,
          masterId: 2000,
        },
      },
      include: { voucherEntries: true },
    });

    assert.equal(updatedVoucher?.alterId, 2, "Voucher alterId must be updated to 2");
    assert.equal(Number(updatedVoucher?.amount), 7500, "Voucher amount must be updated to 7500");
    assert.equal(updatedVoucher?.voucherEntries.length, 2, "Voucher entries must be replaced cleanly");
    assert.equal(
      Number(updatedVoucher?.voucherEntries.find((e) => e.type === "credit")?.amount),
      7500,
      "Credit entry amount must be 7500"
    );

    const dbCount3 = await prisma.voucher.count({ where: { companyId } });
    assert.equal(dbCount3, 5, `Total voucher count must remain 5, got ${dbCount3}`);
    console.log("  ✓ AlterID update passed: 1 updated, 4 unchanged, entries replaced atomically.");

    // ── TEST 4: Missing Ledger Handling & Atomicity ─────────────────────────
    console.log("\n[Test 4] Submitting voucher with unknown ledger (failure isolation)...");
    const badVoucher = {
      masterId: 9999,
      alterId: 1,
      voucherNumber: "BAD-001",
      voucherType: "Payment",
      date: "2026-03-15T00:00:00.000Z",
      amount: 100,
      entries: [
        { ledgerName: "NonExistentLedger_XYZ", amount: -100, type: "debit" },
        { ledgerName: "Sales Account", amount: 100, type: "credit" },
      ],
    };

    const res4 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "run-004",
        vouchers: [badVoucher],
      },
    });

    assert.equal(res4.statusCode, 200);
    const body4 = res4.json();
    assert.equal(body4.failed, 1, `Expected 1 failed, got ${body4.failed}`);
    assert.equal(body4.created, 0);

    const orphanCheck = await prisma.voucher.findUnique({
      where: {
        companyId_masterId: {
          companyId,
          masterId: 9999,
        },
      },
    });
    assert.equal(orphanCheck, null, "No partial voucher header must be created for failed voucher");
    console.log("  ✓ Missing ledger rejection passed: failed incremented, zero orphan records.");

    // ── TEST 5: High-Volume Benchmark (1,000 Vouchers) ─────────────────────
    console.log("\n[Test 5] Benchmarking 1,000 vouchers ingestion...");
    const bulk1000 = Array.from({ length: 1000 }, (_, i) => ({
      masterId: 10000 + i,
      alterId: 1,
      guid: `guid-bulk-${10000 + i}`,
      voucherNumber: `BULK-${String(i + 1).padStart(5, "0")}`,
      voucherType: "Sales",
      date: "2026-03-15T00:00:00.000Z",
      partyName: "Acme Corp Debtors",
      amount: 1000 + (i % 100),
      entries: [
        { ledgerName: "Acme Corp Debtors", amount: -(1000 + (i % 100)), type: "debit" },
        { ledgerName: "Sales Account", amount: 1000 + (i % 100), type: "credit" },
      ],
    }));

    const startCreate = Date.now();
    const res5 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "run-bulk-create",
        vouchers: bulk1000,
      },
    });
    const durationCreate = Date.now() - startCreate;

    assert.equal(res5.statusCode, 200);
    const body5 = res5.json();
    assert.equal(body5.created, 1000, `Expected 1000 created, got ${body5.created}`);
    assert.equal(body5.failed, 0);
    console.log(`  ✓ 1,000 vouchers created in ${durationCreate}ms (${(durationCreate / 1000).toFixed(2)}s).`);

    // Re-sync the 1,000 vouchers (All should be unchanged in memory)
    console.log("[Test 5b] Re-syncing 1,000 vouchers (in-memory O(1) skip benchmark)...");
    const startSkip = Date.now();
    const res6 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: "run-bulk-resync",
        vouchers: bulk1000,
      },
    });
    const durationSkip = Date.now() - startSkip;

    assert.equal(res6.statusCode, 200);
    const body6 = res6.json();
    assert.equal(body6.created, 0);
    assert.equal(body6.unchanged, 1000, `Expected 1000 unchanged, got ${body6.unchanged}`);
    assert.equal(body6.updated, 0);
    assert.equal(body6.failed, 0);
    console.log(`  ✓ 1,000 vouchers re-synced in ${durationSkip}ms! All skipped with zero DB duplicate writes.`);

    // ── Final Verification ──────────────────────────────────────────────────
    const totalVouchersInDb = await prisma.voucher.count({ where: { companyId } });
    assert.equal(totalVouchersInDb, 1005, `Expected 1,005 vouchers total, found ${totalVouchersInDb}`);

    console.log("\n===============================================================");
    console.log("   ALL 5 TESTS PASSED SUCCESSFULLY! IDEMPOTENCY VERIFIED.      ");
    console.log("===============================================================\n");
  } finally {
    // Cleanup test company and its records
    if (companyId!) {
      console.log(`[Cleanup] Cleaning up test company data...`);
      await prisma.voucherEntry.deleteMany({
        where: { voucher: { companyId } },
      });
      await prisma.voucher.deleteMany({
        where: { companyId },
      });
      await prisma.ledger.deleteMany({
        where: { companyId },
      });
      await prisma.syncAuditLog.deleteMany({
        where: { syncRun: { companyId } },
      });
      await prisma.syncRun.deleteMany({
        where: { companyId },
      });
      await prisma.syncLog.deleteMany({
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

runIdempotencyTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
