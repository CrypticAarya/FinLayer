import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";
import { streamVouchersCsv } from "../src/services/canonical-export-service.js";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runPaginationVerificationTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: VOUCHER EXPORT PAGINATION ADVERSARIAL QA          ");
  console.log("===================================================================\n");

  const timestamp = Date.now();
  const companyName = `Pagination Test Corp ${timestamp}`;

  // ── Setup: Create Company & Ledger ──────────────────────────────────────────
  console.log("[Setup] Creating test company and ledger...");
  const company = await prisma.company.create({
    data: {
      name: companyName,
      tallyCompanyName: companyName,
    },
  });

  const ledger = await prisma.ledger.create({
    data: {
      companyId: company.id,
      name: "General Sales",
      parent: "Sales Accounts",
      masterId: 50001,
      alterId: 1,
    },
  });

  try {
    // ── Test 1: 1,500 Vouchers with Inverted / Non-Sequential IDs & Dates ──────
    // We generate 1,500 vouchers across 3 full 500-record pages.
    // To stress test cursor pagination:
    // - Dates range from 2026-01-01 to 2026-05-01 (including duplicate dates).
    // - IDs are assigned in reverse alphabetical order relative to dates!
    // E.g. earliest dates get IDs starting with "z_", "y_", "x_",
    // latest dates get IDs starting with "a_", "b_", "c_".
    console.log("[Test 1] Generating 1,500 vouchers with inverted/non-sequential IDs across 3 pages of 500...");

    const TOTAL_VOUCHERS = 1500;
    const baseDate = new Date("2026-01-01T00:00:00.000Z").getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    // Create 1500 records in batches of 100
    const expectedVouchers: Array<{ id: string; date: Date; masterId: number }> = [];

    for (let i = 0; i < TOTAL_VOUCHERS; i++) {
      // Date advances every 3 records so multiple vouchers share the EXACT same date
      const dateOffsetDays = Math.floor(i / 3);
      const voucherDate = new Date(baseDate + dateOffsetDays * dayMs);

      // INVERTED ID: earliest records (i=0) get high prefixes ("z_999..."), latest get low ("a_000...")
      const reverseIdx = TOTAL_VOUCHERS - i;
      const paddedReverse = String(reverseIdx).padStart(6, "0");
      const id = `inv_${paddedReverse}_${crypto.randomBytes(4).toString("hex")}`;

      expectedVouchers.push({
        id,
        date: voucherDate,
        masterId: 100000 + i,
      });
    }

    // Sort expected records by deterministic SQL sort order: (date ASC, id ASC)
    expectedVouchers.sort((a, b) => {
      const timeDiff = a.date.getTime() - b.date.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    // Bulk insert vouchers & entries
    const INSERT_BATCH = 250;
    for (let i = 0; i < expectedVouchers.length; i += INSERT_BATCH) {
      const slice = expectedVouchers.slice(i, i + INSERT_BATCH);
      await prisma.$transaction(async (tx) => {
        for (const v of slice) {
          const created = await tx.voucher.create({
            data: {
              id: v.id,
              companyId: company.id,
              masterId: v.masterId,
              alterId: 1,
              voucherNumber: `VCH-${v.masterId}`,
              voucherType: "Sales",
              date: v.date,
              amount: 500.0,
            },
          });
          await tx.voucherEntry.create({
            data: {
              voucherId: created.id,
              ledgerId: ledger.id,
              amount: 500.0,
              type: "credit",
            },
          });
        }
      });
    }
    console.log(`  ✔ Seeded ${TOTAL_VOUCHERS} vouchers into PostgreSQL.\n`);

    // ── Execute Streaming Export ───────────────────────────────────────────────
    console.log("[Test 2] Executing streamVouchersCsv across 500-record batch boundaries...");
    const exportedIds: string[] = [];
    let chunkCount = 0;

    const splitsWritten = await streamVouchersCsv(
      company.id,
      company.name,
      async (chunk: string) => {
        chunkCount++;
        // Parse CSV lines (skip header on first chunk)
        const lines = chunk.split("\r\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          if (line.startsWith("Company_ID,")) continue;
          const cols = line.split(",");
          const voucherId = cols[2]; // Voucher_ID is column 2
          exportedIds.push(voucherId);
        }
      }
    );

    console.log(`  -> Total rows streamed: ${exportedIds.length} (chunks written: ${chunkCount})`);
    assert.equal(splitsWritten, TOTAL_VOUCHERS, `Expected ${TOTAL_VOUCHERS} splits written, got ${splitsWritten}`);
    assert.equal(exportedIds.length, TOTAL_VOUCHERS, `Expected ${TOTAL_VOUCHERS} distinct IDs, got ${exportedIds.length}`);

    // Check for missing records
    const exportedSet = new Set(exportedIds);
    const missing = expectedVouchers.filter((v) => !exportedSet.has(v.id));
    assert.equal(missing.length, 0, `Found ${missing.length} missing vouchers!`);

    // Check for duplicates
    const duplicateIds = exportedIds.filter((id, index) => exportedIds.indexOf(id) !== index);
    assert.equal(duplicateIds.length, 0, `Found ${duplicateIds.length} duplicate vouchers! ${duplicateIds.slice(0, 5).join(", ")}`);

    // Check exact deterministic order
    for (let i = 0; i < TOTAL_VOUCHERS; i++) {
      assert.equal(
        exportedIds[i],
        expectedVouchers[i].id,
        `Ordering mismatch at position ${i}: expected ${expectedVouchers[i].id}, got ${exportedIds[i]}`
      );
    }
    console.log("  ✔ Test 2 Passed: 1,500 non-sequential vouchers exported with 0 missing, 0 duplicates, and 100% deterministic order.\n");

    // ── Test 3: Concurrent Insertions During Export (Point-in-Time Consistency) ───
    console.log("[Test 3] Testing concurrent insertions during multi-page export...");
    const concurrentExportIds: string[] = [];
    let pageCount = 0;
    let lateInsertedVoucherId: string | null = null;

    await streamVouchersCsv(
      company.id,
      company.name,
      async (chunk: string) => {
        const lines = chunk.split("\r\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          if (line.startsWith("Company_ID,")) continue;
          concurrentExportIds.push(line.split(",")[2]);
        }
        pageCount++;

        // Simulate concurrent insertion while streaming Page 1
        if (pageCount === 1 && !lateInsertedVoucherId) {
          const inserted = await prisma.voucher.create({
            data: {
              id: `late_insert_${Date.now()}`,
              companyId: company.id,
              masterId: 999999,
              alterId: 1,
              voucherNumber: "VCH-LATE-001",
              voucherType: "Sales",
              date: new Date("2026-01-02T00:00:00.000Z"), // Date belongs to Page 1!
              amount: 100.0,
              voucherEntries: {
                create: [
                  { ledgerId: ledger.id, amount: 100.0, type: "credit" },
                ],
              },
            },
          });
          lateInsertedVoucherId = inserted.id;
          console.log(`  -> [Adversarial Trigger] Inserted concurrent voucher "${inserted.id}" with date in Page 1 window.`);
        }
      }
    );

    assert.ok(lateInsertedVoucherId !== null);
    assert.equal(
      concurrentExportIds.includes(lateInsertedVoucherId),
      false,
      "Point-in-time failure: Late inserted voucher leaked into ongoing export!"
    );
    assert.equal(
      concurrentExportIds.length,
      TOTAL_VOUCHERS,
      `Expected ${TOTAL_VOUCHERS} snapshot records, got ${concurrentExportIds.length}`
    );
    console.log("  ✔ Test 3 Passed: Concurrent insertion safely excluded by updatedAt boundary.\n");

    // Clean up late inserted voucher so baseline count is exactly TOTAL_VOUCHERS
    if (lateInsertedVoucherId) {
      await prisma.voucherEntry.deleteMany({ where: { voucherId: lateInsertedVoucherId } });
      await prisma.voucher.delete({ where: { id: lateInsertedVoucherId } });
    }

    // ── Test 4: Concurrent Updates During Export ─────────────────────────────────
    console.log("[Test 4] Testing concurrent updates to upcoming page records...");
    const updateExportIds: string[] = [];
    let updatePageCount = 0;
    // Pick a voucher in Page 3 (index 1200)
    const targetVoucher = expectedVouchers[1200];

    await streamVouchersCsv(
      company.id,
      company.name,
      async (chunk: string) => {
        const lines = chunk.split("\r\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          if (line.startsWith("Company_ID,")) continue;
          updateExportIds.push(line.split(",")[2]);
        }
        updatePageCount++;

        // While streaming mid-stream (after Batch 1 has emitted 500 records), mutate a record in Batch 3
        if (updateExportIds.length === 500) {
          // Sleep 10ms to ensure updatedAt is strictly greater than exportStartTime
          await new Promise((r) => setTimeout(r, 20));
          await prisma.voucher.update({
            where: { id: targetVoucher.id },
            data: {
              amount: 9999.0,
              updatedAt: new Date(), // updated strictly after export started
            },
          });
          console.log(`  -> [Adversarial Trigger] Mutated voucher "${targetVoucher.id}" (Page 3) mid-stream after Batch 1.`);
        }
      }
    );

    // Because targetVoucher was modified after exportStartTime, point-in-time consistency excludes it
    console.log("Index of targetVoucher in updateExportIds:", updateExportIds.indexOf(targetVoucher.id));
    assert.equal(
      updateExportIds.includes(targetVoucher.id),
      false,
      "Mutated voucher should be excluded from historical point-in-time snapshot"
    );
    assert.equal(
      updateExportIds.length,
      TOTAL_VOUCHERS - 1,
      `Expected exactly ${TOTAL_VOUCHERS - 1} records, got ${updateExportIds.length}`
    );
    console.log("  ✔ Test 4 Passed: Concurrent update correctly handled by point-in-time consistency.\n");

    console.log("===================================================================");
    console.log("   ALL 4 PAGINATION & CONCURRENCY TESTS PASSED 100%!               ");
    console.log("===================================================================\n");
  } finally {
    console.log("[Cleanup] Removing test records...");
    await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId: company.id } } }).catch(() => {});
    await prisma.voucher.deleteMany({ where: { companyId: company.id } }).catch(() => {});
    await prisma.ledger.deleteMany({ where: { companyId: company.id } }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: company.id } }).catch(() => {});
    await prisma.$disconnect();
    await pool.end();
    console.log("[Cleanup] Done.");
  }
}

runPaginationVerificationTests().catch((err) => {
  console.error("FATAL PAGINATION TEST FAILURE:", err);
  process.exit(1);
});
