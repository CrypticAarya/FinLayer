import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { connectorRoutes } from "../src/routes/connectors.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runRegistrationSecurityTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: CONNECTOR REGISTRATION SECURITY TEST SUITE        ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(connectorRoutes);
  await app.ready();

  const timestamp = Date.now();
  const testCompanyAName = `Test Co Reg A ${timestamp}`;
  const testCompanyBName = `Test Co Reg B ${timestamp}`;
  let companyAId: string;
  let companyBId: string;
  const createdConnectorIds: string[] = [];

  try {
    // ── Setup: Create Test Companies ───────────────────────────────────────
    console.log(`[Setup] Creating test companies: "${testCompanyAName}" & "${testCompanyBName}"...`);
    const companyA = await prisma.company.create({
      data: { name: testCompanyAName, tallyCompanyName: testCompanyAName },
    });
    companyAId = companyA.id;

    const companyB = await prisma.company.create({
      data: { name: testCompanyBName, tallyCompanyName: testCompanyBName },
    });
    companyBId = companyB.id;

    // ── TEST 1: New Connector Registration ─────────────────────────────────
    console.log("\n[Test 1] Registering a new connector (POST /connectors/register)...");
    const deviceId1 = `win-reg-test-1-${timestamp}`;
    const res1 = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: deviceId1,
        deviceName: "Primary-Accounting-PC",
        operatingSystem: "Windows 11 Pro",
        company: testCompanyAName,
      },
    });

    assert.equal(res1.statusCode, 200, `Expected 200 OK, got ${res1.statusCode}`);
    const body1 = res1.json();
    assert.equal(body1.success, true);
    assert.ok(body1.connectorId, "connectorId must be returned");
    assert.ok(typeof body1.token === "string" && body1.token.startsWith("fl_conn_"), "Valid token must be returned");
    assert.equal(body1.token.length, 72, "Token should be fl_conn_ + 64 hex chars");
    createdConnectorIds.push(body1.connectorId);

    // Verify database record
    const dbConnector1 = await prisma.connector.findUnique({
      where: { id: body1.connectorId },
    });
    assert.ok(dbConnector1, "Connector must exist in database");
    assert.equal(dbConnector1.deviceId, deviceId1);
    assert.equal(dbConnector1.companyId, companyAId);
    assert.equal(dbConnector1.status, "ONLINE");
    assert.ok(dbConnector1.tokenHash, "tokenHash must be populated in DB");
    assert.notEqual(dbConnector1.tokenHash, body1.token, "Plaintext token must NEVER be stored in DB");
    assert.equal(dbConnector1.tokenHash, crypto.createHash("sha256").update(body1.token).digest("hex"));
    console.log("  ✔ Test 1 Passed: Connector created, token returned once, tokenHash stored, plaintext token not in DB.");

    // ── TEST 2: Existing deviceId Registration Rejection ───────────────────
    console.log("\n[Test 2] Re-registering existing deviceId (must reject with 409 Conflict)...");
    const res2 = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: deviceId1,
        deviceName: "Impersonator-PC",
      },
    });

    assert.equal(res2.statusCode, 409, `Expected 409 Conflict, got ${res2.statusCode}`);
    const body2 = res2.json();
    assert.equal(body2.success, false);
    assert.equal(body2.error, "Device already registered. Recovery required.");

    // Verify tokenHash, companyId, and status are strictly unchanged
    const dbPostAttempt2 = await prisma.connector.findUnique({
      where: { id: body1.connectorId },
    });
    assert.equal(dbPostAttempt2?.tokenHash, dbConnector1.tokenHash, "tokenHash must be strictly unchanged");
    assert.equal(dbPostAttempt2?.companyId, dbConnector1.companyId, "companyId must be strictly unchanged");
    assert.equal(dbPostAttempt2?.status, "ONLINE", "status must remain ONLINE");
    console.log("  ✔ Test 2 Passed: Existing deviceId rejected with 409. tokenHash, companyId, status unchanged.");

    // ── TEST 3: Attempt Company Hijacking ───────────────────────────────────
    console.log("\n[Test 3] Attempting company hijacking (same deviceId + Company B)...");
    const res3 = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: deviceId1,
        deviceName: "Hijacker",
        company: testCompanyBName,
      },
    });

    assert.equal(res3.statusCode, 409, `Expected 409 Conflict, got ${res3.statusCode}`);
    const dbPostAttempt3 = await prisma.connector.findUnique({
      where: { id: body1.connectorId },
    });
    assert.equal(dbPostAttempt3?.companyId, companyAId, "Connector must still belong to Company A");
    assert.equal(dbPostAttempt3?.tallyCompanyName, testCompanyAName, "tallyCompanyName must still belong to Company A");
    console.log("  ✔ Test 3 Passed: Company hijacking blocked with 409. Connector still belongs to Company A.");

    // ── TEST 4: Revoked Connector Recovery Attempt ──────────────────────────
    console.log("\n[Test 4] Revoked connector recovery attempt via registration (must fail)...");
    // 1. Revoke the connector
    await app.inject({
      method: "POST",
      url: `/connectors/${body1.connectorId}/revoke-token`,
      headers: { authorization: `Bearer ${body1.token}` },
    });

    const dbRevoked = await prisma.connector.findUnique({
      where: { id: body1.connectorId },
    });
    assert.equal(dbRevoked?.status, "REVOKED");
    assert.ok(dbRevoked?.tokenRevokedAt !== null, "tokenRevokedAt must be set");

    // 2. Attacker attempts to register using the revoked deviceId
    const res4 = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: deviceId1,
        deviceName: "Zombie-Revival",
      },
    });

    assert.equal(res4.statusCode, 409, `Expected 409 Conflict, got ${res4.statusCode}`);
    const dbPostZombie = await prisma.connector.findUnique({
      where: { id: body1.connectorId },
    });
    assert.equal(dbPostZombie?.status, "REVOKED", "Status must remain permanently REVOKED");
    assert.equal(
      dbPostZombie?.tokenRevokedAt?.getTime(),
      dbRevoked?.tokenRevokedAt?.getTime(),
      "tokenRevokedAt must remain unchanged"
    );
    assert.equal(dbPostZombie?.tokenHash, dbRevoked?.tokenHash, "tokenHash must remain unchanged");
    console.log("  ✔ Test 4 Passed: Revoked connector cannot revive via registration. Status remains REVOKED.");

    // ── TEST 5: Concurrent Registration Race ────────────────────────────────
    console.log("\n[Test 5] Testing concurrent registration race condition...");
    const raceDeviceId = `win-race-test-${timestamp}`;

    const [raceRes1, raceRes2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/connectors/register",
        payload: { deviceId: raceDeviceId, deviceName: "Race-Worker-1" },
      }),
      app.inject({
        method: "POST",
        url: "/connectors/register",
        payload: { deviceId: raceDeviceId, deviceName: "Race-Worker-2" },
      }),
    ]);

    const statusCodes = [raceRes1.statusCode, raceRes2.statusCode].sort();
    assert.deepEqual(
      statusCodes,
      [200, 409],
      `Expected exactly one 200 and one 409, got [${raceRes1.statusCode}, ${raceRes2.statusCode}]`
    );

    const winnerBody = raceRes1.statusCode === 200 ? raceRes1.json() : raceRes2.json();
    createdConnectorIds.push(winnerBody.connectorId);

    const totalCount = await prisma.connector.count({
      where: { deviceId: raceDeviceId },
    });
    assert.equal(totalCount, 1, "Database must contain exactly 1 connector record for the deviceId");
    console.log("  ✔ Test 5 Passed: Concurrent registration race handled cleanly (1 winner 200 OK, 1 conflict 409).");

    // ── TEST 6: Token Leakage Prevention ────────────────────────────────────
    console.log("\n[Test 6] Verifying API response does NOT expose tokenHash or internal security fields...");
    // Check 200 OK response
    assert.equal(winnerBody.tokenHash, undefined, "Response must NOT expose tokenHash");
    assert.equal(winnerBody.tokenCreatedAt, undefined, "Response must NOT expose tokenCreatedAt");
    assert.equal(winnerBody.tokenRevokedAt, undefined, "Response must NOT expose tokenRevokedAt");
    assert.equal(winnerBody.tokenLastUsedAt, undefined, "Response must NOT expose tokenLastUsedAt");

    // Check 409 Conflict response
    assert.equal(body2.token, undefined, "409 response must NOT expose token");
    assert.equal(body2.tokenHash, undefined, "409 response must NOT expose tokenHash");
    assert.equal(body2.connectorId, undefined, "409 response must NOT expose internal connectorId");
    assert.equal(body2.tokenCreatedAt, undefined, "409 response must NOT expose tokenCreatedAt");
    assert.equal(body2.tokenRevokedAt, undefined, "409 response must NOT expose tokenRevokedAt");

    console.log("  ✔ Test 6 Passed: Responses strictly scrubbed. Zero leakage of tokenHash or internal security fields.");

    console.log("\n===================================================================");
    console.log("   ALL 6 REQUIRED SECURITY TESTS PASSED WITH 100% SUCCESS!         ");
    console.log("===================================================================\n");
  } finally {
    console.log(`[Cleanup] Removing test connectors and companies...`);
    if (createdConnectorIds.length > 0) {
      await prisma.connector.deleteMany({
        where: { id: { in: createdConnectorIds } },
      });
    }
    if (companyAId!) {
      await prisma.company.deleteMany({
        where: { id: { in: [companyAId, companyBId!] } },
      });
    }
    await app.close();
    await prisma.$disconnect();
    await pool.end();
    console.log(`[Cleanup] Done.`);
  }
}

runRegistrationSecurityTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
