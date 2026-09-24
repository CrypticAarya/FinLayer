import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import prisma from "../src/db/prisma.js";
import { generateSaasApiKey, revokeSaasApiKey } from "../src/auth/saas-auth.js";
import { generateConnectorToken, hashConnectorToken } from "../src/auth/connector-auth.js";

async function runSaasTriggeredSyncTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: SAAS TRIGGERED SYNC & CONNECTOR JOB TEST SUITE    ");
  console.log("===================================================================\n");

  const app = await buildApp({ logger: false });
  await app.ready();

  const timestamp = Date.now();
  const companyAName = `SaaS Sync Tenant A ${timestamp}`;
  const companyBName = `SaaS Sync Tenant B ${timestamp}`;

  let companyAId = "";
  let companyBId = "";
  let connectorAId = "";
  let connectorBId = "";
  let rawTokenA = "";
  let rawTokenB = "";
  let rawKeyA = "";
  let rawKeyB = "";
  let revokedKey = "";
  let createdJobId = "";

  try {
    // ── Setup: Companies, Connectors & API Keys ──────────────────────────────
    console.log("[Setup] Creating Tenant Companies A and B...");
    const compA = await prisma.company.create({
      data: { name: companyAName, tallyCompanyName: companyAName },
    });
    companyAId = compA.id;

    const compB = await prisma.company.create({
      data: { name: companyBName, tallyCompanyName: companyBName },
    });
    companyBId = compB.id;

    console.log("[Setup] Registering Connectors for Company A and B...");
    rawTokenA = generateConnectorToken();
    const connA = await prisma.connector.create({
      data: {
        name: "Connector Machine A",
        deviceId: `device-a-${timestamp}`,
        companyId: companyAId,
        status: "ONLINE",
        setupStatus: "ACTIVE",
        tokenHash: hashConnectorToken(rawTokenA),
        tokenCreatedAt: new Date(),
        lastHeartbeat: new Date(),
      },
    });
    connectorAId = connA.id;

    rawTokenB = generateConnectorToken();
    const connB = await prisma.connector.create({
      data: {
        name: "Connector Machine B",
        deviceId: `device-b-${timestamp}`,
        companyId: companyBId,
        status: "ONLINE",
        setupStatus: "ACTIVE",
        tokenHash: hashConnectorToken(rawTokenB),
        tokenCreatedAt: new Date(),
        lastHeartbeat: new Date(),
      },
    });
    connectorBId = connB.id;

    console.log("[Setup] Issuing SaaS API Keys...");
    const keyDataA = await generateSaasApiKey({
      companyId: companyAId,
      name: "SaaS Tenant A Key",
    });
    rawKeyA = keyDataA.apiKey;

    const keyDataB = await generateSaasApiKey({
      companyId: companyBId,
      name: "SaaS Tenant B Key",
    });
    rawKeyB = keyDataB.apiKey;

    const revokedKeyData = await generateSaasApiKey({
      companyId: companyAId,
      name: "Revoked Key",
    });
    revokedKey = revokedKeyData.apiKey;
    await revokeSaasApiKey(revokedKeyData.keyRecord.id);

    console.log("  ✔ Setup completed.\n");

    // ── SECTION 1: UNAUTHORIZED SYNC REQUESTS ─────────────────────────────────
    console.log("--- SECTION 1: Unauthorized Sync Requests ---");

    console.log("\n[Test 1.1] POST /sync without API key -> 401 Unauthorized...");
    const resNoAuth = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyAId}/sync`,
    });
    assert.equal(resNoAuth.statusCode, 401);
    assert.equal(resNoAuth.json().success, false);
    console.log("  ✔ Test 1.1 Passed: Missing API key strictly rejected (401).");

    console.log("\n[Test 1.2] POST /sync with invalid/forged API key -> 401 Unauthorized...");
    const resBadKey = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyAId}/sync`,
      headers: { "x-api-key": "fl_live_invalid_forged_key_12345" },
    });
    assert.equal(resBadKey.statusCode, 401);
    assert.equal(resBadKey.json().success, false);
    console.log("  ✔ Test 1.2 Passed: Forged API key strictly rejected (401).");

    console.log("\n[Test 1.3] POST /sync with revoked API key -> 401 Unauthorized...");
    const resRevokedKey = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyAId}/sync`,
      headers: { "x-api-key": revokedKey },
    });
    assert.equal(resRevokedKey.statusCode, 401);
    assert.equal(resRevokedKey.json().success, false);
    console.log("  ✔ Test 1.3 Passed: Revoked API key strictly rejected (401).");

    // ── SECTION 2: CROSS-TENANT SYNC ISOLATION ────────────────────────────────
    console.log("\n--- SECTION 2: Cross-Tenant Sync Isolation ---");

    console.log("\n[Test 2.1] SaaS A triggering sync for Company B -> 403 Forbidden...");
    const resCrossTenant = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyBId}/sync`,
      headers: { "x-api-key": rawKeyA },
    });
    assert.equal(resCrossTenant.statusCode, 403);
    assert.equal(resCrossTenant.json().success, false);
    assert.ok(resCrossTenant.json().error.includes("Forbidden"));

    // Verify zero jobs created for Company B
    const bJobCount = await prisma.syncJob.count({
      where: { connectorId: connectorBId },
    });
    assert.equal(bJobCount, 0, "No sync job should have been created for Company B");
    console.log("  ✔ Test 2.1 Passed: Cross-tenant sync attempt blocked (403) with 0 side-effects.");

    // ── SECTION 3: SAAS TRIGGER SYNC SUCCESS ──────────────────────────────────
    console.log("\n--- SECTION 3: SaaS Trigger Sync Success ---");

    console.log("\n[Test 3.1] SaaS A triggering sync for Company A -> 200 OK & QUEUED...");
    const resTrigger = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyAId}/sync`,
      headers: { "x-api-key": rawKeyA },
      payload: { type: "FINANCIAL_DATA" },
    });
    assert.equal(resTrigger.statusCode, 200);
    const triggerData = resTrigger.json();
    assert.equal(triggerData.success, true);
    assert.ok(triggerData.syncJobId, "Must return syncJobId");
    assert.equal(triggerData.status, "QUEUED");
    createdJobId = triggerData.syncJobId;

    // Verify SyncJob persisted in DB
    const dbJob = await prisma.syncJob.findUnique({
      where: { id: createdJobId },
    });
    assert.ok(dbJob, "SyncJob record must exist in PostgreSQL");
    assert.equal(dbJob.connectorId, connectorAId);
    assert.equal(dbJob.status, "PENDING");
    assert.equal(dbJob.type, "FINANCIAL_DATA");
    console.log(`  ✔ Test 3.1 Passed: Sync job ${createdJobId} queued with status: ${triggerData.status}.`);

    // ── SECTION 4: CONNECTOR JOB FLOW & COMPLETION ─────────────────────────────
    console.log("\n--- SECTION 4: Connector Job Flow & Completion ---");

    console.log("\n[Test 4.1] Connector B attempting to poll Connector A's pending job -> 403 Forbidden...");
    const resConnBPoll = await app.inject({
      method: "GET",
      url: `/sync/jobs/${connectorAId}/pending`,
      headers: { authorization: `Bearer ${rawTokenB}` },
    });
    assert.equal(resConnBPoll.statusCode, 403);
    console.log("  ✔ Test 4.1 Passed: Cross-connector job polling blocked (403).");

    console.log("\n[Test 4.2] Connector A polling pending jobs -> receives queued job...");
    const resConnAPoll = await app.inject({
      method: "GET",
      url: `/sync/jobs/${connectorAId}/pending`,
      headers: { authorization: `Bearer ${rawTokenA}` },
    });
    assert.equal(resConnAPoll.statusCode, 200);
    const pollData = resConnAPoll.json();
    assert.equal(pollData.success, true);
    assert.ok(pollData.job, "Job must not be null");
    assert.equal(pollData.job.id, createdJobId);
    assert.equal(pollData.job.status, "PENDING");
    assert.equal(pollData.job.type, "FINANCIAL_DATA");
    console.log(`  ✔ Test 4.2 Passed: Connector A fetched pending job: ${pollData.job.id}.`);

    console.log("\n[Test 4.3] Connector B attempting to complete Connector A's job -> 403 Forbidden...");
    const resConnBComplete = await app.inject({
      method: "POST",
      url: `/sync/jobs/${createdJobId}/complete`,
      headers: { authorization: `Bearer ${rawTokenB}` },
      payload: {},
    });
    assert.equal(resConnBComplete.statusCode, 403);
    console.log("  ✔ Test 4.3 Passed: Cross-connector job completion blocked (403).");

    console.log("\n[Test 4.4] Connector A completing its assigned job -> 200 OK & COMPLETED...");
    const resConnAComplete = await app.inject({
      method: "POST",
      url: `/sync/jobs/${createdJobId}/complete`,
      headers: { authorization: `Bearer ${rawTokenA}` },
      payload: {},
    });
    assert.equal(resConnAComplete.statusCode, 200);
    const completeData = resConnAComplete.json();
    assert.equal(completeData.success, true);
    assert.equal(completeData.jobId, createdJobId);
    assert.equal(completeData.status, "COMPLETED");

    // Verify DB state updated
    const completedJob = await prisma.syncJob.findUnique({
      where: { id: createdJobId },
    });
    assert.ok(completedJob);
    assert.equal(completedJob.status, "COMPLETED");
    assert.ok(completedJob.completedAt instanceof Date);
    console.log(`  ✔ Test 4.4 Passed: Job ${createdJobId} marked COMPLETED in database.`);

    // ── SECTION 5: SYNC STATUS ENDPOINT VERIFICATION ──────────────────────────
    console.log("\n--- SECTION 5: Sync Status Verification ---");

    console.log("\n[Test 5.1] GET /api/v1/companies/:companyId/sync-status reflects freshness & history...");
    const resStatus = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/sync-status`,
      headers: { "x-api-key": rawKeyA },
    });
    assert.equal(resStatus.statusCode, 200);
    const statusData = resStatus.json();
    assert.equal(statusData.success, true);
    assert.equal(statusData.data.companyId, companyAId);
    assert.equal(statusData.data.connectorStatus, "ONLINE");
    assert.ok("currentSyncStatus" in statusData.data);
    assert.ok("lastSuccessfulSync" in statusData.data);
    assert.ok("lastFailedSync" in statusData.data);
    assert.ok(typeof statusData.data.recordsProcessed === "number");
    console.log(`  ✔ Test 5.1 Passed: sync-status returns currentSyncStatus=${statusData.data.currentSyncStatus}, recordsProcessed=${statusData.data.recordsProcessed}.`);

    console.log("\n===================================================================");
    console.log("   ALL SAAS TRIGGERED SYNC & CONNECTOR TESTS PASSED (100% SUCCESS) ");
    console.log("===================================================================\n");
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log("[Cleanup] Cleaning up test records...");
    await prisma.syncJob.deleteMany({
      where: { connectorId: { in: [connectorAId, connectorBId] } },
    });
    await prisma.syncHistory.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.apiKey.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.connector.deleteMany({
      where: { id: { in: [connectorAId, connectorBId] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [companyAId, companyBId] } },
    });
    await app.close();
    await prisma.$disconnect();
    console.log("[Cleanup] Done.");
  }
}

runSaasTriggeredSyncTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
