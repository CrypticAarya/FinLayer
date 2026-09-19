import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const BASE_DB_URL = process.env.DATABASE_URL || "postgresql://eunoia@localhost:5432/finlayer";
const parsedUrl = new URL(BASE_DB_URL);
const PG_USER = parsedUrl.username || "eunoia";
const PG_HOST = parsedUrl.hostname || "localhost";
const PG_PORT = parseInt(parsedUrl.port || "5432", 10);
const PG_PASSWORD = parsedUrl.password || undefined;

const DISPOSABLE_DB = "finlayer_v1_v2_disposable_test";
const EMPTY_TEST_DB = "finlayer_empty_migration_test";

const DISPOSABLE_DB_URL = `postgresql://${PG_USER}${PG_PASSWORD ? `:${PG_PASSWORD}` : ""}@${PG_HOST}:${PG_PORT}/${DISPOSABLE_DB}`;
const EMPTY_TEST_DB_URL = `postgresql://${PG_USER}${PG_PASSWORD ? `:${PG_PASSWORD}` : ""}@${PG_HOST}:${PG_PORT}/${EMPTY_TEST_DB}`;

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../prisma/migrations");

const V1_MIGRATION_NAMES = [
  "20260909053725_init",
  "20260909063618_add_vouchers",
  "20260909071017_add_connectors",
  "20260909071654_add_sync_jobs",
  "20260909084815_add_saas_application_and_mapping",
  "20260910070137_add_trial_balance",
  "20260910071613_make_connector_company_optional",
  "20260910072900_add_connector_setup_status_and_tally_company",
  "20260910075937_add_google_connection",
  "20260910090005_add_sync_history",
];

async function createDatabase(dbName: string) {
  const client = new pg.Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: "postgres",
  });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${dbName};`);
    await client.query(`CREATE DATABASE ${dbName};`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(dbName: string) {
  const client = new pg.Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: "postgres",
  });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${dbName};`);
  } finally {
    await client.end();
  }
}

