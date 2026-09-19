import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildApp } from "../src/app.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runSecurityLogRedactionTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: ZERO-LEAKAGE LOG SECURITY & REDACTION TEST SUITE  ");
  console.log("===================================================================\n");

  const capturedLogChunks: string[] = [];
  const logStream = new Writable({
    write(chunk: any, _encoding: BufferEncoding, callback: () => void) {
      capturedLogChunks.push(chunk.toString());
      callback();
    },
  });

  // Build app with active logger directed to our logStream
  const app = await buildApp({
    logger: {
      level: "trace",
      stream: logStream,
    },
  });
  await app.ready();

  const timestamp = Date.now();
  const companyName = `Log Audit Co ${timestamp}`;
  let companyId: string;
  let userId: string;
  let userToken: string;
  let connectorId: string;
  let connectorToken: string;
  let generatedPairingCode: string;

  try {
    // ─── SETUP ───────────────────────────────────────────────────────────────
    console.log("[Setup] Creating Tenant Company and User...");
    const company = await prisma.company.create({
      data: { name: companyName, tallyCompanyName: companyName },
    });
    companyId = company.id;

    const sessionRes = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: {
        email: `audit-user-${timestamp}@logaudit.com`,
        name: "Audit User",
        companyId,
        role: "OWNER",
      },
    });
    assert.equal(sessionRes.statusCode, 200);
    const sessionData = sessionRes.json();
    userId = sessionData.user.id;
    userToken = sessionData.token;

    console.log("  ✔ Setup complete.\n");

    // ─── TEST 1: Pairing Code Generation Never Leaks in Logs ───────────────────
    console.log("[Test 1] Generating pairing code via POST /companies/:companyId/pairing-code...");
    const logIndexBeforeGen = capturedLogChunks.length;

    const pairGenRes = await app.inject({
      method: "POST",
      url: `/companies/${companyId}/pairing-code`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    assert.equal(pairGenRes.statusCode, 200, "Pairing code generation must succeed");
    const pairGenData = pairGenRes.json();
    assert.equal(pairGenData.success, true);
    assert.match(pairGenData.pairingCode, /^FL-[A-F0-9]{6}$/, "Pairing code must match FL-XXXXXX format");
    generatedPairingCode = pairGenData.pairingCode;

    const logsAfterGen = capturedLogChunks.slice(logIndexBeforeGen).join("\n");

    // Assert pairing code is NOT present in any logged lines
    assert.ok(
      !logsAfterGen.includes(generatedPairingCode),
      `CRITICAL LEAK: Generated pairing code "${generatedPairingCode}" was found in application logs!`
    );

    // Assert no FL-XXXXXX format string was logged
    const flCodeMatch = logsAfterGen.match(/FL-[A-F0-9]{6}/);
    assert.equal(
      flCodeMatch,
      null,
      `CRITICAL LEAK: Pattern /FL-[A-F0-9]{6}/ matched in logs: ${flCodeMatch?.[0]}`
    );

    // Assert safe metadata IS logged
    assert.ok(
      logsAfterGen.includes('"event":"pairing_code_generated"'),
      'Application logs must record safe metadata event: "pairing_code_generated"'
    );
    assert.ok(
      logsAfterGen.includes(`"companyId":"${companyId}"`),
      "Application logs must record safe metadata companyId"
    );

    console.log("  ✔ Test 1 Passed: Pairing code was NOT logged; safe metadata event recorded.\n");

    // ─── TEST 2: Connector Pairing Never Leaks Pairing Code in Logs ───────────
    console.log("[Test 2] Pairing connector with pairing code...");
    const regRes = await app.inject({
      method: "POST",
      url: "/connectors/register",
      payload: {
        deviceId: `dev-log-audit-${timestamp}`,
        deviceName: "Audit Connector",
        operatingSystem: "Windows 11",
      },
    });
    assert.equal(regRes.statusCode, 200);
    connectorId = regRes.json().connectorId;
    connectorToken = regRes.json().token;

    const logIndexBeforePair = capturedLogChunks.length;
    const pairRes = await app.inject({
      method: "POST",
      url: `/connectors/${connectorId}/pair`,
      headers: { authorization: `Bearer ${connectorToken}` },
      payload: {
        pairingCode: generatedPairingCode,
        tallyCompanyName: companyName,
      },
    });

    assert.equal(pairRes.statusCode, 200);
    const logsAfterPair = capturedLogChunks.slice(logIndexBeforePair).join("\n");

    assert.ok(
      !logsAfterPair.includes(generatedPairingCode),
      `CRITICAL LEAK: Pairing code "${generatedPairingCode}" was logged during connector pairing!`
    );
    assert.equal(
      logsAfterPair.match(/FL-[A-F0-9]{6}/),
      null,
      "CRITICAL LEAK: Pattern /FL-[A-F0-9]{6}/ matched during connector pairing!"
    );

    console.log("  ✔ Test 2 Passed: Connector pairing logs do not leak pairing codes.\n");

    // ─── TEST 3: Tokens and Sensitive Credentials Never Leak in Logs ───────────
    console.log("[Test 3] Verifying connector tokens and session tokens are never leaked in logs...");
    const allLogsCombined = capturedLogChunks.join("\n");

    // Connector token should never be in the logs
    assert.ok(
      !allLogsCombined.includes(connectorToken),
      "CRITICAL LEAK: Connector plaintext token was found in logs!"
    );

    // User session token should never be in the logs
    assert.ok(
      !allLogsCombined.includes(userToken),
      "CRITICAL LEAK: User session token was found in logs!"
    );

    console.log("  ✔ Test 3 Passed: Zero connector tokens or user session tokens found in logs.\n");

    console.log("===================================================================");
    console.log("   ALL LOG SECURITY & ZERO-LEAKAGE TESTS PASSED (100% SUCCESS)    ");
    console.log("===================================================================\n");
  } finally {
    console.log("[Cleanup] Cleaning up test records...");
    await app.close();
    try {
      if (connectorId!) {
        await prisma.syncJob.deleteMany({ where: { connectorId } });
        await prisma.connector.deleteMany({ where: { id: connectorId } });
      }
      if (userId!) {
        await prisma.userSession.deleteMany({ where: { userId } });
        await prisma.companyMember.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      if (companyId!) {
        await prisma.company.deleteMany({ where: { id: companyId } });
      }
    } catch (cleanErr) {
      console.warn("Cleanup warning:", cleanErr);
    }
    await prisma.$disconnect();
    await pool.end();
    console.log("[Cleanup] Done.");
  }
}

runSecurityLogRedactionTests().catch((err) => {
  console.error("LOG SECURITY TEST FAILED:", err);
  process.exit(1);
});
