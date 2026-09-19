import assert from "node:assert/strict";
import Fastify from "fastify";
import { connectorRoutes } from "../src/routes/connectors.js";
import { hashConnectorToken } from "../src/auth/connector-auth.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runSecurityConnectorAuthTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: CONNECTOR AUTHENTICATION & SECURITY TEST SUITE    ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(connectorRoutes);
  await app.ready();

  const timestamp = Date.now();
  const testCompanyName = `Test Auth Co ${timestamp}`;
  let companyId: string;
  let connectorAId: string;
  let tokenA: string;
  let connectorBId: string;
  let tokenB: string;

  try {
    // ── Setup: Create Company ────────────────────────────────────────────────
    console.log(`[Setup] Creating test company: "${testCompanyName}"...`);
    const company = await prisma.company.create({
      data: {
        name: testCompanyName,
        tallyCompanyName: testCompanyName,
      },
    });
    companyId = company.id;

    // ── Setup: Register Connector A ──────────────────────────────────────────
    console.log("[Setup] Registering Connector A via POST /connectors/register...");
    const regResA = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `test-dev-conn-a-${timestamp}`,
        deviceName: "FinLayer Test Connector A",
        operatingSystem: "Windows 11 Pro",
        company: testCompanyName,
      },
    });

    assert.equal(regResA.statusCode, 200, "Registration for Connector A must return 200 OK");
    const regDataA = regResA.json();
    assert.equal(regDataA.success, true);
    assert.ok(regDataA.connectorId, "Response must include connectorId");
    assert.ok(regDataA.token, "Response must include plaintext token on registration");
    assert.match(regDataA.token, /^fl_conn_[a-f0-9]{64}$/, "Token must match fl_conn_<64-char-hex>");

    connectorAId = regDataA.connectorId;
    tokenA = regDataA.token;
    console.log(`[Setup] Connector A registered. ID: ${connectorAId}`);

    // ── CASE 1: Valid Token Accepted ─────────────────────────────────────────
    console.log("\n[Case 1] Verifying valid token is accepted (GET /connectors/verify-token)...");
    const validRes = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });

    assert.equal(validRes.statusCode, 200, "Valid token must return 200 OK");
    const validData = validRes.json();
    assert.equal(validData.success, true);
    assert.equal(validData.connector.id, connectorAId, "Attached connector must match registered ID");
    assert.equal(validData.connector.companyId, companyId);
    console.log("  ✔ Case 1 Passed: Request accepted with valid Bearer token.");

    // ── CASE 2: Wrong Token Rejected with 401 ────────────────────────────────
    console.log("\n[Case 2] Verifying wrong token returns 401 Unauthorized...");
    const wrongToken = "fl_conn_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const wrongRes = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: {
        authorization: `Bearer ${wrongToken}`,
      },
    });

    assert.equal(wrongRes.statusCode, 401, "Wrong token must return 401 Unauthorized");
    const wrongData = wrongRes.json();
    assert.equal(wrongData.success, false);
    assert.match(wrongData.error, /Invalid connector token/i);
    console.log("  ✔ Case 2 Passed: Wrong token rejected with 401.");

    // ── CASE 3: Missing or Malformed Token Rejected with 401 ──────────────────
    console.log("\n[Case 3] Verifying missing token returns 401 Unauthorized...");
    const missingRes = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
    });

    assert.equal(missingRes.statusCode, 401, "Missing Authorization header must return 401");
    const missingData = missingRes.json();
    assert.equal(missingData.success, false);
    assert.match(missingData.error, /Missing Authorization header/i);

    console.log("[Case 3b] Verifying malformed Authorization header format returns 401...");
    const malformedRes = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: {
        authorization: "Basic dXNlcjpwYXNz",
      },
    });
    assert.equal(malformedRes.statusCode, 401, "Non-Bearer header must return 401");

    console.log("  ✔ Case 3 Passed: Missing/malformed token rejected with 401.");

    // ── CASE 4: Token Cannot Be Retrieved from Database in Plaintext ─────────
    console.log("\n[Case 4] Verifying token cannot be retrieved from DB in plaintext (Only hash exists)...");
    const dbConnector = await prisma.connector.findUnique({
      where: { id: connectorAId },
    });

    assert.ok(dbConnector, "Connector record must exist in DB");
    assert.ok(dbConnector.tokenHash, "tokenHash must exist in DB");
    assert.equal(
      dbConnector.tokenHash,
      hashConnectorToken(tokenA),
      "DB tokenHash must equal SHA256(token)"
    );

    // Verify plaintext token does not match tokenHash
    assert.notEqual(dbConnector.tokenHash, tokenA, "DB must not store plaintext token in tokenHash");

    // Scan all string fields in the connector record to ensure plaintext token is never persisted
    const serializedRecord = JSON.stringify(dbConnector);
    assert.equal(
      serializedRecord.includes(tokenA),
      false,
      "Plaintext token must NEVER appear anywhere in the database record!"
    );
    console.log("  ✔ Case 4 Passed: Only SHA-256 hash exists in DB. Plaintext token is never stored.");

    // ── CASE 5: Token Lifecycle Fields (tokenCreatedAt, tokenLastUsedAt) ──────
    console.log("\n[Case 5] Verifying token lifecycle timestamps (tokenCreatedAt, tokenLastUsedAt)...");
    assert.ok(dbConnector.tokenCreatedAt, "tokenCreatedAt must be set on registration");
    assert.ok(dbConnector.tokenLastUsedAt, "tokenLastUsedAt must be updated on authenticated request");
    assert.equal(dbConnector.tokenRevokedAt, null, "tokenRevokedAt must be null for active token");
    console.log(
      `  ✔ Case 5 Passed: tokenCreatedAt=${dbConnector.tokenCreatedAt.toISOString()}, tokenLastUsedAt=${dbConnector.tokenLastUsedAt.toISOString()}`
    );

    // ── CASE 6: Token Rotation Invalidation ──────────────────────────────────
    console.log("\n[Case 6] Testing Token Rotation (POST /connectors/:id/rotate-token)...");
    const rotateRes = await app.inject({
      method: "POST",
      url: `/connectors/${connectorAId}/rotate-token`,
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });

    assert.equal(rotateRes.statusCode, 200, "Token rotation must return 200 OK");
    const rotateData = rotateRes.json();
    assert.equal(rotateData.success, true);
    assert.ok(rotateData.token, "Rotation response must contain new token");
    assert.notEqual(rotateData.token, tokenA, "New token must differ from old token");
    const newRotatedToken = rotateData.token;

    // Old token must now be immediately rejected (401)
    console.log("[Case 6a] Verifying old token is immediately invalidated...");
    const oldTokenRes = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: {
        authorization: `Bearer ${tokenA}`,
      },
    });
    assert.equal(oldTokenRes.statusCode, 401, "Old token must return 401 after rotation");

    // New token must authenticate successfully
    console.log("[Case 6b] Verifying new rotated token authenticates successfully...");
    const newTokenRes = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: {
        authorization: `Bearer ${newRotatedToken}`,
      },
    });
    assert.equal(newTokenRes.statusCode, 200, "New token must return 200 OK");
    console.log("  ✔ Case 6 Passed: Token rotation successful. Old token invalidated, new token accepted.");

    // Update tokenA to current valid token
    tokenA = newRotatedToken;

    // ── CASE 7: Connector A Cannot Access Connector B Resources ──────────────
    console.log("\n[Case 7] Registering Connector B to test resource isolation...");
    const regResB = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `test-dev-conn-b-${timestamp}`,
        deviceName: "FinLayer Test Connector B",
        operatingSystem: "Windows 11 Pro",
        company: testCompanyName,
      },
    });
    assert.equal(regResB.statusCode, 200);
    const regDataB = regResB.json();
    connectorBId = regDataB.connectorId;
    tokenB = regDataB.token;

    console.log("[Case 7a] Connector A attempts to send heartbeat for Connector B...");
    const crossAccessRes = await app.inject({
      method: "POST",
      url: `/connectors/${connectorBId}/heartbeat`,
      headers: {
        authorization: `Bearer ${tokenA}`, // Token A targeting Connector B's ID!
      },
      payload: { version: "1.0.0" },
    });

    assert.equal(
      crossAccessRes.statusCode,
      403,
      "Connector A attempting to access Connector B resource must return 403 Forbidden"
    );
    const crossAccessData = crossAccessRes.json();
    assert.equal(crossAccessData.success, false);
    assert.match(crossAccessData.error, /Forbidden.*cannot access or modify resources belonging to another connector/i);
    console.log("  ✔ Case 7a Passed: Cross-connector access rejected with 403 Forbidden.");

    console.log("[Case 7b] Connector B sends heartbeat for Connector B (authorized)...");
    const validHbRes = await app.inject({
      method: "POST",
      url: `/connectors/${connectorBId}/heartbeat`,
      headers: {
        authorization: `Bearer ${tokenB}`, // Token B targeting Connector B's ID
      },
      payload: { version: "1.0.0" },
    });
    assert.equal(validHbRes.statusCode, 200, "Connector B accessing its own resource must return 200 OK");
    console.log("  ✔ Case 7b Passed: Connector B accessing its own resource accepted with 200 OK.");

    // ── CASE 8: Revoked Token Rejected with 401 ──────────────────────────────
    console.log("\n[Case 8] Testing Token Revocation (POST /connectors/:id/revoke-token)...");
    const revokeRes = await app.inject({
      method: "POST",
      url: `/connectors/${connectorBId}/revoke-token`,
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });
    assert.equal(revokeRes.statusCode, 200, "Token revocation must return 200 OK");

    const afterRevokeRes = await app.inject({
      method: "GET",
      url: "/connectors/verify-token",
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });
    assert.equal(afterRevokeRes.statusCode, 401, "Revoked token must return 401");
    const afterRevokeData = afterRevokeRes.json();
    assert.match(afterRevokeData.error, /revoked/i);
    console.log("  ✔ Case 8 Passed: Revoked token rejected with 401.");

    console.log("\n===================================================================");
    console.log("   ALL 8 CONNECTOR SECURITY & AUTHENTICATION TESTS PASSED 100%     ");
    console.log("===================================================================\n");
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log("[Cleanup] Removing test connectors and company...");
    if (connectorAId!) {
      await prisma.connector.deleteMany({ where: { id: connectorAId } });
    }
    if (connectorBId!) {
      await prisma.connector.deleteMany({ where: { id: connectorBId } });
    }
    if (companyId!) {
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    await prisma.$disconnect();
    await pool.end();
    await app.close();
  }
}

runSecurityConnectorAuthTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