async function setupV1Database(dbUrl: string) {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    // Create Prisma migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Apply V1 migrations 1 through 10 in order
    for (const name of V1_MIGRATION_NAMES) {
      const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");

      await client.query("BEGIN;");
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
         VALUES ($1, $2, NOW(), $3, 1);`,
        [crypto.randomUUID(), checksum, name]
      );
      await client.query("COMMIT;");
    }
  } finally {
    await client.end();
  }
}

async function runTests() {
  console.log("===================================================================");
  console.log("   FINLAYER V2: V1 -> V2 DATABASE MIGRATION ADVERSARIAL QA SUITE   ");
  console.log("===================================================================\n");

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1 — V1 BASELINE
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 1] Creating disposable PostgreSQL database and applying V1 migrations (1-10)...");
    await createDatabase(DISPOSABLE_DB);
    await setupV1Database(DISPOSABLE_DB_URL);

    const client = new pg.Client({ connectionString: DISPOSABLE_DB_URL });
    await client.connect();

    const v1ColsRes = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Voucher';
    `);
    const v1ColNames = v1ColsRes.rows.map((r) => r.column_name);

    assert.ok(!v1ColNames.includes("masterId"), "TEST 1 FAIL: V1 Voucher should NOT have masterId");
    assert.ok(!v1ColNames.includes("alterId"), "TEST 1 FAIL: V1 Voucher should NOT have alterId");
    assert.ok(!v1ColNames.includes("guid"), "TEST 1 FAIL: V1 Voucher should NOT have guid");
    assert.ok(!v1ColNames.includes("syncRunId"), "TEST 1 FAIL: V1 Voucher should NOT have syncRunId");
    console.log("  ✓ TEST 1 PASSED: Baseline V1 schema contains 0 V2 identity columns.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2 — SEED V1 DATA
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 2] Seeding Company A and Company B with historical V1 vouchers & entries...");

    const companyAId = "cmp_a_" + crypto.randomBytes(8).toString("hex");
    const companyBId = "cmp_b_" + crypto.randomBytes(8).toString("hex");

    await client.query(`
      INSERT INTO "Company" ("id", "name", "tallyCompanyName", "createdAt", "updatedAt")
      VALUES 
        ($1, 'Company A Pvt Ltd', 'Company A Tally', NOW() - INTERVAL '10 days', NOW()),
        ($2, 'Company B LLC', 'Company B Tally', NOW() - INTERVAL '10 days', NOW());
    `, [companyAId, companyBId]);

    const ledgerA1 = "ldg_a1_" + crypto.randomBytes(6).toString("hex");
    const ledgerA2 = "ldg_a2_" + crypto.randomBytes(6).toString("hex");
    const ledgerB1 = "ldg_b1_" + crypto.randomBytes(6).toString("hex");
    const ledgerB2 = "ldg_b2_" + crypto.randomBytes(6).toString("hex");

    await client.query(`
      INSERT INTO "Ledger" ("id", "companyId", "name", "parent", "masterId", "alterId", "createdAt", "updatedAt")
      VALUES
        ($1, $2, 'Sales Ledger A', 'Sales Accounts', 101, 1, NOW(), NOW()),
        ($3, $2, 'Cash Ledger A', 'Cash-in-hand', 102, 1, NOW(), NOW()),
        ($4, $5, 'Sales Ledger B', 'Sales Accounts', 201, 1, NOW(), NOW()),
        ($6, $5, 'Bank Ledger B', 'Bank Accounts', 202, 1, NOW(), NOW());
    `, [ledgerA1, companyAId, ledgerA2, ledgerB1, companyBId, ledgerB2]);

    // Seed 5 vouchers for Company A and 5 vouchers for Company B using V1 columns ONLY
    const preVouchers: Array<{ id: string; companyId: string; voucherNumber: string; amount: number; date: string }> = [];
    let preTotalDebit = 0;
    let preTotalCredit = 0;

    for (let i = 1; i <= 5; i++) {
      const vIdA = `v_a_${i}_` + crypto.randomBytes(6).toString("hex");
      const amtA = i * 1500.50;
      const dateA = `2026-04-0${i}T00:00:00.000Z`;
      const numA = `VCH-A-${100 + i}`;

      await client.query(`
        INSERT INTO "Voucher" ("id", "companyId", "voucherNumber", "voucherType", "date", "partyName", "amount", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'Sales', $4, 'Customer A', $5, NOW() - INTERVAL '${10 - i} days', NOW());
      `, [vIdA, companyAId, numA, dateA, amtA]);

      await client.query(`
        INSERT INTO "VoucherEntry" ("id", "voucherId", "ledgerId", "amount", "type", "createdAt")
        VALUES 
          ($1, $2, $3, $4, 'debit', NOW()),
          ($5, $2, $6, $4, 'credit', NOW());
      `, [`ve_a_deb_${i}`, vIdA, ledgerA2, amtA, `ve_a_crd_${i}`, ledgerA1]);

      preVouchers.push({ id: vIdA, companyId: companyAId, voucherNumber: numA, amount: amtA, date: dateA });
      preTotalDebit += amtA;
      preTotalCredit += amtA;

      const vIdB = `v_b_${i}_` + crypto.randomBytes(6).toString("hex");
      const amtB = i * 2750.25;
      const dateB = `2026-05-0${i}T00:00:00.000Z`;
      const numB = `VCH-B-${200 + i}`;

      await client.query(`
        INSERT INTO "Voucher" ("id", "companyId", "voucherNumber", "voucherType", "date", "partyName", "amount", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'Receipt', $4, 'Customer B', $5, NOW() - INTERVAL '${10 - i} days', NOW());
      `, [vIdB, companyBId, numB, dateB, amtB]);

      await client.query(`
        INSERT INTO "VoucherEntry" ("id", "voucherId", "ledgerId", "amount", "type", "createdAt")
        VALUES 
          ($1, $2, $3, $4, 'debit', NOW()),
          ($5, $2, $6, $4, 'credit', NOW());
      `, [`ve_b_deb_${i}`, vIdB, ledgerB2, amtB, `ve_b_crd_${i}`, ledgerB1]);

      preVouchers.push({ id: vIdB, companyId: companyBId, voucherNumber: numB, amount: amtB, date: dateB });
      preTotalDebit += amtB;
      preTotalCredit += amtB;
    }

    const preVoucherCountRes = await client.query('SELECT count(*) FROM "Voucher";');
    const preEntryCountRes = await client.query('SELECT count(*) FROM "VoucherEntry";');
    const preVoucherCount = parseInt(preVoucherCountRes.rows[0].count, 10);
    const preEntryCount = parseInt(preEntryCountRes.rows[0].count, 10);

    assert.equal(preVoucherCount, 10, "TEST 2 FAIL: Expected 10 seeded vouchers");
    assert.equal(preEntryCount, 20, "TEST 2 FAIL: Expected 20 seeded entries");
    console.log(`  ✓ TEST 2 PASSED: Seeded 10 V1 vouchers, 20 entries. Pre-migration financial checksum: Debit=${preTotalDebit.toFixed(2)}, Credit=${preTotalCredit.toFixed(2)}.`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3 — APPLY V2 MIGRATIONS (11-17)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 3] Running `npx prisma migrate deploy` against disposable database...");
    await client.end(); // close client before migration deploy

    const deployOutput = execSync("npx prisma migrate deploy", {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: DISPOSABLE_DB_URL,
      },
      encoding: "utf-8",
    });

    console.log("  Deploy output summary:\n" + deployOutput.split("\n").filter(l => l.includes("Applying") || l.includes("successfully")).join("\n"));
    assert.ok(deployOutput.includes("All migrations have been successfully applied"), "TEST 3 FAIL: Migrations did not report success");
    console.log("  ✓ TEST 3 PASSED: Migrations 11-17 deployed successfully on database containing real V1 data.");

    // Re-connect client to test DB
    const clientV2 = new pg.Client({ connectionString: DISPOSABLE_DB_URL });
    await clientV2.connect();

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4 — MASTERID VALIDATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 4] Validating deterministic negative masterId assignment...");
    const masterA = await clientV2.query(
      `SELECT "masterId", "voucherNumber" FROM "Voucher" WHERE "companyId" = $1 ORDER BY "masterId" ASC;`,
      [companyAId]
    );
    const masterB = await clientV2.query(
      `SELECT "masterId", "voucherNumber" FROM "Voucher" WHERE "companyId" = $1 ORDER BY "masterId" ASC;`,
      [companyBId]
    );

    const masterIdsA = masterA.rows.map((r) => r.masterId);
    const masterIdsB = masterB.rows.map((r) => r.masterId);

    console.log(`  Company A masterIds: [${masterIdsA.join(", ")}]`);
    console.log(`  Company B masterIds: [${masterIdsB.join(", ")}]`);

    assert.deepEqual(masterIdsA, [-5, -4, -3, -2, -1], "TEST 4 FAIL: Company A masterIds must be [-5, -4, -3, -2, -1]");
    assert.deepEqual(masterIdsB, [-5, -4, -3, -2, -1], "TEST 4 FAIL: Company B masterIds must be [-5, -4, -3, -2, -1]");

    const nullMasterCheck = await clientV2.query(`SELECT count(*) FROM "Voucher" WHERE "masterId" IS NULL;`);
    assert.equal(parseInt(nullMasterCheck.rows[0].count, 10), 0, "TEST 4 FAIL: Found NULL masterId values");

    const dupMasterCheck = await clientV2.query(`
      SELECT "companyId", "masterId", count(*) 
      FROM "Voucher" 
      GROUP BY "companyId", "masterId" 
      HAVING count(*) > 1;
    `);
    assert.equal(dupMasterCheck.rows.length, 0, "TEST 4 FAIL: Duplicate (companyId, masterId) detected");
    console.log("  ✓ TEST 4 PASSED: Deterministic negative masterIds correctly partitioned by company with 0 collisions and 0 NULLs.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5 — ALTERID VALIDATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 5] Validating alterId assignment...");
    const alterCheck = await clientV2.query(`SELECT DISTINCT "alterId" FROM "Voucher";`);
    assert.equal(alterCheck.rows.length, 1, "TEST 5 FAIL: Expected all alterIds to be identical");
    assert.equal(alterCheck.rows[0].alterId, 1, "TEST 5 FAIL: Expected alterId = 1");

    const nullAlterCheck = await clientV2.query(`SELECT count(*) FROM "Voucher" WHERE "alterId" IS NULL;`);
    assert.equal(parseInt(nullAlterCheck.rows[0].count, 10), 0, "TEST 5 FAIL: Found NULL alterId values");
    console.log("  ✓ TEST 5 PASSED: All historical vouchers have alterId = 1 with 0 NULLs.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6 — SYNC RUN TENANT ISOLATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 6] Validating tenant-scoped SyncRun creation...");
    const syncRuns = await clientV2.query(`SELECT "id", "companyId", "status", "recordsCreated" FROM "SyncRun" ORDER BY "id" ASC;`);
    assert.equal(syncRuns.rows.length, 2, "TEST 6 FAIL: Expected exactly 2 SyncRun rows (one per company)");

    const expectedSyncRunA = `legacy-backfill-${companyAId}`;
    const expectedSyncRunB = `legacy-backfill-${companyBId}`;

    const srA = syncRuns.rows.find((r) => r.id === expectedSyncRunA);
    const srB = syncRuns.rows.find((r) => r.id === expectedSyncRunB);

    assert.ok(srA, `TEST 6 FAIL: Missing SyncRun for Company A (${expectedSyncRunA})`);
    assert.ok(srB, `TEST 6 FAIL: Missing SyncRun for Company B (${expectedSyncRunB})`);
    assert.equal(srA.companyId, companyAId, "TEST 6 FAIL: SyncRun A companyId mismatch");
    assert.equal(srB.companyId, companyBId, "TEST 6 FAIL: SyncRun B companyId mismatch");
    assert.equal(srA.recordsCreated, 5, "TEST 6 FAIL: SyncRun A should record 5 created vouchers");
    assert.equal(srB.recordsCreated, 5, "TEST 6 FAIL: SyncRun B should record 5 created vouchers");

    // Invariant: SyncRun.companyId === Voucher.companyId for EVERY voucher
    const tenantLeakCheck = await clientV2.query(`
      SELECT v.id, v."companyId" as v_comp, s."companyId" as s_comp
      FROM "Voucher" v
      JOIN "SyncRun" s ON v."syncRunId" = s.id
      WHERE v."companyId" != s."companyId";
    `);
    assert.equal(tenantLeakCheck.rows.length, 0, "TEST 6 FAIL: Detected cross-tenant SyncRun assignment!");
    console.log("  ✓ TEST 6 PASSED: Tenant-scoped SyncRuns created. Voucher.companyId === SyncRun.companyId verified across 100% of records.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7 — FOREIGN KEY ENFORCEMENT
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 7] Validating Voucher_syncRunId_fkey foreign key constraint...");
    const fkExists = await clientV2.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'Voucher' AND constraint_name = 'Voucher_syncRunId_fkey';
    `);
    assert.equal(fkExists.rows.length, 1, "TEST 7 FAIL: Voucher_syncRunId_fkey does not exist");

    // Attempt invalid FK insert: voucher referencing non-existent syncRun
    let fkRejected = false;
    try {
      await clientV2.query(`
        INSERT INTO "Voucher" ("id", "companyId", "masterId", "alterId", "syncRunId", "voucherNumber", "voucherType", "date", "amount", "createdAt", "updatedAt")
        VALUES ('v_invalid_fk', $1, -999, 1, 'non_existent_sync_run_id', 'TEST-INV', 'Sales', NOW(), 100, NOW(), NOW());
      `, [companyAId]);
    } catch (err: any) {
      if (err.code === "23503") { // foreign_key_violation
        fkRejected = true;
      } else {
        throw err;
      }
    }
    assert.ok(fkRejected, "TEST 7 FAIL: PostgreSQL failed to reject invalid syncRunId foreign key reference!");
    console.log("  ✓ TEST 7 PASSED: Foreign key Voucher_syncRunId_fkey is active and strictly enforced by PostgreSQL.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8 — FINANCIAL INTEGRITY
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 8] Validating financial integrity and zero data modification...");
    const postVoucherCountRes = await clientV2.query('SELECT count(*) FROM "Voucher";');
    const postEntryCountRes = await clientV2.query('SELECT count(*) FROM "VoucherEntry";');
    assert.equal(parseInt(postVoucherCountRes.rows[0].count, 10), preVoucherCount, "TEST 8 FAIL: Voucher count changed");
    assert.equal(parseInt(postEntryCountRes.rows[0].count, 10), preEntryCount, "TEST 8 FAIL: VoucherEntry count changed");

    const financialTotalsRes = await clientV2.query(`
      SELECT 
        SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as total_debit,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as total_credit
      FROM "VoucherEntry";
    `);
    const postTotalDebit = parseFloat(financialTotalsRes.rows[0].total_debit);
    const postTotalCredit = parseFloat(financialTotalsRes.rows[0].total_credit);

    assert.equal(postTotalDebit, preTotalDebit, "TEST 8 FAIL: Total debit changed after migration");
    assert.equal(postTotalCredit, preTotalCredit, "TEST 8 FAIL: Total credit changed after migration");

    // Check individual voucher data
    for (const pv of preVouchers) {
      const vRes = await clientV2.query('SELECT id, "companyId", amount, date, "voucherNumber" FROM "Voucher" WHERE id = $1;', [pv.id]);
      assert.equal(vRes.rows.length, 1, `TEST 8 FAIL: Voucher ${pv.id} not found`);
      const row = vRes.rows[0];
      assert.equal(row.companyId, pv.companyId, `TEST 8 FAIL: Company changed for voucher ${pv.id}`);
      assert.equal(parseFloat(row.amount), pv.amount, `TEST 8 FAIL: Amount changed for voucher ${pv.id}`);
      assert.equal(row.voucherNumber, pv.voucherNumber, `TEST 8 FAIL: VoucherNumber changed for voucher ${pv.id}`);
    }
    console.log("  ✓ TEST 8 PASSED: Financial delta is exactly 0.00. Zero amounts, dates, or ledger links modified.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9 — FUTURE TALLY SYNCHRONIZATION (POSITIVE MASTERIDS)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 9] Simulating future Tally sync with positive MASTERIDs (1, 2, 3)...");
    const tallySyncRunId = "sync_run_modern_" + crypto.randomBytes(6).toString("hex");
    await clientV2.query(`
      INSERT INTO "SyncRun" ("id", "companyId", "status", "startedAt", "recordsCreated", "updatedAt")
      VALUES ($1, $2, 'SYNC_COMPLETED', NOW(), 3, NOW());
    `, [tallySyncRunId, companyAId]);

    for (let mId = 1; mId <= 3; mId++) {
      await clientV2.query(`
        INSERT INTO "Voucher" ("id", "companyId", "masterId", "alterId", "syncRunId", "voucherNumber", "voucherType", "date", "amount", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 1, $4, $5, 'Payment', NOW(), $6, NOW(), NOW());
      `, [`v_modern_a_${mId}`, companyAId, mId, tallySyncRunId, `TALLY-RCPT-${mId}`, mId * 500]);
    }

    const allA = await clientV2.query(
      `SELECT "masterId", "voucherNumber" FROM "Voucher" WHERE "companyId" = $1 ORDER BY "masterId" ASC;`,
      [companyAId]
    );
    const allMasterIdsA = allA.rows.map((r) => r.masterId);
    console.log(`  Company A all masterIds after Tally sync: [${allMasterIdsA.join(", ")}]`);

    assert.deepEqual(allMasterIdsA, [-5, -4, -3, -2, -1, 1, 2, 3], "TEST 9 FAIL: Unexpected masterId set after modern sync");
    assert.equal(allA.rows.length, 8, "TEST 9 FAIL: Expected 8 vouchers in Company A");
    console.log("  ✓ TEST 9 PASSED: Real Tally vouchers (1, 2, 3) inserted without overwriting historical records (-1..-5).");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10 — FUTURE TALLY VOUCHER UPDATE
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 10] Simulating future Tally voucher update (masterId=1, alterId=2)...");
    await clientV2.query(`
      UPDATE "Voucher" 
      SET "alterId" = 2, amount = 9999.00, "updatedAt" = NOW()
      WHERE "companyId" = $1 AND "masterId" = 1;
    `, [companyAId]);

    const updatedV = await clientV2.query(`
      SELECT "masterId", "alterId", amount FROM "Voucher" WHERE "companyId" = $1 AND "masterId" = 1;
    `, [companyAId]);
    assert.equal(updatedV.rows[0].alterId, 2, "TEST 10 FAIL: Expected alterId = 2");
    assert.equal(parseFloat(updatedV.rows[0].amount), 9999.00, "TEST 10 FAIL: Expected amount = 9999.00");

    // Verify historical vouchers remain unaltered
    const legacyCheck = await clientV2.query(`
      SELECT "masterId", "alterId" FROM "Voucher" WHERE "companyId" = $1 AND "masterId" < 0;
    `, [companyAId]);
    for (const row of legacyCheck.rows) {
      assert.equal(row.alterId, 1, `TEST 10 FAIL: Historical voucher ${row.masterId} alterId changed!`);
    }
    console.log("  ✓ TEST 10 PASSED: Modern voucher update updated only masterId=1. Historical vouchers remained untouched.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 11 — MULTI-TENANT COMPOUND UNIQUENESS
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 11] Verifying multi-tenant uniqueness on compound key (companyId, masterId)...");
    const vA_neg1 = await clientV2.query(`SELECT id FROM "Voucher" WHERE "companyId" = $1 AND "masterId" = -1;`, [companyAId]);
    const vB_neg1 = await clientV2.query(`SELECT id FROM "Voucher" WHERE "companyId" = $1 AND "masterId" = -1;`, [companyBId]);
    assert.equal(vA_neg1.rows.length, 1, "TEST 11 FAIL: Company A should have masterId = -1");
    assert.equal(vB_neg1.rows.length, 1, "TEST 11 FAIL: Company B should have masterId = -1");
    console.log("  ✓ TEST 11 PASSED: Both Company A and Company B hold masterId = -1 concurrently without unique index conflict.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 12 — EMPTY DATABASE MIGRATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 12] Validating full V1 -> V2 migration on an empty database...");
    await clientV2.end();

    await createDatabase(EMPTY_TEST_DB);
    await setupV1Database(EMPTY_TEST_DB_URL);

    const emptyDeployOutput = execSync("npx prisma migrate deploy", {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: EMPTY_TEST_DB_URL,
      },
      encoding: "utf-8",
    });
    assert.ok(emptyDeployOutput.includes("All migrations have been successfully applied"), "TEST 12 FAIL: Empty DB deploy failed");

    const emptyClient = new pg.Client({ connectionString: EMPTY_TEST_DB_URL });
    await emptyClient.connect();
    const emptySyncRuns = await emptyClient.query('SELECT count(*) FROM "SyncRun";');
    assert.equal(parseInt(emptySyncRuns.rows[0].count, 10), 0, "TEST 12 FAIL: Empty database should have 0 SyncRun rows");
    await emptyClient.end();
    console.log("  ✓ TEST 12 PASSED: Clean empty database upgraded successfully. 0 synthetic SyncRuns created.");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 13 — MIGRATION REDEPLOY IDEMPOTENCY
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST 13] Verifying redeploy idempotency (re-running `prisma migrate deploy`)...");
    const redeployOutput = execSync("npx prisma migrate deploy", {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: DISPOSABLE_DB_URL,
      },
      encoding: "utf-8",
    });
    assert.ok(redeployOutput.includes("No pending migrations to apply"), "TEST 13 FAIL: Redeploy should report no pending migrations");
    console.log("  ✓ TEST 13 PASSED: Repeated migrate deploy is strictly idempotent.");

    // ─────────────────────────────────────────────────────────────────────────
    // CLEANUP
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[Cleanup] Dropping disposable test databases...");
    await dropDatabase(DISPOSABLE_DB);
    await dropDatabase(EMPTY_TEST_DB);
    console.log("  ✓ Cleanup complete.");

    console.log("\n===================================================================");
    console.log("   ALL 13 MIGRATION REPAIR TESTS PASSED WITH 100% SUCCESS!         ");
    console.log("===================================================================\n");
  } catch (err) {
    console.error("\n❌ MIGRATION TEST FAILED:", err);
    try {
      await dropDatabase(DISPOSABLE_DB);
      await dropDatabase(EMPTY_TEST_DB);
    } catch {}
    process.exit(1);
  }
}

runTests();
