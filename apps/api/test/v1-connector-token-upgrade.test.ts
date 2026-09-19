import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { connectorRoutes } from "../src/routes/connectors.js";
import { exportRoutes } from "../src/routes/export.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runV1TokenUpgradeTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: V1 UPGRADE TOKEN & EXPORT AUTH ADVERSARIAL QA    ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(connectorRoutes);
  await app.register(exportRoutes);
  await app.ready();

  const timestamp = Date.now();
  let companyA: any;
  let companyB: any;
  let legacyConnectorA: any;
  let revokedConnector: any;
  let provisionedToken: string;

  try {
    // ── Setup ───────────────────────────────────────────────────────────────────
    console.log("[Setup] Creating test companies and legacy V1 connectors...");
    companyA = await prisma.company.create({
      data: {
        name: `Test Upgrade Co A ${timestamp}`,
        tallyCompanyName: `Test Upgrade Co A ${timestamp}`,
      },
    });

    companyB = await prisma.company.create({
      data: {
        name: `Test Upgrade Co B ${timestamp}`,
        tallyCompanyName: `Test Upgrade Co B ${timestamp}`,
      },
    });

    // Create a legacy V1 connector (tokenHash is NULL)
    legacyConnectorA = await prisma.connector.create({
      data: {
        deviceId: `dev-legacy-${timestamp}`,
        name: "Legacy Windows Connector",
        companyId: companyA.id,
        tokenHash: null,
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });

    // Create a revoked legacy connector
    revokedConnector = await prisma.connector.create({
      data: {
        deviceId: `dev-revoked-${timestamp}`,
        name: "Revoked Connector",
        companyId: companyA.id,
        tokenHash: null,
        status: "REVOKED",
        tokenRevokedAt: new Date(),
        setupStatus: "ACTIVE",
      },
    });
    console.log("  ✔ Setup completed.\n");

    // ── Test 1: Anti-Impersonation (Mismatched deviceId) ───────────────────────
    console.log("[Test 1] Testing anti-impersonation: mismatched deviceId must reject with 403...");
    const res1 = await app.inject({
      method: "POST",
      url: `/connectors/${legacyConnectorA.id}/upgrade-v1-token`,
      payload: {
        deviceId: "impersonator-device-id",
      },
    });
    assert.equal(res1.statusCode, 403, `Expected 403, got ${res1.statusCode}`);
    const body1 = JSON.parse(res1.payload);
    assert.equal(body1.success, false);
    assert.match(body1.error, /Device ID mismatch/i);
    console.log("  ✔ Test 1 Passed: Mismatched deviceId rejected with 403.\n");

    // ── Test 2: Non-existent connector ─────────────────────────────────────────
    console.log("[Test 2] Testing non-existent connector must return 404...");
    const res2 = await app.inject({
      method: "POST",
      url: `/connectors/non-existent-id/upgrade-v1-token`,
      payload: {
        deviceId: legacyConnectorA.deviceId,
      },
    });
    assert.equal(res2.statusCode, 404, `Expected 404, got ${res2.statusCode}`);
    console.log("  ✔ Test 2 Passed: Non-existent connector rejected with 404.\n");

    // ── Test 3: Revoked connector cannot upgrade ───────────────────────────────
    console.log("[Test 3] Testing revoked connector cannot upgrade (must reject with 403)...");
    const res3 = await app.inject({
      method: "POST",
      url: `/connectors/${revokedConnector.id}/upgrade-v1-token`,
      payload: {
        deviceId: revokedConnector.deviceId,
      },
    });
    assert.equal(res3.statusCode, 403, `Expected 403, got ${res3.statusCode}`);
    const body3 = JSON.parse(res3.payload);
    assert.match(body3.error, /Revoked/i);
    console.log("  ✔ Test 3 Passed: Revoked connector rejected with 403.\n");

    // ── Test 4: Successful upgrade of legitimate legacy V1 connector ────────────
    console.log("[Test 4] Upgrading legitimate legacy V1 connector (tokenHash is NULL)...");
    const res4 = await app.inject({
      method: "POST",
      url: `/connectors/${legacyConnectorA.id}/upgrade-v1-token`,
      payload: {
        deviceId: legacyConnectorA.deviceId,
      },
    });
    assert.equal(res4.statusCode, 200, `Expected 200, got ${res4.statusCode}: ${res4.payload}`);
    const body4 = JSON.parse(res4.payload);
    assert.equal(body4.success, true);
    assert.equal(body4.connectorId, legacyConnectorA.id);
    assert.ok(typeof body4.token === "string" && body4.token.length > 20);
    provisionedToken = body4.token;

    // Verify tokenHash was set in DB
    const dbConnector = await prisma.connector.findUnique({
      where: { id: legacyConnectorA.id },
    });
    assert.ok(dbConnector?.tokenHash !== null, "tokenHash must not be null");
    assert.ok(dbConnector?.tokenCreatedAt !== null, "tokenCreatedAt must be set");
    console.log("  ✔ Test 4 Passed: Connector upgraded with secure token. DB record updated.\n");

    // ── Test 5: Single-Use Invariant (Subsequent upgrade must fail with 409) ────
    console.log("[Test 5] Testing single-use invariant: subsequent upgrade must return 409 Conflict...");
    const res5 = await app.inject({
      method: "POST",
      url: `/connectors/${legacyConnectorA.id}/upgrade-v1-token`,
      payload: {
        deviceId: legacyConnectorA.deviceId,
      },
    });
    assert.equal(res5.statusCode, 409, `Expected 409, got ${res5.statusCode}`);
    const body5 = JSON.parse(res5.payload);
    assert.equal(body5.success, false);
    assert.match(body5.error, /already been provisioned/i);
    console.log("  ✔ Test 5 Passed: Subsequent upgrade rejected with 409 Conflict (token not overwritten).\n");

    // ── Test 6: Upgraded token authenticates via Bearer header ──────────────────
    console.log("[Test 6] Verifying upgraded token authenticates connector endpoints...");
    const res6 = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: {
        authorization: `Bearer ${provisionedToken}`,
      },
    });
    assert.equal(res6.statusCode, 200);
    const body6 = JSON.parse(res6.payload);
    assert.equal(body6.success, true);
    assert.equal(body6.connector.id, legacyConnectorA.id);
    console.log("  ✔ Test 6 Passed: Upgraded token authenticates successfully.\n");

    // ── Test 7: Export download via Authorization: Bearer header for own company ──
    console.log("[Test 7] Verifying export download via Authorization: Bearer header for own company...");
    const res7 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyA.id}?type=vouchers&format=csv`,
      headers: {
        authorization: `Bearer ${provisionedToken}`,
      },
    });
    assert.equal(res7.statusCode, 200, `Expected 200, got ${res7.statusCode}`);
    assert.equal(res7.headers["content-type"], "text/csv; charset=utf-8");
    assert.match(res7.headers["content-disposition"] as string, /attachment; filename=/);
    console.log("  ✔ Test 7 Passed: CSV export stream downloaded successfully via Bearer token header.\n");

    // ── Test 8: Cross-tenant download attempt via Bearer token must fail with 403 ───
    console.log("[Test 8] Verifying cross-tenant export download attempt via Bearer token is blocked (403)...");
    const res8 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyB.id}?type=vouchers&format=csv`,
      headers: {
        authorization: `Bearer ${provisionedToken}`,
      },
    });
    assert.equal(res8.statusCode, 403, `Expected 403, got ${res8.statusCode}`);
    console.log("  ✔ Test 8 Passed: Cross-tenant export blocked with 403 Forbidden.\n");

    // ── Test 9: URL query param token (?token=...) MUST BE REJECTED with 401 (Zero URL Token Leakage) ──
    console.log("[Test 9] Verifying query param token (?token=) is rejected with 401 (Zero URL token leakage)...");
    const res9 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyA.id}?type=vouchers&format=csv&token=${encodeURIComponent(provisionedToken)}`,
    });
    assert.equal(res9.statusCode, 401, `Expected 401, got ${res9.statusCode}`);
    console.log("  ✔ Test 9 Passed: URL query parameter token strictly rejected with 401 Unauthorized.\n");

    console.log("===================================================================");
    console.log("   ALL 9 V1 UPGRADE & EXPORT AUTH TESTS PASSED 100% SUCCESS!       ");
    console.log("===================================================================\n");
  } finally {
    console.log("[Cleanup] Cleaning up test records...");
    if (legacyConnectorA?.id || revokedConnector?.id) {
      await prisma.connector.deleteMany({
        where: {
          id: { in: [legacyConnectorA?.id, revokedConnector?.id].filter(Boolean) },
        },
      }).catch(() => {});
    }
    if (companyA?.id || companyB?.id) {
      await prisma.company.deleteMany({
        where: {
          id: { in: [companyA?.id, companyB?.id].filter(Boolean) },
        },
      }).catch(() => {});
    }
    await app.close();
    await prisma.$disconnect();
    await pool.end();
    console.log("[Cleanup] Complete.");
  }
}

runV1TokenUpgradeTests().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
