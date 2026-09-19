import assert from "node:assert/strict";
import Fastify from "fastify";
import { connectorRoutes } from "../src/routes/connectors.js";
import { syncRoutes } from "../src/routes/sync.js";
import { jobRoutes } from "../src/routes/jobs.js";
import { dashboardRoutes } from "../src/routes/dashboard.js";
import { generateUserToken, hashUserToken } from "../src/auth/user-auth.js";
import { generateConnectorToken, hashConnectorToken } from "../src/auth/connector-auth.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runDashboardAuthSecurityTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: DASHBOARD AUTH & TENANT ISOLATION SECURITY SUITE   ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(connectorRoutes);
  await app.register(syncRoutes);
  await app.register(jobRoutes);
  await app.register(dashboardRoutes);
  await app.ready();

  const timestamp = Date.now();
  const companyAName = `Dashboard Tenant A ${timestamp}`;
  const companyBName = `Dashboard Tenant B ${timestamp}`;

  let companyAId: string;
  let companyBId: string;
  let connectorAId: string;
  let connectorBId: string;
  let tokenA: string;
  let tokenB: string;

  let userAId: string;
  let userTokenA: string;
  let userBId: string;
  let userTokenB: string;
  let expiredToken: string;

  try {
    // ── Setup: Create Two Distinct Companies ────────────────────────────────
    console.log(`[Setup] Creating Tenant A: "${companyAName}" and Tenant B: "${companyBName}"...`);
    const compA = await prisma.company.create({
      data: { name: companyAName, tallyCompanyName: companyAName },
    });
    companyAId = compA.id;

    const compB = await prisma.company.create({
      data: { name: companyBName, tallyCompanyName: companyBName },
    });
    companyBId = compB.id;

    // Seed test data for Company A
    await prisma.ledger.create({
      data: { companyId: companyAId, name: "Revenue A", parent: "Income", masterId: 101, alterId: 1 },
    });
    await prisma.voucher.create({
      data: {
        companyId: companyAId,
        masterId: 1001,
        alterId: 1,
        voucherNumber: "INV-A-1",
        voucherType: "Sales",
        date: new Date(),
        amount: 25000,
      },
    });
    await prisma.trialBalanceEntry.create({
      data: {
        companyId: companyAId,
        ledgerName: "Revenue A",
        groupName: "Income",
        debitAmount: 0,
        creditAmount: 25000,
      },
    });

    // Seed test data for Company B
    await prisma.ledger.create({
      data: { companyId: companyBId, name: "Secret Revenue B", parent: "Income", masterId: 201, alterId: 1 },
    });
    await prisma.voucher.create({
      data: {
        companyId: companyBId,
        masterId: 2001,
        alterId: 1,
        voucherNumber: "INV-B-SECRET",
        voucherType: "Sales",
        date: new Date(),
        amount: 99000,
      },
    });
    await prisma.trialBalanceEntry.create({
      data: {
        companyId: companyBId,
        ledgerName: "Secret Revenue B",
        groupName: "Income",
        debitAmount: 0,
        creditAmount: 99000,
      },
    });

    // Register Connectors for both companies
    tokenA = generateConnectorToken();
    const connA = await prisma.connector.create({
      data: {
        deviceId: `dev-dash-a-${timestamp}`,
        name: "Connector A",
        companyId: companyAId,
        tokenHash: hashConnectorToken(tokenA),
        status: "ONLINE",
      },
    });
    connectorAId = connA.id;

    tokenB = generateConnectorToken();
    const connB = await prisma.connector.create({
      data: {
        deviceId: `dev-dash-b-${timestamp}`,
        name: "Connector B",
        companyId: companyBId,
        tokenHash: hashConnectorToken(tokenB),
        status: "ONLINE",
      },
    });
    connectorBId = connB.id;

    // Create User A (Member of Company A ONLY)
    const userA = await prisma.user.create({
      data: { email: `user-a-${timestamp}@finlayer.io`, name: "User A" },
    });
    userAId = userA.id;
    await prisma.companyMember.create({
      data: { userId: userAId, companyId: companyAId, role: "OWNER" },
    });
    userTokenA = generateUserToken();
    await prisma.userSession.create({
      data: {
        userId: userAId,
        tokenHash: hashUserToken(userTokenA),
        expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour
      },
    });

    // Create User B (Member of Company B ONLY)
    const userB = await prisma.user.create({
      data: { email: `user-b-${timestamp}@finlayer.io`, name: "User B" },
    });
    userBId = userB.id;
    await prisma.companyMember.create({
      data: { userId: userBId, companyId: companyBId, role: "OWNER" },
    });
    userTokenB = generateUserToken();
    await prisma.userSession.create({
      data: {
        userId: userBId,
        tokenHash: hashUserToken(userTokenB),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    // Create an expired session for testing
    expiredToken = generateUserToken();
    await prisma.userSession.create({
      data: {
        userId: userAId,
        tokenHash: hashUserToken(expiredToken),
        expiresAt: new Date(Date.now() - 10000), // Expired in past
      },
    });

    console.log("  ✔ Setup Complete.\n");

    // ── TEST 1: Unauthenticated Requests Fail Closed (401 Unauthorized) ─────
    console.log("[Test 1] Verifying all financial endpoints reject unauthenticated access with 401...");

    const unauthEndpoints = [
      { method: "GET", url: "/dashboard/data" },
      { method: "GET", url: `/dashboard/data/ledgers?companyId=${companyAId}` },
      { method: "GET", url: `/dashboard/data/vouchers?companyId=${companyAId}` },
      { method: "GET", url: `/dashboard/data/trial-balance?companyId=${companyAId}` },
      { method: "GET", url: `/dashboard/financial-summary/${companyAId}` },
      { method: "GET", url: `/dashboard/sync-history/${companyAId}` },
      { method: "POST", url: "/dashboard/sync", payload: { companyId: companyAId, type: "LEDGERS" } },
      { method: "GET", url: "/connectors" },
    ] as const;

    for (const ep of unauthEndpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: (ep as any).payload,
      });

      assert.equal(
        res.statusCode,
        401,
        `Unauthenticated ${ep.method} ${ep.url} MUST return 401 Unauthorized! Got ${res.statusCode}`
      );
      const data = res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Unauthorized/i);
    }
    console.log("  ✔ Test 1 Passed: Zero fail-open. All 8 financial endpoints strictly reject unauthenticated requests with 401.");

    // ── TEST 2: Authenticated User in Company A (200 OK) ─────────────────────
    console.log("\n[Test 2] Verifying User A can access Company A's financial data...");

    const userHeaders = { authorization: `Bearer ${userTokenA}` };

    const dashDataRes = await app.inject({ method: "GET", url: "/dashboard/data", headers: userHeaders });
    assert.equal(dashDataRes.statusCode, 200);
    const dashData = dashDataRes.json();
    assert.equal(dashData.companies.length, 1);
    assert.equal(dashData.companies[0].id, companyAId);

    const ledgersRes = await app.inject({
      method: "GET",
      url: `/dashboard/data/ledgers?companyId=${companyAId}`,
      headers: userHeaders,
    });
    assert.equal(ledgersRes.statusCode, 200);
    assert.equal(ledgersRes.json().ledgers[0].name, "Revenue A");

    const vouchersRes = await app.inject({
      method: "GET",
      url: `/dashboard/data/vouchers?companyId=${companyAId}`,
      headers: userHeaders,
    });
    assert.equal(vouchersRes.statusCode, 200);
    assert.equal(vouchersRes.json().vouchers[0].voucherNumber, "INV-A-1");

    const tbRes = await app.inject({
      method: "GET",
      url: `/dashboard/data/trial-balance?companyId=${companyAId}`,
      headers: userHeaders,
    });
    assert.equal(tbRes.statusCode, 200);
    assert.equal(tbRes.json().trialBalance[0].ledgerName, "Revenue A");

    const summaryRes = await app.inject({
      method: "GET",
      url: `/dashboard/financial-summary/${companyAId}`,
      headers: userHeaders,
    });
    assert.equal(summaryRes.statusCode, 200);

    const historyRes = await app.inject({
      method: "GET",
      url: `/dashboard/sync-history/${companyAId}`,
      headers: userHeaders,
    });
    assert.equal(historyRes.statusCode, 200);

    console.log("  ✔ Test 2 Passed: User A successfully accessed all Company A financial endpoints (200 OK).");

    // ── TEST 3: Cross-Tenant IDOR Attack by User (403 Forbidden) ────────────
    console.log("\n[Test 3] Testing cross-tenant IDOR attacks: User A attempts to access Company B data...");

    const idorEndpoints = [
      `/dashboard/data/ledgers?companyId=${companyBId}`,
      `/dashboard/data/vouchers?companyId=${companyBId}`,
      `/dashboard/data/trial-balance?companyId=${companyBId}`,
      `/dashboard/financial-summary/${companyBId}`,
      `/dashboard/sync-history/${companyBId}`,
    ];

    for (const url of idorEndpoints) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: userHeaders, // User A querying Company B!
      });

      assert.equal(
        res.statusCode,
        403,
        `User A querying ${url} MUST return 403 Forbidden! Got ${res.statusCode}`
      );
      const data = res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Forbidden/i);
    }
    console.log("  ✔ Test 3 Passed: All cross-tenant queries by User A into Company B rejected with 403 Forbidden.");

    // ── TEST 4: Cross-Tenant Sync Injection by User (403 Forbidden) ─────────
    console.log("\n[Test 4] User A attempts to trigger sync for Company B (POST /dashboard/sync)...");

    const crossSyncRes = await app.inject({
      method: "POST",
      url: "/dashboard/sync",
      headers: userHeaders,
      payload: {
        companyId: companyBId,
        type: "LEDGERS",
      },
    });

    assert.equal(crossSyncRes.statusCode, 403, "Cross-tenant sync trigger MUST return 403 Forbidden!");
    const crossSyncData = crossSyncRes.json();
    assert.equal(crossSyncData.success, false);
    assert.match(crossSyncData.error, /Forbidden/i);

    // Verify no job was created for Connector B
    const bJobs = await prisma.syncJob.findMany({ where: { connectorId: connectorBId } });
    assert.equal(bJobs.length, 0, "No sync job must be injected into Company B!");
    console.log("  ✔ Test 4 Passed: Cross-tenant sync injection blocked with 403 Forbidden. Company B untouched.");

    // ── TEST 5: Scoped Listing Prevents Tenant Leaks ─────────────────────────
    console.log("\n[Test 5] Verifying /dashboard/data and /connectors do NOT leak other companies...");

    const dataLeakCheck = await app.inject({
      method: "GET",
      url: "/dashboard/data",
      headers: userHeaders,
    });
    const leakData = dataLeakCheck.json();
    const returnedCompanyIds = leakData.companies.map((c: any) => c.id);
    assert.ok(returnedCompanyIds.includes(companyAId), "Must include Company A");
    assert.ok(!returnedCompanyIds.includes(companyBId), "Must NEVER include Company B!");

    const connectorLeakCheck = await app.inject({
      method: "GET",
      url: "/connectors",
      headers: userHeaders,
    });
    assert.equal(connectorLeakCheck.statusCode, 200);
    const connList = connectorLeakCheck.json().connectors;
    const returnedConnCompanyIds = connList.map((c: any) => c.companyId);
    assert.ok(returnedConnCompanyIds.includes(companyAId));
    assert.ok(!returnedConnCompanyIds.includes(companyBId), "Must NEVER leak Company B connectors!");
    console.log("  ✔ Test 5 Passed: Scoped listings strictly isolate tenant companies and hardware connectors.");

    // ── TEST 6: Connector Authentication Backward Compatibility ─────────────
    console.log("\n[Test 6] Verifying Connector Token backward compatibility...");

    // Connector A accessing its own company's vouchers -> 200 OK
    const connAuthRes = await app.inject({
      method: "GET",
      url: `/dashboard/data/vouchers?companyId=${companyAId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(connAuthRes.statusCode, 200, "Connector A querying Company A vouchers must succeed");
    assert.equal(connAuthRes.json().vouchers.length, 1);

    // Connector A attempting to access Company B vouchers -> 403 Forbidden
    const connCrossRes = await app.inject({
      method: "GET",
      url: `/dashboard/data/vouchers?companyId=${companyBId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(connCrossRes.statusCode, 403, "Connector A querying Company B vouchers must be 403 Forbidden");
    console.log("  ✔ Test 6 Passed: Connector authentication supported and strictly bound to its own tenant company.");

    // ── TEST 7: Expired or Revoked User Session Handling ─────────────────────
    console.log("\n[Test 7] Verifying expired or invalid user tokens return 401 Unauthorized...");

    const expiredRes = await app.inject({
      method: "GET",
      url: "/dashboard/data",
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredRes.statusCode, 401, "Expired token MUST return 401");
    assert.equal(expiredRes.json().success, false);

    const invalidRes = await app.inject({
      method: "GET",
      url: "/dashboard/data",
      headers: { authorization: "Bearer fl_usr_invalid_garbage_token_12345" },
    });
    assert.equal(invalidRes.statusCode, 401, "Invalid token MUST return 401");
    assert.equal(invalidRes.json().success, false);
    console.log("  ✔ Test 7 Passed: Expired and invalid user sessions correctly rejected with 401.");

    console.log("\n===================================================================");
    console.log("   ALL 7 DASHBOARD SECURITY & TENANT TESTS PASSED WITH 100%!       ");
    console.log("===================================================================\n");
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log("[Cleanup] Removing test records...");
    await prisma.userSession.deleteMany({
      where: { userId: { in: [userAId!, userBId!].filter(Boolean) } },
    });
    await prisma.companyMember.deleteMany({
      where: { userId: { in: [userAId!, userBId!].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAId!, userBId!].filter(Boolean) } },
    });

    await prisma.syncJob.deleteMany({
      where: { connectorId: { in: [connectorAId!, connectorBId!].filter(Boolean) } },
    });
    if (connectorAId!) await prisma.connector.deleteMany({ where: { id: connectorAId } });
    if (connectorBId!) await prisma.connector.deleteMany({ where: { id: connectorBId } });

    for (const cId of [companyAId!, companyBId!].filter(Boolean)) {
      await prisma.trialBalanceEntry.deleteMany({ where: { companyId: cId } });
      await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId: cId } } });
      await prisma.voucher.deleteMany({ where: { companyId: cId } });
      await prisma.ledger.deleteMany({ where: { companyId: cId } });
      await prisma.syncHistory.deleteMany({ where: { companyId: cId } });
      await prisma.syncLog.deleteMany({ where: { companyId: cId } });
      await prisma.company.deleteMany({ where: { id: cId } });
    }

    await prisma.$disconnect();
    await pool.end();
    await app.close();
  }
}

runDashboardAuthSecurityTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
