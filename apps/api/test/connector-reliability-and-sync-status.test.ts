import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildApp } from "../src/app.js";
import prisma from "../src/db/prisma.js";

async function runConnectorReliabilityAndSyncStatusTests() {
  console.log("===================================================================");
  console.log("   FINLAYER V2.4: CONNECTOR RELIABILITY & SYNC STATUS TEST SUITE   ");
  console.log("===================================================================\n");

  const app = await buildApp({ logger: false });
  await app.ready();

  const timestamp = Date.now();
  const companyAName = `V2.4 Tenant A Co ${timestamp}`;
  const companyBName = `V2.4 Tenant B Co ${timestamp}`;
  const companyCName = `V2.4 Tenant C Co ${timestamp}`;

  let companyAId = "";
  let companyBId = "";
  let companyCId = "";

  let connectorAId = "";
  let connectorBId = "";
  let rawTokenA = "";
  let rawTokenB = "";
  let rawTokenRevoked = "";

  let rawKeyA = "";
  let rawKeyB = "";
  let rawKeyC = "";

  try {
    // ─── 0. SETUP TEST TENANTS, CONNECTORS & KEYS ─────────────────────────────
    console.log("[Setup] Creating Tenant Companies A, B, and C...");
    const companyA = await prisma.company.create({
      data: { name: companyAName, tallyCompanyName: companyAName },
    });
    companyAId = companyA.id;

    const companyB = await prisma.company.create({
      data: { name: companyBName, tallyCompanyName: companyBName },
    });
    companyBId = companyB.id;

    const companyC = await prisma.company.create({
      data: { name: companyCName, tallyCompanyName: companyCName },
    });
    companyCId = companyC.id;

    // Connectors
    rawTokenA = `fl_conn_${crypto.randomBytes(32).toString("hex")}`;
    const tokenHashA = crypto.createHash("sha256").update(rawTokenA).digest("hex");
    const connectorA = await prisma.connector.create({
      data: {
        name: "Tally Connector A",
        deviceId: `dev_conn_a_${timestamp}`,
        tokenHash: tokenHashA,
        companyId: companyAId,
        tallyCompanyName: companyAName,
        status: "ONLINE",
        setupStatus: "ACTIVE",
        connectorVersion: "2.3.0",
        lastHeartbeat: new Date(Date.now() - 60000),
        lastSeenAt: new Date(Date.now() - 60000),
      },
    });
    connectorAId = connectorA.id;

    rawTokenB = `fl_conn_${crypto.randomBytes(32).toString("hex")}`;
    const tokenHashB = crypto.createHash("sha256").update(rawTokenB).digest("hex");
    const connectorB = await prisma.connector.create({
      data: {
        name: "Tally Connector B",
        deviceId: `dev_conn_b_${timestamp}`,
        tokenHash: tokenHashB,
        companyId: companyBId,
        tallyCompanyName: companyBName,
        status: "ONLINE",
        setupStatus: "ACTIVE",
        connectorVersion: "2.3.0",
        lastHeartbeat: new Date(),
        lastSeenAt: new Date(),
      },
    });
    connectorBId = connectorB.id;

    // Revoked connector token
    rawTokenRevoked = `fl_conn_${crypto.randomBytes(32).toString("hex")}`;
    const tokenHashRevoked = crypto.createHash("sha256").update(rawTokenRevoked).digest("hex");
    await prisma.connector.create({
      data: {
        name: "Revoked Connector",
        deviceId: `dev_conn_revoked_${timestamp}`,
        tokenHash: tokenHashRevoked,
        tokenRevokedAt: new Date(),
        status: "REVOKED",
        setupStatus: "REVOKED",
      },
    });

    // SaaS API Keys
    rawKeyA = `fl_live_${crypto.randomBytes(24).toString("hex")}`;
    await prisma.apiKey.create({
      data: {
        name: "Key A",
        keyPrefix: rawKeyA.slice(0, 16),
        keyHash: crypto.createHash("sha256").update(rawKeyA).digest("hex"),
        companyId: companyAId,
        status: "ACTIVE",
      },
    });

    rawKeyB = `fl_live_${crypto.randomBytes(24).toString("hex")}`;
    await prisma.apiKey.create({
      data: {
        name: "Key B",
        keyPrefix: rawKeyB.slice(0, 16),
        keyHash: crypto.createHash("sha256").update(rawKeyB).digest("hex"),
        companyId: companyBId,
        status: "ACTIVE",
      },
    });

    rawKeyC = `fl_live_${crypto.randomBytes(24).toString("hex")}`;
    await prisma.apiKey.create({
      data: {
        name: "Key C",
        keyPrefix: rawKeyC.slice(0, 16),
        keyHash: crypto.createHash("sha256").update(rawKeyC).digest("hex"),
        companyId: companyCId,
        status: "ACTIVE",
      },
    });

    console.log("  ✔ Setup completed successfully.");

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 1: CONNECTOR HEARTBEAT AUTHENTICATION & PERSISTENCE
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- SECTION 1: Connector Heartbeat System ---");

    console.log("\n[Test 1.1] Heartbeat without token -> 401 Unauthorized...");
    const hbRes1 = await app.inject({
      method: "POST",
      url: "/connectors/heartbeat",
    });
    assert.equal(hbRes1.statusCode, 401);
    console.log("  ✔ Test 1.1 Passed: Missing token rejected with 401.");

    console.log("\n[Test 1.2] Heartbeat with invalid token -> 401 Unauthorized...");
    const hbRes2 = await app.inject({
      method: "POST",
      url: "/connectors/heartbeat",
      headers: { authorization: "Bearer ct_forged_invalid_token_12345" },
    });
    assert.equal(hbRes2.statusCode, 401);
    console.log("  ✔ Test 1.2 Passed: Invalid token rejected with 401.");

    console.log("\n[Test 1.3] Heartbeat with revoked token -> 401 Unauthorized...");
    const hbRes3 = await app.inject({
      method: "POST",
      url: "/connectors/heartbeat",
      headers: { authorization: `Bearer ${rawTokenRevoked}` },
    });
    assert.equal(hbRes3.statusCode, 401);
    console.log("  ✔ Test 1.3 Passed: Revoked token rejected with 401.");

    console.log("\n[Test 1.4] Cross-connector heartbeat attempt (Connector A targeting Connector B ID) -> 403 Forbidden...");
    const hbRes4 = await app.inject({
      method: "POST",
      url: `/connectors/${connectorBId}/heartbeat`,
      headers: { authorization: `Bearer ${rawTokenA}` },
      payload: { connectorVersion: "2.4.0", status: "ONLINE" },
    });
    assert.equal(hbRes4.statusCode, 403);
    assert.match(hbRes4.json().error, /cannot access or modify resources belonging to another connector/i);
    console.log("  ✔ Test 1.4 Passed: Cross-connector manipulation rejected with 403 Forbidden.");

    console.log("\n[Test 1.5] Authorized heartbeat via POST /connectors/heartbeat -> 200 OK & DB persistence...");
    const hbRes5 = await app.inject({
      method: "POST",
      url: "/connectors/heartbeat",
      headers: { authorization: `Bearer ${rawTokenA}` },
      payload: { connectorVersion: "2.4.0", status: "ONLINE" },
    });
    assert.equal(hbRes5.statusCode, 200);
    const hbBody5 = hbRes5.json();
    assert.equal(hbBody5.success, true);
    assert.equal(hbBody5.connectorId, connectorAId);
    assert.equal(hbBody5.connectorVersion, "2.4.0");
    assert.equal(hbBody5.status, "ONLINE");
    assert.ok(hbBody5.lastSeenAt);

    // Verify DB update on Connector
    const dbConnectorA = await prisma.connector.findUnique({ where: { id: connectorAId } });
    assert.ok(dbConnectorA);
    assert.equal(dbConnectorA.connectorVersion, "2.4.0");
    assert.equal(dbConnectorA.status, "ONLINE");
    assert.ok(dbConnectorA.lastSeenAt);

    // Verify DB insert in ConnectorHeartbeat
    const heartbeats = await prisma.connectorHeartbeat.findMany({
      where: { connectorId: connectorAId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(heartbeats.length > 0, "ConnectorHeartbeat entry must be recorded");
    assert.equal(heartbeats[0].connectorId, connectorAId);
    assert.equal(heartbeats[0].companyId, companyAId);
    assert.equal(heartbeats[0].connectorVersion, "2.4.0");
    assert.equal(heartbeats[0].status, "ONLINE");
    console.log("  ✔ Test 1.5 Passed: Heartbeat recorded, Connector updated, and ConnectorHeartbeat persisted.");

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 2: SYNC AUDIT TRACKING
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- SECTION 2: Sync Audit Tracking ---");

    console.log("\n[Test 2.1] Ingesting and completing a sync run for Company A...");
    const { SyncAuditService } = await import("../src/services/sync-audit-service.js");
    const syncRunIdA = `sync-run-a-${timestamp}`;

    const startedRunId = await SyncAuditService.startSyncRun({
      companyId: companyAId,
      syncRunId: syncRunIdA,
      recordsFetched: 10,
      syncType: "VOUCHERS",
    });
    assert.equal(startedRunId, syncRunIdA);

    // Complete the sync run
    await SyncAuditService.completeSyncRun({
      syncRunId: syncRunIdA,
      recordsCreated: 8,
      recordsUpdated: 2,
      recordsFailed: 0,
    });

    const dbSyncRunA = await prisma.syncRun.findUnique({ where: { id: syncRunIdA } });
    assert.ok(dbSyncRunA);
    assert.equal(dbSyncRunA.status, "SYNC_COMPLETED");
    assert.equal(dbSyncRunA.recordsProcessed, 10);
    assert.equal(dbSyncRunA.recordsCreated, 8);
    assert.equal(dbSyncRunA.recordsUpdated, 2);
    assert.equal(dbSyncRunA.recordsFailed, 0);
    assert.ok(typeof dbSyncRunA.durationMs === "number", "durationMs must be recorded");
    assert.ok(dbSyncRunA.completedAt, "completedAt must be set");
    console.log(`  ✔ Test 2.1 Passed: SyncRun completed with status=${dbSyncRunA.status}, recordsProcessed=${dbSyncRunA.recordsProcessed}, durationMs=${dbSyncRunA.durationMs}ms.`);

    console.log("\n[Test 2.2] Recording a failed sync run with errors...");
    const syncRunIdFail = `sync-run-fail-${timestamp}`;
    await SyncAuditService.startSyncRun({
      companyId: companyAId,
      syncRunId: syncRunIdFail,
      recordsFetched: 5,
      syncType: "VOUCHERS",
    });
    await SyncAuditService.failSyncRun(syncRunIdFail, "TallyPrime connection timeout after 30s");

    const dbSyncRunFail = await prisma.syncRun.findUnique({ where: { id: syncRunIdFail } });
    assert.ok(dbSyncRunFail);
    assert.equal(dbSyncRunFail.status, "SYNC_FAILED");
    assert.equal(dbSyncRunFail.errorSummary, "TallyPrime connection timeout after 30s");
    assert.ok(typeof dbSyncRunFail.durationMs === "number");
    console.log("  ✔ Test 2.2 Passed: Failed SyncRun audit record captures errorSummary and duration.");

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 3: SAAS API TENANT ISOLATION ON /sync-status
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- SECTION 3: SaaS API Tenant Isolation ---");

    console.log("\n[Test 3.1] GET /sync-status without API key -> 401 Unauthorized...");
    const resNoKey = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/sync-status`,
    });
    assert.equal(resNoKey.statusCode, 401);
    console.log("  ✔ Test 3.1 Passed: Unauthenticated request rejected with 401.");

    console.log("\n[Test 3.2] GET /sync-status with invalid API key -> 401 Unauthorized...");
    const resBadKey = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/sync-status`,
      headers: { authorization: "Bearer fl_live_fakekey12345678901234567890" },
    });
    assert.equal(resBadKey.statusCode, 401);
    console.log("  ✔ Test 3.2 Passed: Invalid API key rejected with 401.");

    console.log("\n[Test 3.3] Cross-Tenant Access: Company A key requesting Company B /sync-status -> 403 Forbidden...");
    const resCross = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyBId}/sync-status`,
      headers: { authorization: `Bearer ${rawKeyA}` },
    });
    assert.equal(resCross.statusCode, 403);
    assert.match(resCross.json().error, /Forbidden.*API key does not have access to this company/i);
    console.log("  ✔ Test 3.3 Passed: Cross-tenant sync status request strictly forbidden (403).");

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 4: SYNC STATUS RESPONSE VERIFICATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- SECTION 4: Sync Status Response Verification ---");

    console.log("\n[Test 4.1] Authorized request for Company A -> 200 OK with full freshness metrics...");
    const resStatusA = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyAId}/sync-status`,
      headers: { authorization: `Bearer ${rawKeyA}` },
    });
    assert.equal(resStatusA.statusCode, 200);
    const bodyA = resStatusA.json();
    assert.equal(bodyA.success, true);
    assert.equal(bodyA.data.companyId, companyAId);
    assert.equal(bodyA.data.connectorStatus, "ONLINE");
    assert.ok(bodyA.data.lastSyncTime);
    assert.ok(bodyA.data.lastSyncResult);
    assert.ok(typeof bodyA.data.recordsProcessed === "number");

    // Verify connector details
    assert.ok(bodyA.data.connector);
    assert.equal(bodyA.data.connector.id, connectorAId);
    assert.equal(bodyA.data.connector.version, "2.4.0");
    assert.ok(bodyA.data.connector.lastSeenAt);

    // Verify lastSync details
    assert.ok(bodyA.data.lastSync);
    assert.ok(typeof bodyA.data.lastSync.durationMs === "number");
    console.log("  ✔ Test 4.1 Passed: Valid sync-status response returned with connectorStatus, lastSyncTime, lastSyncResult, recordsProcessed.");

    console.log("\n[Test 4.2] Clean empty state for Company C (no connectors, no syncs)...");
    const resStatusC = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyCId}/sync-status`,
      headers: { authorization: `Bearer ${rawKeyC}` },
    });
    assert.equal(resStatusC.statusCode, 200);
    const bodyC = resStatusC.json();
    assert.equal(bodyC.success, true);
    assert.equal(bodyC.data.companyId, companyCId);
    assert.equal(bodyC.data.connectorStatus, "DISCONNECTED");
    assert.equal(bodyC.data.lastSyncTime, null);
    assert.equal(bodyC.data.lastSyncResult, null);
    assert.equal(bodyC.data.recordsProcessed, 0);
    assert.equal(bodyC.data.connector, null);
    assert.equal(bodyC.data.lastSync, null);
    console.log("  ✔ Test 4.2 Passed: Clean empty state returned without errors for company with zero sync history.");

    console.log("\n===================================================================");
    console.log("   ALL CONNECTOR RELIABILITY & SYNC STATUS TESTS PASSED (100%)    ");
    console.log("===================================================================\n");
  } finally {
    // Cleanup
    console.log("[Cleanup] Cleaning up test records...");
    if (connectorAId) {
      await prisma.connectorHeartbeat.deleteMany({ where: { connectorId: connectorAId } });
    }
    if (connectorBId) {
      await prisma.connectorHeartbeat.deleteMany({ where: { connectorId: connectorBId } });
    }
    if (companyAId) {
      await prisma.syncRun.deleteMany({ where: { companyId: companyAId } });
      await prisma.connector.deleteMany({ where: { companyId: companyAId } });
      await prisma.apiKey.deleteMany({ where: { companyId: companyAId } });
      await prisma.company.deleteMany({ where: { id: companyAId } });
    }
    if (companyBId) {
      await prisma.connector.deleteMany({ where: { companyId: companyBId } });
      await prisma.apiKey.deleteMany({ where: { companyId: companyBId } });
      await prisma.company.deleteMany({ where: { id: companyBId } });
    }
    if (companyCId) {
      await prisma.apiKey.deleteMany({ where: { companyId: companyCId } });
      await prisma.company.deleteMany({ where: { id: companyCId } });
    }
    console.log("[Cleanup] Completed.");
    await app.close();
  }
}

runConnectorReliabilityAndSyncStatusTests().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
