import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";
import { PairingStoreManager, MemoryPairingStore } from "../src/services/pairing-store.js";
import { generateSaasApiKey } from "../src/auth/saas-auth.js";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runPairingAndBlockersSecurityTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: PAIRING, TOKEN & SYNC SECURITY TEST SUITE         ");
  console.log("===================================================================\n");

  const timestamp = Date.now();
  const companyAName = `Blocker Co A ${timestamp}`;
  const companyBName = `Blocker Co B ${timestamp}`;

  // Custom rate-limit for test to verify 429 without waiting 100 requests
  const app = await buildApp({
    logger: false,
    rateLimitOptions: {
      max: 1000,
      timeWindow: "1 minute",
    },
  });
  await app.ready();

  let companyAId: string;
  let companyBId: string;
  let saasKeyA: string;
  let saasKeyB: string;
  let connectorAId: string;
  let tokenA: string;
  let connectorBId: string;
  let tokenB: string;
  let unlinkedConnectorId: string;
  let unlinkedToken: string;

  try {
    // ─── SETUP: Companies, Users, and Connectors ──────────────────────────────
    console.log("[Setup] Creating Tenant Companies & Users...");
    const companyA = await prisma.company.create({
      data: { name: companyAName, tallyCompanyName: companyAName },
    });
    companyAId = companyA.id;

    const companyB = await prisma.company.create({
      data: { name: companyBName, tallyCompanyName: companyBName },
    });
    companyBId = companyB.id;

    // Issue SaaS API key for Tenant A
    const keyDataA = await generateSaasApiKey({
      companyId: companyAId,
      name: "SaaS App Tenant A",
    });
    saasKeyA = keyDataA.apiKey;

    // Issue SaaS API key for Tenant B
    const keyDataB = await generateSaasApiKey({
      companyId: companyBId,
      name: "SaaS App Tenant B",
    });
    saasKeyB = keyDataB.apiKey;

    // Register Connector A (Initially bound to Company A for sync tests)
    const regA = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `dev-blocker-a-${timestamp}`,
        deviceName: "Connector A",
        company: companyAName,
      },
    });
    assert.equal(regA.statusCode, 200);
    connectorAId = regA.json().connectorId;
    tokenA = regA.json().token;

    // Register Connector B (Bound to Company B)
    const regB = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `dev-blocker-b-${timestamp}`,
        deviceName: "Connector B",
        company: companyBName,
      },
    });
    assert.equal(regB.statusCode, 200);
    connectorBId = regB.json().connectorId;
    tokenB = regB.json().token;

    // Register Unlinked Connector (No Company)
    const regUnlinked = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `dev-unlinked-${timestamp}`,
        deviceName: "Unlinked Connector",
      },
    });
    assert.equal(regUnlinked.statusCode, 200);
    unlinkedConnectorId = regUnlinked.json().connectorId;
    unlinkedToken = regUnlinked.json().token;
    console.log("  ✔ Setup complete.\n");

    // ─── PRIORITY 1: PAIRING ARCHITECTURE & AUTO-BINDING REMOVAL ──────────────
    console.log("[Test 1.1] Company auto-binding without pairing code MUST BE REJECTED (403 Forbidden)...");
    const autoBindRes = await app.inject({
      method: "POST",
      url: `/connectors/${unlinkedConnectorId}/company`,
      headers: { authorization: `Bearer ${unlinkedToken}` },
      payload: {
        companyName: companyAName, // Existing company!
      },
    });
    assert.equal(autoBindRes.statusCode, 403, "Must reject auto-binding to existing company with 403");
    assert.match(autoBindRes.json().error, /pairing code required/i);

    // Verify connector remains unlinked in DB
    const checkUnlinked = await prisma.connector.findUnique({ where: { id: unlinkedConnectorId } });
    assert.equal(checkUnlinked?.companyId, null, "Connector companyId must remain null");
    console.log("  ✔ Test 1.1 Passed: Rogue connector blocked from auto-binding to existing company.");

    console.log("[Test 1.2] Generating pairing code requires valid tenant authorization...");
    // 1.2a: Unauthenticated attempt
    const noAuthPairRes = await app.inject({
      method: "POST",
      url: `/companies/${companyAId}/pairing-code`,
    });
    assert.equal(noAuthPairRes.statusCode, 401, "Unauthenticated pairing code generation must return 401");

    // 1.2b: Cross-tenant attempt (SaaS Tenant B trying to generate code for Company A)
    const crossTenantPairRes = await app.inject({
      method: "POST",
      url: `/companies/${companyAId}/pairing-code`,
      headers: { "x-api-key": saasKeyB },
    });
    assert.equal(crossTenantPairRes.statusCode, 403, "Cross-tenant pairing code generation must return 403");

    // 1.2c: Authorized SaaS Tenant A generates pairing code for Company A
    const authPairRes = await app.inject({
      method: "POST",
      url: `/companies/${companyAId}/pairing-code`,
      headers: { "x-api-key": saasKeyA },
    });
    assert.equal(authPairRes.statusCode, 200);
    const pairingData = authPairRes.json();
    assert.equal(pairingData.success, true);
    assert.match(pairingData.pairingCode, /^FL-[A-F0-9]{6}$/, "Pairing code must follow FL-XXXXXX format");
    const validPairingCode = pairingData.pairingCode;
    console.log(`  ✔ Test 1.2 Passed: SaaS Key A successfully generated pairing code (FL-XXXXXX).`);

    console.log("[Test 1.3] Connector pairing with valid pairing code succeeds...");
    const pairRes = await app.inject({
      method: "POST",
      url: `/connectors/${unlinkedConnectorId}/pair`,
      headers: { authorization: `Bearer ${unlinkedToken}` },
      payload: {
        pairingCode: validPairingCode,
        tallyCompanyName: companyAName,
      },
    });
    assert.equal(pairRes.statusCode, 200);
    assert.equal(pairRes.json().success, true);
    assert.equal(pairRes.json().companyId, companyAId);

    // Verify DB linkage
    const pairedConnector = await prisma.connector.findUnique({ where: { id: unlinkedConnectorId } });
    assert.equal(pairedConnector?.companyId, companyAId, "Connector must now be linked to Company A");
    console.log("  ✔ Test 1.3 Passed: Connector successfully bound to Company A via pairing code.");

    console.log("[Test 1.4] Re-using consumed pairing code (Replay Attack) must fail with 400...");
    const replayPairRes = await app.inject({
      method: "POST",
      url: `/connectors/${unlinkedConnectorId}/pair`,
      headers: { authorization: `Bearer ${unlinkedToken}` },
      payload: {
        pairingCode: validPairingCode, // Already consumed!
      },
    });
    assert.equal(replayPairRes.statusCode, 400, "Consumed pairing code must be rejected with 400");
    console.log("  ✔ Test 1.4 Passed: Single-use anti-replay protection verified.");

    console.log("[Test 1.5] Pairing with non-existent or malformed code fails with 400...");
    const invalidPairRes = await app.inject({
      method: "POST",
      url: `/connectors/${unlinkedConnectorId}/pair`,
      headers: { authorization: `Bearer ${unlinkedToken}` },
      payload: {
        pairingCode: "FL-NONEXIST",
      },
    });
    assert.equal(invalidPairRes.statusCode, 400);
    console.log("  ✔ Test 1.5 Passed: Invalid pairing code rejected.\n");

    // ─── PRIORITY 2 & TOKEN SECURITY: TOKEN LIFECYCLE & HASH STORAGE ───────────
    console.log("[Test 2.1] Plaintext tokens are NEVER stored in DB (SHA-256 only)...");
    const dbConnA = await prisma.connector.findUnique({ where: { id: connectorAId } });
    assert.ok(dbConnA?.tokenHash, "tokenHash must exist in DB");
    assert.notEqual(dbConnA?.tokenHash, tokenA, "tokenHash must NOT equal raw plaintext token");
    assert.equal(dbConnA?.tokenHash.length, 64, "tokenHash must be a 64-character SHA-256 hex string");
    console.log("  ✔ Test 2.1 Passed: Plaintext token is never persisted in the database.");

    console.log("[Test 2.2] Revoked connector token is immediately rejected with 401...");
    await app.inject({
      method: "POST",
      url: `/connectors/${connectorAId}/revoke-token`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const verifyRevoked = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(verifyRevoked.statusCode, 401, "Revoked token must return 401");
    console.log("  ✔ Test 2.2 Passed: Revoked connector token cannot authenticate.");

    // Rotate token so Connector A can be used for sync authorization test
    const rotateRes = await app.inject({
      method: "POST",
      url: `/connectors/${connectorAId}/rotate-token`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    // Old token was revoked, rotate with admin/connector: since old token is revoked, rotate requires valid token
    // Re-activate Connector A for remaining tests
    const newRawToken = "fl_conn_replacement_" + timestamp;
    const crypto = await import("node:crypto");
    const newHash = crypto.createHash("sha256").update(newRawToken).digest("hex");
    await prisma.connector.update({
      where: { id: connectorAId },
      data: { tokenHash: newHash, status: "ONLINE", tokenRevokedAt: null },
    });
    tokenA = newRawToken;
    console.log("  ✔ Re-authenticated Connector A with fresh token.\n");

    // ─── PRIORITY 5: SYNC AUTHORIZATION & ENDPOINT HARDENING ───────────────────
    console.log("\n[Test 4.1] Unauthenticated POST /sync/start fails with 401 Unauthorized...");
    const unauthSyncStart = await app.inject({
      method: "POST",
      url: "/sync/start",
      payload: {
        connectorId: connectorAId,
        type: "FINANCIAL_DATA",
      },
    });
    assert.equal(unauthSyncStart.statusCode, 401, "POST /sync/start must reject unauthenticated requests with 401");
    console.log("  ✔ Test 4.1 Passed: Unauthenticated /sync/start rejected.");

    console.log("[Test 4.2] Connector cross-triggering sync job is rejected with 403 Forbidden...");
    // Connector B attempts to start sync job for Connector A
    const crossConnSyncStart = await app.inject({
      method: "POST",
      url: "/sync/start",
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        connectorId: connectorAId,
        type: "FINANCIAL_DATA",
      },
    });
    assert.equal(crossConnSyncStart.statusCode, 403, "Cross-connector sync triggering must return 403");
    console.log("  ✔ Test 4.2 Passed: Connector B blocked from triggering sync for Connector A.");

    console.log("[Test 4.3] Invalid token sync triggering is rejected with 401 Unauthorized...");
    const badTokenSyncStart = await app.inject({
      method: "POST",
      url: "/sync/start",
      headers: { authorization: "Bearer ct_invalid_token" },
      payload: {
        connectorId: connectorAId,
        type: "FINANCIAL_DATA",
      },
    });
    assert.equal(badTokenSyncStart.statusCode, 401, "Invalid token sync start must return 401");
    console.log("  ✔ Test 4.3 Passed: Invalid token rejected with 401.");

    console.log("[Test 4.4] Authorized Connector A triggers sync job successfully (200 OK)...");
    const authSyncStart = await app.inject({
      method: "POST",
      url: "/sync/start",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        connectorId: connectorAId,
        type: "FINANCIAL_DATA",
      },
    });
    assert.equal(authSyncStart.statusCode, 200);
    assert.equal(authSyncStart.json().success, true);
    assert.ok(authSyncStart.json().jobId);
    console.log("  ✔ Test 4.4 Passed: Authorized sync job queued successfully.\n");

    // ─── PRIORITY 4: RATE LIMITING ─────────────────────────────────────────────
    console.log("[Test 5.1] API Rate Limiting protection (HTTP 429 Too Many Requests)...");
    const rateLimitApp = await buildApp({
      logger: false,
      rateLimitOptions: {
        max: 5,
        timeWindow: "1 minute",
      },
    });
    await rateLimitApp.ready();

    let rateLimited = false;
    for (let i = 0; i < 10; i++) {
      const pingRes = await rateLimitApp.inject({
        method: "GET",
        url: "/connectors/verify-token",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      if (pingRes.statusCode === 429) {
        rateLimited = true;
        assert.equal(pingRes.json().statusCode, 429);
        assert.match(pingRes.json().message, /rate limit exceeded/i);
        break;
      }
    }
    assert.equal(rateLimited, true, "Rate limit must trigger HTTP 429 when threshold exceeded");
    console.log("  ✔ Test 5.1 Passed: Rate limiting triggers HTTP 429 Too Many Requests.");

    console.log("\n===================================================================");
    console.log("   ALL 12 PAIRING, TOKEN, SYNC & RATE-LIMIT TESTS PASSED 100%!   ");
    console.log("===================================================================");
  } finally {
    // ─── Cleanup ──────────────────────────────────────────────────────────────
    console.log("\n[Cleanup] Cleaning up test data...");
    await prisma.syncJob.deleteMany({
      where: { connectorId: { in: [connectorAId, connectorBId, unlinkedConnectorId].filter(Boolean) } },
    });
    await prisma.syncHistory.deleteMany({
      where: { companyId: { in: [companyAId, companyBId].filter(Boolean) } },
    });
    await prisma.connector.deleteMany({
      where: { id: { in: [connectorAId, connectorBId, unlinkedConnectorId].filter(Boolean) } },
    });
    await prisma.apiKey.deleteMany({
      where: { companyId: { in: [companyAId, companyBId].filter(Boolean) } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [companyAId, companyBId].filter(Boolean) } },
    });
    await prisma.$disconnect();
    await pool.end();
    console.log("[Cleanup] Done.");
  }
}

runPairingAndBlockersSecurityTests().catch((err) => {
  console.error("\n❌ Security test failed:", err);
  process.exit(1);
});
