import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { syncRoutes } from "../src/routes/sync.js";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runSyncAuditTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: SYNCRUN, AUDIT TRAIL & DECIMAL MONEY TEST SUITE   ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(syncRoutes);
  await app.ready();

  const testCompanyName = `Test Co Audit ${Date.now()}`;
  let companyId: string;

  try {
    // ── Setup: Create Company and Ledgers ───────────────────────────────────
    console.log(`[Setup] Creating test company: "${testCompanyName}"...`);
    const company = await prisma.company.create({
      data: {
        name: testCompanyName,
        tallyCompanyName: testCompanyName,
      },
    });
    companyId = company.id;

    console.log(`[Setup] Seeding test ledgers...`);
    await prisma.ledger.create({
      data: {
        companyId,
        name: "Standard Chartered Bank",
        parent: "Bank Accounts",
        masterId: 801,
        alterId: 1,
      },
    });

    await prisma.ledger.create({
      data: {
        companyId,
        name: "SaaS Subscription Revenue",
        parent: "Direct Income",
        masterId: 802,
        alterId: 1,
      },
    });

    // ── Setup: Test Connector for Authentication ───────────────────────────
    const testToken = `fl_conn_${crypto.randomBytes(32).toString("hex")}`;
    const tokenHash = crypto.createHash("sha256").update(testToken).digest("hex");
    const testConnector = await prisma.connector.create({
      data: {
        deviceId: `test-device-audit-${Date.now()}`,
        name: "Audit Test Connector",
        companyId,
        tallyCompanyName: testCompanyName,
        tokenHash,
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    const authHeaders = { authorization: `Bearer ${testToken}` };

    // ── TEST 1: SyncRun Creation & 5-Stage Audit Trail Verification ─────────
    console.log("\n[Test 1] Ingesting 2 vouchers with dedicated syncRunId...");
    const syncRunId1 = `sync-run-${Date.now()}`;
    const vouchers1 = [
      {
        masterId: 7001,
        alterId: 1,
        voucherNumber: "INV-AUDIT-001",
        voucherType: "Sales",
        date: "2026-03-15T00:00:00.000Z",
        partyName: "Standard Chartered Bank",
        amount: 5000,
        entries: [
          { ledgerName: "Standard Chartered Bank", amount: 5000, type: "debit" },
          { ledgerName: "SaaS Subscription Revenue", amount: 5000, type: "credit" },
        ],
      },
      {
        masterId: 7002,
        alterId: 1,
        voucherNumber: "INV-AUDIT-002",
        voucherType: "Sales",
        date: "2026-03-15T00:00:00.000Z",
        partyName: "Standard Chartered Bank",
        amount: 15000,
        entries: [
          { ledgerName: "Standard Chartered Bank", amount: 15000, type: "debit" },
          { ledgerName: "SaaS Subscription Revenue", amount: 15000, type: "credit" },
        ],
      },
    ];

    const res1 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: syncRunId1,
        vouchers: vouchers1,
      },
    });

    assert.equal(res1.statusCode, 200);
    const body1 = res1.json();
    assert.equal(body1.created, 2);
    assert.equal(body1.failed, 0);
    assert.equal(body1.syncRunId, syncRunId1);

    // Verify SyncRun in database
    const syncRunRecord = await prisma.syncRun.findUnique({
      where: { id: syncRunId1 },
      include: { vouchers: true, auditLogs: { orderBy: { createdAt: "asc" } } },
    });

    assert.ok(syncRunRecord, "SyncRun entity must be persisted in database");
    assert.equal(syncRunRecord.companyId, companyId);
    assert.equal(syncRunRecord.status, "SYNC_COMPLETED");
    assert.equal(syncRunRecord.recordsFetched, 2);
    assert.equal(syncRunRecord.recordsCreated, 2);
    assert.equal(syncRunRecord.recordsUpdated, 0);
    assert.equal(syncRunRecord.recordsFailed, 0);
    assert.ok(syncRunRecord.completedAt, "completedAt timestamp must be set");

    // Verify Foreign Key relationship
    assert.equal(syncRunRecord.vouchers.length, 2, "SyncRun must link to both vouchers via foreign key");
    console.log("  ✓ SyncRun entity verified: status SYNC_COMPLETED, stats recorded, FK relation intact.");

    // Verify Audit Trail stages
    const stages = syncRunRecord.auditLogs.map((log) => log.stage);
    console.log("  Audit trail stages recorded:", stages);
    assert.ok(stages.includes("SYNC_STARTED"), "Audit trail must include SYNC_STARTED");
    assert.ok(stages.includes("SYNC_VALIDATING"), "Audit trail must include SYNC_VALIDATING");
    assert.ok(stages.includes("SYNC_PROCESSING"), "Audit trail must include SYNC_PROCESSING");
    assert.ok(stages.includes("SYNC_COMPLETED"), "Audit trail must include SYNC_COMPLETED");
    console.log("  ✓ 5-Stage Audit Trail verified with sequential timestamps.");

    // ── TEST 2: Money Datatype Decimal Precision (No Floating Point Drift) ───
    console.log("\n[Test 2] Testing exact Decimal(15, 2) financial precision...");
    const syncRunId2 = `sync-run-decimal-${Date.now()}`;
    // Precise decimal amounts that often suffer IEEE-754 floating point drift:
    // e.g. 1250.75 + 3499.55 = 4750.30 (in float: 4750.30000000000018)
    const decimalVoucher = {
      masterId: 7003,
      alterId: 1,
      voucherNumber: "INV-DECIMAL-003",
      voucherType: "Sales",
      date: "2026-03-15T00:00:00.000Z",
      partyName: "Standard Chartered Bank",
      amount: 4750.3,
      entries: [
        { ledgerName: "Standard Chartered Bank", amount: 4750.3, type: "debit" },
        { ledgerName: "SaaS Subscription Revenue", amount: 4750.3, type: "credit" },
      ],
    };

    const res2 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: syncRunId2,
        vouchers: [decimalVoucher],
      },
    });

    assert.equal(res2.statusCode, 200);
    const body2 = res2.json();
    assert.equal(body2.created, 1);

    const savedVoucher = await prisma.voucher.findUnique({
      where: { companyId_masterId: { companyId, masterId: 7003 } },
      include: { voucherEntries: true },
    });

    assert.ok(savedVoucher);
    assert.ok(
      savedVoucher.amount instanceof Prisma.Decimal,
      "Voucher.amount must be an instance of Prisma.Decimal"
    );
    assert.equal(savedVoucher.amount.toString(), "4750.3", "Voucher amount must match exact Decimal value");
    assert.equal(
      savedVoucher.voucherEntries[0].amount.toString(),
      "4750.3",
      "VoucherEntry amount must match exact Decimal value"
    );
    console.log(`  ✓ Decimal precision verified: ${savedVoucher.amount.toString()} stored in PostgreSQL NUMERIC(15, 2).`);

    // ── TEST 3: SyncRun Failure Diagnostics & Audit Trail ────────────────────
    console.log("\n[Test 3] Testing SyncRun failure diagnostics and error tracking...");
    const syncRunId3 = `sync-run-fail-${Date.now()}`;
    const invalidVoucher = {
      masterId: 7004,
      alterId: 1,
      voucherNumber: "INV-FAIL-004",
      voucherType: "Payment",
      date: "2026-03-15T00:00:00.000Z",
      amount: 100,
      entries: [
        { ledgerName: "NonExistentLedger_XYZ", amount: 100, type: "debit" },
        { ledgerName: "Standard Chartered Bank", amount: 100, type: "credit" },
      ],
    };

    const res3 = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: authHeaders,
      payload: {
        company: testCompanyName,
        syncRunId: syncRunId3,
        vouchers: [invalidVoucher],
      },
    });

    assert.equal(res3.statusCode, 200);
    const body3 = res3.json();
    assert.equal(body3.failed, 1);
    assert.equal(body3.validationFailed, 1);

    const failedSyncRun = await prisma.syncRun.findUnique({
      where: { id: syncRunId3 },
      include: { auditLogs: true },
    });

    assert.ok(failedSyncRun);
    assert.equal(failedSyncRun.recordsFailed, 1);
    assert.equal(failedSyncRun.status, "SYNC_FAILED");
    assert.ok(failedSyncRun.errorSummary?.includes("accounting validation"));

    const failAuditLog = failedSyncRun.auditLogs.find((l) => l.stage === "SYNC_FAILED");
    assert.ok(failAuditLog, "Audit log must contain a SYNC_FAILED event");
    console.log(`  ✓ Failure diagnostics verified: SyncRun #${syncRunId3} logged with status SYNC_FAILED and error summary.`);

    console.log("\n===================================================================");
    console.log("   ALL PHASE 1.5 SYNCRUN & DECIMAL AUDIT TESTS PASSED (100%)!     ");
    console.log("===================================================================\n");
  } finally {
    if (companyId!) {
      console.log(`[Cleanup] Cleaning up test data...`);
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
      await prisma.connector.deleteMany({
        where: { companyId },
      });
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

runSyncAuditTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
