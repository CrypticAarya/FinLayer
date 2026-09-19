import assert from "node:assert/strict";
import Fastify from "fastify";
import { syncRoutes } from "../src/routes/sync.js";
import { connectorRoutes } from "../src/routes/connectors.js";
import { jobRoutes } from "../src/routes/jobs.js";
import { dashboardRoutes } from "../src/routes/dashboard.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runTenantIsolationTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: TENANT ISOLATION & IDOR SECURITY TEST SUITE       ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(connectorRoutes);
  await app.register(syncRoutes);
  await app.register(jobRoutes);
  await app.register(dashboardRoutes);
  await app.ready();

  const timestamp = Date.now();
  const companyAName = `Tenant A Co ${timestamp}`;
  const companyBName = `Tenant B Co ${timestamp}`;

  let companyAId: string;
  let companyBId: string;
  let connectorAId: string;
  let tokenA: string;
  let connectorBId: string;
  let tokenB: string;
  let connectorCId: string;
  let tokenC: string;

  try {
    // ── Setup: Create Two Distinct Companies ────────────────────────────────
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

    // Seed ledgers for both companies
    await prisma.ledger.create({
      data: {
        companyId: companyAId,
        name: "Sales Account A",
        parent: "Sales Accounts",
        masterId: 101,
        alterId: 1,
      },
    });
    await prisma.ledger.create({
      data: {
        companyId: companyAId,
        name: "HDFC Bank A",
        parent: "Bank Accounts",
        masterId: 102,
        alterId: 1,
      },
    });

    await prisma.ledger.create({
      data: {
        companyId: companyBId,
        name: "Sales Account B",
        parent: "Sales Accounts",
        masterId: 201,
        alterId: 1,
      },
    });
    await prisma.ledger.create({
      data: {
        companyId: companyBId,
        name: "ICICI Bank B",
        parent: "Bank Accounts",
        masterId: 202,
        alterId: 1,
      },
    });

    // ── Setup: Register Connector A (Bound to Company A) ────────────────────
    console.log("[Setup] Registering Connector A for Tenant A...");
    const regA = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `dev-conn-a-${timestamp}`,
        deviceName: "Connector A",
        company: companyAName,
      },
    });
    assert.equal(regA.statusCode, 200);
    const dataA = regA.json();
    connectorAId = dataA.connectorId;
    tokenA = dataA.token;

    // ── Setup: Register Connector B (Bound to Company B) ────────────────────
    console.log("[Setup] Registering Connector B for Tenant B...");
    const regB = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `dev-conn-b-${timestamp}`,
        deviceName: "Connector B",
        company: companyBName,
      },
    });
    assert.equal(regB.statusCode, 200);
    const dataB = regB.json();
    connectorBId = dataB.connectorId;
    tokenB = dataB.token;

    // ── Setup: Register Connector C (Unlinked, No Company) ──────────────────
    console.log("[Setup] Registering Connector C (Unlinked, no company)...");
    const regC = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `dev-conn-c-unlinked-${timestamp}`,
        deviceName: "Connector C Unlinked",
      },
    });
    assert.equal(regC.statusCode, 200);
    const dataC = regC.json();
    connectorCId = dataC.connectorId;
    tokenC = dataC.token;

    // ── CASE 1: Company A Connector Accesses Company A Data ─────────────────
    console.log("\n[Case 1] Connector A syncs vouchers into Company A (Authorized)...");
    const syncResA = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
      payload: {
        company: companyAName,
        syncRunId: `sync-run-a-${timestamp}`,
        vouchers: [
          {
            masterId: 1001,
            alterId: 1,
            voucherNumber: "INV-A-001",
            voucherType: "Sales",
            date: new Date().toISOString(),
            partyName: "Customer A",
            amount: 5000,
            entries: [
              { ledgerName: "HDFC Bank A", amount: 5000, type: "debit" },
              { ledgerName: "Sales Account A", amount: 5000, type: "credit" },
            ],
          },
        ],
      },
    });

    assert.equal(syncResA.statusCode, 200, "Connector A must be allowed to sync into Company A");
    const syncDataA = syncResA.json();
    assert.equal(syncDataA.success, true);
    assert.equal(syncDataA.created, 1);

    // Verify voucher belongs strictly to Company A in database
    const vA = await prisma.voucher.findUnique({
      where: {
        companyId_masterId: {
          companyId: companyAId,
          masterId: 1001,
        },
      },
    });
    assert.ok(vA, "Voucher must be created under Company A");
    assert.equal(vA.companyId, companyAId);
    console.log("  ✔ Case 1 Passed: Company A connector successfully ingested data into Company A (200 OK).");

    // ── CASE 2: Company A Connector Attempts Cross-Tenant Read on Company B ─
    console.log("\n[Case 2] Connector A attempts to read Company B financial summary...");
    const crossReadRes = await app.inject({
      method: "GET",
      url: `/dashboard/financial-summary/${companyBId}`,
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });

    assert.equal(
      crossReadRes.statusCode,
      403,
      "Connector A reading Company B financial summary must return 403 Forbidden"
    );
    const crossReadData = crossReadRes.json();
    assert.equal(crossReadData.success, false);
    assert.match(crossReadData.error, /Forbidden/i);
    console.log("  ✔ Case 2 Passed: Cross-tenant read rejected with 403 Forbidden.");

    // ── CASE 3: Company A Connector Attempts Cross-Tenant Write into Company B
    console.log("\n[Case 3] Connector A attempts to sync vouchers into Company B (IDOR Write)...");
    const crossSyncRes = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: {
        authorization: `Bearer ${tokenA}`, // Token A targeting Company B!
      },
      payload: {
        company: companyBName, // Spoofed Company B name in body
        syncRunId: `malicious-sync-b-${timestamp}`,
        vouchers: [
          {
            masterId: 2001,
            alterId: 1,
            voucherNumber: "HACK-B-001",
            voucherType: "Sales",
            date: new Date().toISOString(),
            amount: 999999,
            entries: [
              { ledgerName: "ICICI Bank B", amount: 999999, type: "debit" },
              { ledgerName: "Sales Account B", amount: 999999, type: "credit" },
            ],
          },
        ],
      },
    });

    assert.equal(
      crossSyncRes.statusCode,
      403,
      "Connector A attempting to sync into Company B must be rejected with 403 Forbidden"
    );
    const crossSyncData = crossSyncRes.json();
    assert.equal(crossSyncData.success, false);
    assert.match(crossSyncData.error, /Forbidden.*cannot access, read, or sync data belonging to another company/i);

    // Verify ZERO vouchers were created in Company B
    const maliciousVoucher = await prisma.voucher.findUnique({
      where: {
        companyId_masterId: {
          companyId: companyBId,
          masterId: 2001,
        },
      },
    });
    assert.equal(maliciousVoucher, null, "Database must NOT have created voucher in Company B!");
    console.log("  ✔ Case 3 Passed: Cross-tenant sync rejected with 403 Forbidden. Company B data untouched.");

    // ── CASE 4: Unlinked Connector Cannot Sync Data ─────────────────────────
    console.log("\n[Case 4] Unlinked Connector C (no companyId) attempts to sync...");
    const unlinkedRes = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: {
        authorization: `Bearer ${tokenC}`,
      },
      payload: {
        company: companyAName,
        vouchers: [],
      },
    });

    assert.equal(
      unlinkedRes.statusCode,
      403,
      "Unlinked connector must return 403 Forbidden on sync attempt"
    );
    const unlinkedData = unlinkedRes.json();
    assert.equal(unlinkedData.success, false);
    assert.match(unlinkedData.error, /Connector is not linked to any company/i);
    console.log("  ✔ Case 4 Passed: Unlinked connector rejected with 403 Forbidden.");

    // ── CASE 5: Connector A Cannot Access Connector B Pending Jobs ───────────
    console.log("\n[Case 5] Connector A attempts to read Connector B sync jobs...");
    const jobRes = await app.inject({
      method: "GET",
      url: `/sync/jobs/${connectorBId}/pending`,
      headers: {
        authorization: `Bearer ${tokenA}`, // Token A querying Connector B's pending jobs
      },
    });

    assert.equal(
      jobRes.statusCode,
      403,
      "Connector A querying Connector B pending jobs must return 403 Forbidden"
    );
    const jobData = jobRes.json();
    assert.equal(jobData.success, false);
    assert.match(jobData.error, /Forbidden.*cannot access or modify resources belonging to another connector/i);
    console.log("  ✔ Case 5 Passed: Cross-connector job inspection rejected with 403 Forbidden.");

    // ── CASE 6: Connector A Cannot Complete Connector B Sync Jobs ───────────
    console.log("\n[Case 6] Connector A attempts to complete a sync job belonging to Connector B...");
    const testJobB = await prisma.syncJob.create({
      data: {
        connectorId: connectorBId,
        type: "VOUCHERS",
        status: "PENDING",
      },
    });

    const completeJobRes = await app.inject({
      method: "POST",
      url: `/sync/jobs/${testJobB.id}/complete`,
      headers: {
        authorization: `Bearer ${tokenA}`, // Token A attempting to complete Job belonging to Connector B
      },
    });

    assert.equal(
      completeJobRes.statusCode,
      403,
      "Connector A completing Connector B sync job must return 403 Forbidden"
    );
    const completeJobData = completeJobRes.json();
    assert.equal(completeJobData.success, false);
    assert.match(completeJobData.error, /Forbidden.*cannot complete a sync job belonging to another connector/i);

    // Verify job is still PENDING in DB
    const unchangedJob = await prisma.syncJob.findUnique({ where: { id: testJobB.id } });
    assert.equal(unchangedJob?.status, "PENDING", "Job status must remain PENDING");
    console.log("  ✔ Case 6 Passed: Cross-connector job tampering rejected with 403 Forbidden.");

    // ── CASE 7: Connector A Cannot Query Company B Vouchers in Dashboard ────
    console.log("\n[Case 7] Connector A attempts to query Company B vouchers via dashboard API...");
    const dashboardVoucherRes = await app.inject({
      method: "GET",
      url: `/dashboard/data/vouchers?companyId=${companyBId}`,
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });

    assert.equal(
      dashboardVoucherRes.statusCode,
      403,
      "Connector A querying Company B vouchers must return 403 Forbidden"
    );
    console.log("  ✔ Case 7 Passed: Cross-tenant dashboard data access rejected with 403 Forbidden.");

    console.log("\n===================================================================");
    console.log("   ALL 7 TENANT ISOLATION & IDOR TESTS PASSED WITH 100% SUCCESS!   ");
    console.log("===================================================================\n");
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log("[Cleanup] Removing test records...");
    await prisma.syncJob.deleteMany({
      where: {
        connectorId: { in: [connectorAId!, connectorBId!, connectorCId!].filter(Boolean) },
      },
    });
    if (connectorAId!) await prisma.connector.deleteMany({ where: { id: connectorAId } });
    if (connectorBId!) await prisma.connector.deleteMany({ where: { id: connectorBId } });
    if (connectorCId!) await prisma.connector.deleteMany({ where: { id: connectorCId } });

    for (const cId of [companyAId!, companyBId!].filter(Boolean)) {
      await prisma.syncAuditLog.deleteMany({ where: { syncRun: { companyId: cId } } });
      await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId: cId } } });
      await prisma.voucher.deleteMany({ where: { companyId: cId } });
      await prisma.syncRun.deleteMany({ where: { companyId: cId } });
      await prisma.syncLog.deleteMany({ where: { companyId: cId } });
      await prisma.ledger.deleteMany({ where: { companyId: cId } });
      await prisma.company.deleteMany({ where: { id: cId } });
    }
    await prisma.$disconnect();
    await pool.end();
    await app.close();
  }
}

runTenantIsolationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
