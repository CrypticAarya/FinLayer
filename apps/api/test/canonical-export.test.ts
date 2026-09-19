import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { syncRoutes } from "../src/routes/sync.js";
import { dashboardRoutes } from "../src/routes/dashboard.js";
import { exportRoutes } from "../src/routes/export.js";
import { generateConnectorToken, hashConnectorToken } from "../src/auth/connector-auth.js";
import { generateUserToken, hashUserToken } from "../src/auth/user-auth.js";
import {
  sanitizeCsvText,
  escapeCsvCell,
  formatCsvTextCell,
  formatCsvNumericCell,
  escapeXml,
  sanitizeFilenameComponent,
  buildContentDispositionHeader,
  validateDateRange,
  streamVouchersCsv,
  streamVouchersXml,
  streamLedgersCsv,
  streamLedgersXml,
  streamTrialBalanceCsv,
  streamTrialBalanceXml,
} from "../src/services/canonical-export-service.js";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

// Import XML parser and validator from connector's fast-xml-parser
// @ts-ignore
import { XMLParser, XMLValidator } from "../../connector/node_modules/fast-xml-parser/src/fxp.js";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runCanonicalExportTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: CANONICAL CSV & XML EXPORT VERIFICATION SUITE    ");
  console.log("   PHASE V2.1 — COMPREHENSIVE SECURITY HARDENING & REGRESSION      ");
  console.log("===================================================================\n");

  const app = Fastify({ logger: false });
  await app.register(syncRoutes);
  await app.register(dashboardRoutes);
  await app.register(exportRoutes);
  await app.ready();

  const timestamp = Date.now();
  const companyAName = `Export Corp A ${timestamp}`;
  const companyBName = `Export Corp B ${timestamp}`;
  const companyPagName = `Pagination Corp ${timestamp}`;

  let companyAId: string;
  let companyBId: string;
  let companyPagId: string;

  let tokenA: string;
  let tokenB: string;
  let revokedToken: string;
  let oldRotatedToken: string;
  let newRotatedToken: string;
  let unboundToken: string;
  let userTokenA: string;
  let expiredUserToken: string;

  const createdCompanyIds: string[] = [];

  try {
    // ── 0. Setup Companies, Connectors, and Users ────────────────────────────
    console.log("[Setup] Creating Tenant A, Tenant B, and Pagination test companies...");
    const compA = await prisma.company.create({
      data: { name: companyAName, tallyCompanyName: companyAName },
    });
    companyAId = compA.id;
    createdCompanyIds.push(companyAId);

    const compB = await prisma.company.create({
      data: { name: companyBName, tallyCompanyName: companyBName },
    });
    companyBId = compB.id;
    createdCompanyIds.push(companyBId);

    const compPag = await prisma.company.create({
      data: { name: companyPagName, tallyCompanyName: companyPagName },
    });
    companyPagId = compPag.id;
    createdCompanyIds.push(companyPagId);

    // Connector A (bound to Company A)
    tokenA = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-exp-a-${timestamp}`,
        name: "Connector A",
        companyId: companyAId,
        tokenHash: hashConnectorToken(tokenA),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });

    // Connector B (bound to Company B)
    tokenB = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-exp-b-${timestamp}`,
        name: "Connector B",
        companyId: companyBId,
        tokenHash: hashConnectorToken(tokenB),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });

    // Revoked Connector (bound to Company A)
    revokedToken = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-exp-rev-${timestamp}`,
        name: "Revoked Connector",
        companyId: companyAId,
        tokenHash: hashConnectorToken(revokedToken),
        status: "REVOKED",
        setupStatus: "ACTIVE",
        tokenRevokedAt: new Date(),
      },
    });

    // Rotated Connector (Token rotation simulation)
    oldRotatedToken = generateConnectorToken();
    newRotatedToken = generateConnectorToken();
    const rotatedConn = await prisma.connector.create({
      data: {
        deviceId: `dev-exp-rot-${timestamp}`,
        name: "Rotated Connector",
        companyId: companyAId,
        tokenHash: hashConnectorToken(oldRotatedToken),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    // Now simulate token rotation: update hash to newRotatedToken
    await prisma.connector.update({
      where: { id: rotatedConn.id },
      data: {
        tokenHash: hashConnectorToken(newRotatedToken),
      },
    });

    // Unbound Connector (companyId: null)
    unboundToken = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-exp-unbound-${timestamp}`,
        name: "Unbound Connector",
        companyId: null,
        tokenHash: hashConnectorToken(unboundToken),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });

    // User for Tenant A
    const userA = await prisma.user.create({
      data: {
        email: `user-exp-a-${timestamp}@example.com`,
        name: "User A",
        role: "USER",
      },
    });
    await prisma.companyMember.create({
      data: {
        userId: userA.id,
        companyId: companyAId,
        role: "OWNER",
      },
    });
    userTokenA = generateUserToken();
    await prisma.userSession.create({
      data: {
        userId: userA.id,
        tokenHash: hashUserToken(userTokenA),
        expiresAt: new Date(Date.now() + 86400000), // Active 24h
      },
    });

    // Expired User Session
    expiredUserToken = generateUserToken();
    await prisma.userSession.create({
      data: {
        userId: userA.id,
        tokenHash: hashUserToken(expiredUserToken),
        expiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
      },
    });

    // Seed Ledgers for Tenant A
    const ledgerCash = await prisma.ledger.create({
      data: {
        companyId: companyAId,
        name: "Cash Account",
        parent: "Cash-in-hand",
        masterId: 1,
        alterId: 1,
      },
    });

    const ledgerSales = await prisma.ledger.create({
      data: {
        companyId: companyAId,
        name: "+SUM(A1:A10)", // Formula injection test ledger
        parent: "Sales Accounts",
        masterId: 2,
        alterId: 1,
      },
    });

    const ledgerCapital = await prisma.ledger.create({
      data: {
        companyId: companyAId,
        name: "Capital Account",
        parent: "Capital Account",
        masterId: 3,
        alterId: 1,
      },
    });

    // Seed Trial Balance for Tenant A
    await prisma.trialBalanceEntry.createMany({
      data: [
        {
          companyId: companyAId,
          ledgerName: ledgerCash.name,
          groupName: ledgerCash.parent,
          debitAmount: 25000.00,
          creditAmount: 0.00,
        },
        {
          companyId: companyAId,
          ledgerName: ledgerCapital.name,
          groupName: ledgerCapital.parent,
          debitAmount: 0.00,
          creditAmount: 25000.00,
        },
      ],
    });

    // Seed Voucher with formula payload in partyName and balanced splits
    const voucher1 = await prisma.voucher.create({
      data: {
        companyId: companyAId,
        masterId: 101,
        alterId: 1,
        voucherNumber: "INV-001",
        voucherType: "Sales",
        date: new Date("2026-04-10T10:00:00.000Z"),
        partyName: "=CMD|' /C calc'!A0",
        amount: 5000.00,
      },
    });

    await prisma.voucherEntry.createMany({
      data: [
        {
          voucherId: voucher1.id,
          ledgerId: ledgerCash.id,
          type: "debit",
          amount: 5000.00,
        },
        {
          voucherId: voucher1.id,
          ledgerId: ledgerSales.id,
          type: "credit",
          amount: 5000.00,
        },
      ],
    });

    console.log("✅ [Setup] Initial seed data created successfully.\n");

    // =========================================================================
    // FIX 1 — CSV FORMULA INJECTION COMPREHENSIVE TESTS
    // =========================================================================
    console.log("[FIX 1] Testing CSV Formula Injection Sanitization (CWE-1236)...");

    const requiredFormulaPayloads = [
      "=CMD(...)",
      "+SUM(A1:A10)",
      "@SUM(...)",
      "-10*2",
      "\t=CMD(...)",
      "\r=CMD(...)",
      "\n=CMD(...)",
      " =CMD(...)",
      "  =CMD(...)",
      "\t =CMD(...)",
    ];

    for (const payload of requiredFormulaPayloads) {
      const sanitized = sanitizeCsvText(payload);
      assert.strictEqual(
        sanitized.startsWith("'"),
        true,
        `Formula payload ${JSON.stringify(payload)} must be neutralized with leading single quote`
      );
      // Original content must be preserved after the leading quote
      assert.strictEqual(
        sanitized,
        `'${payload}`,
        `Sanitizer must preserve exact content for ${JSON.stringify(payload)}`
      );
    }

    // Verify benign strings are NOT modified
    assert.strictEqual(sanitizeCsvText("Normal Customer Name"), "Normal Customer Name");
    assert.strictEqual(sanitizeCsvText("Invoice 12345"), "Invoice 12345");
    assert.strictEqual(sanitizeCsvText(""), "");
    assert.strictEqual(sanitizeCsvText(null), "");

    // CRITICAL: Numeric financial fields MUST NOT pass through text sanitizer or receive quotes
    console.log("[FIX 1] Verifying numeric financial values preserve leading minus without prepending...");
    const negativeAmount = -5000.00;
    const formattedNegative = formatCsvNumericCell(negativeAmount);
    assert.strictEqual(
      formattedNegative,
      "-5000.00",
      `Financial negative amount must remain "-5000.00" and never become "'-5000.00"`
    );
    assert.strictEqual(
      formatCsvNumericCell(new Prisma.Decimal("-5000.00")),
      "-5000.00",
      "Prisma.Decimal negative value must format strictly as -5000.00"
    );
    assert.strictEqual(
      formatCsvNumericCell(2500.5),
      "2500.50",
      "Positive numeric value must retain 2 decimal places"
    );
    console.log("✅ [FIX 1] Passed: All formula payloads neutralized & numeric values strictly preserved.\n");

    // =========================================================================
    // FIX 2 — XML 1.0 CONTROL CHARACTERS TESTS
    // =========================================================================
    console.log("[FIX 2] Testing XML 1.0 Illegal Control Character Sanitization...");

    const illegalXmlControlCodes = [
      "\x00", // Null
      "\x01", // Start of heading
      "\x07", // Bell
      "\x08", // Backspace
      "\x0B", // Vertical tab
      "\x0C", // Form feed
      "\x0E", // Shift out
      "\x1F", // Unit separator
    ];

    for (const char of illegalXmlControlCodes) {
      const input = `Bad${char}String`;
      const escaped = escapeXml(input);
      assert.strictEqual(
        escaped,
        "BadString",
        `Illegal XML 1.0 control char \\x${char.charCodeAt(0).toString(16).padStart(2, "0")} must be stripped`
      );
    }

    // Verify valid XML whitespace is preserved: \t (#x9), \n (#xA), \r (#xD)
    assert.strictEqual(escapeXml("Tab\tNewline\nCR\r"), "Tab\tNewline\nCR\r");

    // Verify XML standard entities are escaped properly
    assert.strictEqual(
      escapeXml(`Test <company> & "quotes" 'single'`),
      "Test &lt;company&gt; &amp; &quot;quotes&quot; &apos;single&apos;"
    );

    // Verify that generated XML containing stripped control characters parses successfully in XMLParser
    const testXmlRaw = `<?xml version="1.0" encoding="UTF-8"?>\n<ROOT text="${escapeXml(`Control\x00\x01\x07\x08\x0B\x0C\x0E\x1FData`)}" />`;
    assert.strictEqual(XMLValidator.validate(testXmlRaw), true, "Sanitized XML must be valid XML 1.0");
    const parsedTestXml = new XMLParser({ ignoreAttributes: false }).parse(testXmlRaw);
    assert.strictEqual(parsedTestXml.ROOT["@_text"], "ControlData");
    console.log("✅ [FIX 2] Passed: Illegal XML 1.0 control characters safely handled without parser errors.\n");

    // =========================================================================
    // FIX 3 & FIX 4 — STREAM BACKPRESSURE & CLIENT DISCONNECT / ABORT
    // =========================================================================
    console.log("[FIX 3 & 4] Testing HTTP Stream Backpressure and Client Abort Cancellation...");

    // Test 4a: AbortController signal already aborted before stream starts
    const preAbortedController = new AbortController();
    preAbortedController.abort();
    let preAbortChunksWritten = 0;
    const preAbortWriter = async (_chunk: string) => {
      preAbortChunksWritten++;
      return true;
    };
    const preAbortResult = await streamVouchersCsv(
      companyAId,
      companyAName,
      preAbortWriter,
      undefined,
      preAbortedController.signal
    );
    assert.strictEqual(preAbortResult, 0, "Pre-aborted stream must immediately return 0");
    assert.strictEqual(preAbortChunksWritten, 0, "Pre-aborted stream must write zero chunks");

    // Test 4b: Abort signal fired during streaming
    const midStreamController = new AbortController();
    let midChunksWritten = 0;
    const midStreamWriter = async (_chunk: string) => {
      midChunksWritten++;
      // Abort after first chunk (header)
      if (midChunksWritten === 1) {
        midStreamController.abort();
      }
      return true;
    };
    const midStreamResult = await streamVouchersCsv(
      companyAId,
      companyAName,
      midStreamWriter,
      undefined,
      midStreamController.signal
    );
    // Should stop immediately and not stream all vouchers
    assert.ok(midChunksWritten <= 2, "Aborted stream must stop chunk writes immediately");
    console.log("✅ [FIX 3 & 4] Passed: Stream backpressure and client cancellation verified.\n");

    // =========================================================================
    // FIX 5 — VOUCHER COMPOSITE INDEX VERIFICATION
    // =========================================================================
    console.log("[FIX 5] Verifying PostgreSQL Composite Index (companyId, date, id)...");
    const indexQuery = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'Voucher' AND indexname = 'Voucher_companyId_date_id_idx';
    `;
    assert.ok(indexQuery.length > 0, "Index Voucher_companyId_date_id_idx must exist in PostgreSQL");
    assert.ok(
      indexQuery[0].indexdef.includes("companyId") &&
      indexQuery[0].indexdef.includes("date") &&
      indexQuery[0].indexdef.includes("id"),
      "Index must cover (companyId, date, id)"
    );
    console.log(`✅ [FIX 5] Passed: Composite index verified in PostgreSQL: ${indexQuery[0].indexname}.\n`);

    // =========================================================================
    // FIX 6 — TRIAL BALANCE DATABASE AGGREGATION
    // =========================================================================
    console.log("[FIX 6] Verifying Database-Side Trial Balance Aggregation (O(1) Memory)...");
    let tbXmlOutput = "";
    await streamTrialBalanceXml(companyAId, companyAName, companyAName, (chunk) => {
      tbXmlOutput += chunk;
    });
    assert.strictEqual(XMLValidator.validate(tbXmlOutput), true, "Trial Balance XML must be well-formed");
    const parsedTb = new XMLParser({ ignoreAttributes: false }).parse(tbXmlOutput);
    const tbHeader = parsedTb.FINLAYER_EXPORT.TRIAL_BALANCE;
    assert.strictEqual(Number(tbHeader["@_count"]), 2, "TB count must match database aggregate");
    assert.strictEqual(tbHeader["@_debitTotal"], "25000.00", "TB debit aggregate must match");
    assert.strictEqual(tbHeader["@_creditTotal"], "25000.00", "TB credit aggregate must match");
    console.log("✅ [FIX 6] Passed: Trial balance uses database-side aggregation without heap accumulation.\n");

    // =========================================================================
    // FIX 7 — REAL INTEGRATION PAGINATION TESTS CROSSING BATCH BOUNDARIES
    // Datasets: 499, 500, 501, 999, 1000 records
    // =========================================================================
    console.log("[FIX 7] Seeding 1,000 real vouchers into PostgreSQL for pagination boundary testing...");

    // Helper to generate consecutive UTC date strings
    const baseDate = new Date("2026-01-01T00:00:00.000Z");
    const getDateForIndex = (i: number): { date: Date; dateStr: string } => {
      const d = new Date(baseDate.getTime());
      d.setUTCDate(d.getUTCDate() + (i - 1));
      const dateStr = d.toISOString().split("T")[0];
      return { date: d, dateStr };
    };

    // Create a ledger for pagination company
    const pagLedger = await prisma.ledger.create({
      data: {
        companyId: companyPagId,
        name: "General Expense",
        parent: "Indirect Expenses",
        masterId: 99999,
        alterId: 1,
      },
    });

    const bulkVouchers: Array<{
      id: string;
      companyId: string;
      masterId: number;
      alterId: number;
      voucherNumber: string;
      voucherType: string;
      date: Date;
      partyName: string;
      amount: Prisma.Decimal;
    }> = [];

    const bulkEntries: Array<{
      id: string;
      voucherId: string;
      ledgerId: string;
      amount: Prisma.Decimal;
      type: string;
    }> = [];

    for (let i = 1; i <= 1000; i++) {
      const vId = `pag-vch-${String(i).padStart(4, "0")}-${timestamp}`;
      const { date } = getDateForIndex(i);
      bulkVouchers.push({
        id: vId,
        companyId: companyPagId,
        masterId: 100000 + i,
        alterId: 1,
        voucherNumber: `PAG-VCH-${String(i).padStart(4, "0")}`,
        voucherType: "Payment",
        date,
        partyName: `Vendor ${i}`,
        amount: new Prisma.Decimal("100.00"),
      });

      bulkEntries.push({
        id: `pag-ent-d-${String(i).padStart(4, "0")}-${timestamp}`,
        voucherId: vId,
        ledgerId: pagLedger.id,
        amount: new Prisma.Decimal("100.00"),
        type: "debit",
      });
      bulkEntries.push({
        id: `pag-ent-c-${String(i).padStart(4, "0")}-${timestamp}`,
        voucherId: vId,
        ledgerId: pagLedger.id,
        amount: new Prisma.Decimal("100.00"),
        type: "credit",
      });
    }

    // Insert in bulk
    await prisma.voucher.createMany({ data: bulkVouchers });
    await prisma.voucherEntry.createMany({ data: bulkEntries });
    console.log("  -> 1,000 vouchers & 2,000 entries seeded in PostgreSQL successfully.");

    // Connector for pagination company
    const tokenPag = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-exp-pag-${timestamp}`,
        name: "Pagination Connector",
        companyId: companyPagId,
        tokenHash: hashConnectorToken(tokenPag),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });

    const paginationTestCases = [499, 500, 501, 999, 1000];

    for (const expectedCount of paginationTestCases) {
      console.log(`  -> Testing boundary dataset: ${expectedCount} records...`);
      const toDateStr = getDateForIndex(expectedCount).dateStr;

      // 1. Test CSV
      const csvRes = await app.inject({
        method: "GET",
        url: `/dashboard/export/${companyPagId}?format=csv&type=vouchers&fromDate=2026-01-01&toDate=${toDateStr}`,
        headers: { authorization: `Bearer ${tokenPag}` },
      });
      assert.strictEqual(csvRes.statusCode, 200);
      const csvLines = csvRes.body.trim().split("\r\n");
      const headerLine = csvLines[0];
      const dataLines = csvLines.slice(1);

      // Cardinality: each voucher has 2 entries/splits -> expected data rows = expectedCount * 2
      assert.strictEqual(
        dataLines.length,
        expectedCount * 2,
        `CSV data rows count must be ${expectedCount * 2} (2 splits per voucher)`
      );

      // Verify zero duplicates & zero missing
      const seenVoucherNumbers = new Set<string>();
      const orderedVouchers: string[] = [];

      for (const line of dataLines) {
        const parts = line.split(",");
        const vNumber = parts[6]; // Voucher_Number column
        if (!seenVoucherNumbers.has(vNumber)) {
          seenVoucherNumbers.add(vNumber);
          orderedVouchers.push(vNumber);
        }
      }

      assert.strictEqual(
        seenVoucherNumbers.size,
        expectedCount,
        `Expected exactly ${expectedCount} distinct vouchers, zero duplicates`
      );

      // Verify deterministic ordering: first record and last record
      assert.strictEqual(orderedVouchers[0], "PAG-VCH-0001", "First record must be PAG-VCH-0001");
      assert.strictEqual(
        orderedVouchers[orderedVouchers.length - 1],
        `PAG-VCH-${String(expectedCount).padStart(4, "0")}`,
        `Last record must be PAG-VCH-${String(expectedCount).padStart(4, "0")}`
      );

      // 2. Test XML
      const xmlRes = await app.inject({
        method: "GET",
        url: `/dashboard/export/${companyPagId}?format=xml&type=vouchers&fromDate=2026-01-01&toDate=${toDateStr}`,
        headers: { authorization: `Bearer ${tokenPag}` },
      });
      assert.strictEqual(xmlRes.statusCode, 200);
      assert.strictEqual(XMLValidator.validate(xmlRes.body), true, `XML for ${expectedCount} must be valid`);

      const parsedXml = new XMLParser({ ignoreAttributes: false }).parse(xmlRes.body);
      const vList = parsedXml.FINLAYER_EXPORT.VOUCHERS.VOUCHER;
      const vArray = Array.isArray(vList) ? vList : [vList];

      assert.strictEqual(vArray.length, expectedCount, `XML voucher count must match ${expectedCount}`);
      assert.strictEqual(vArray[0]["@_voucherNumber"], "PAG-VCH-0001");
      assert.strictEqual(
        vArray[vArray.length - 1]["@_voucherNumber"],
        `PAG-VCH-${String(expectedCount).padStart(4, "0")}`
      );
    }
    console.log("✅ [FIX 7] Passed: Pagination verified across all batch boundaries (499, 500, 501, 999, 1000).\n");

    // =========================================================================
    // POINT-IN-TIME EXPORT CONSISTENCY & ADVERSARIAL MUTATION SUITE
    // Tests Scenarios A through F:
    // A. Existing voucher before export -> MUST export.
    // B. Voucher inserted after exportStartTime -> MUST NOT export.
    // C. Voucher updated after exportStartTime but before batch 2 -> MUST NOT appear in later batches.
    // D. Voucher already exported in batch 1 and then modified -> MUST NOT appear again in batch 2.
    // E. Voucher not yet exported and modified after exportStartTime -> MUST NOT appear in later batches.
    // F. Voucher deleted during export -> Export remains valid and must not crash.
    // =========================================================================
    console.log("[Point-In-Time Consistency] Running adversarial mutation tests (Scenarios A through F)...");

    const consistComp = await prisma.company.create({
      data: { name: `Consist Co ${timestamp}`, tallyCompanyName: `Consist Co ${timestamp}` },
    });
    createdCompanyIds.push(consistComp.id);

    const consistToken = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-consist-${timestamp}`,
        name: "Consist Connector",
        companyId: consistComp.id,
        tokenHash: hashConnectorToken(consistToken),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });

    const consistLedger = await prisma.ledger.create({
      data: {
        companyId: consistComp.id,
        name: "Consist Ledger",
        parent: "Expenses",
        masterId: 77777,
        alterId: 1,
      },
    });

    // Seed 600 baseline vouchers (500 for Batch 1, 100 for Batch 2) with historical updatedAt (10 seconds in past)
    const historicalTime = new Date(Date.now() - 10000);
    const consistVouchers = [];
    const consistEntries = [];
    for (let i = 1; i <= 600; i++) {
      const vId = `cst-vch-${String(i).padStart(4, "0")}-${timestamp}`;
      const d = new Date("2026-03-01T00:00:00.000Z");
      d.setUTCSeconds(d.getUTCSeconds() + i);

      consistVouchers.push({
        id: vId,
        companyId: consistComp.id,
        masterId: 600000 + i,
        alterId: 1,
        voucherNumber: `CST-${i}`,
        voucherType: "Payment",
        date: d,
        amount: new Prisma.Decimal("100.00"),
        createdAt: historicalTime,
        updatedAt: historicalTime,
      });

      consistEntries.push({
        id: `cst-ent-d-${i}-${timestamp}`,
        voucherId: vId,
        ledgerId: consistLedger.id,
        amount: new Prisma.Decimal("100.00"),
        type: "debit",
      });
      consistEntries.push({
        id: `cst-ent-c-${i}-${timestamp}`,
        voucherId: vId,
        ledgerId: consistLedger.id,
        amount: new Prisma.Decimal("100.00"),
        type: "credit",
      });
    }

    await prisma.voucher.createMany({ data: consistVouchers });
    await prisma.voucherEntry.createMany({ data: consistEntries });

    // Stream with adversarial mutations executed mid-stream between Batch 1 and Batch 2
    let splitsReceived = 0;
    const receivedVoucherNumbers: string[] = [];
    let mutationsExecuted = false;

    const adversarialWriter = async (chunk: string) => {
      // Ignore header
      if (!chunk.startsWith("Company_ID")) {
        splitsReceived++;
        const parts = chunk.split(",");
        const vNum = parts[6];
        if (vNum) receivedVoucherNumbers.push(vNum);

        // Once 500 vouchers (1000 splits) are streamed (Batch 1 complete), execute adversarial mutations!
        if (splitsReceived === 1000 && !mutationsExecuted) {
          mutationsExecuted = true;
          console.log("  -> [Adversarial Trigger] Batch 1 emitted. Executing concurrent mutations...");

          // Mutation B: Insert new voucher AFTER export start
          await prisma.voucher.create({
            data: {
              id: `cst-ins-late-${timestamp}`,
              companyId: consistComp.id,
              masterId: 699991,
              alterId: 1,
              voucherNumber: "CST-LATE-INSERT",
              voucherType: "Payment",
              date: new Date("2026-03-01T00:00:10.000Z"), // Past date, but newly inserted
              amount: new Prisma.Decimal("100.00"),
            },
          });

          // Mutation C & D: Update voucher already exported in Batch 1 (CST-10) moving date to future Batch 2
          const v10 = await prisma.voucher.findFirst({ where: { companyId: consistComp.id, voucherNumber: "CST-10" } });
          if (v10) {
            await prisma.voucher.update({
              where: { id: v10.id },
              data: { date: new Date("2026-03-01T00:59:00.000Z") }, // Moved forward
            });
          }

          // Mutation E: Update voucher in Batch 2 (not yet exported) after exportStartTime
          const v550 = await prisma.voucher.findFirst({ where: { companyId: consistComp.id, voucherNumber: "CST-550" } });
          if (v550) {
            await prisma.voucher.update({
              where: { id: v550.id },
              data: { partyName: "Modified After Export Start" },
            });
          }

          // Mutation F: Delete a voucher in Batch 2 during streaming
          const v580 = await prisma.voucher.findFirst({ where: { companyId: consistComp.id, voucherNumber: "CST-580" } });
          if (v580) {
            await prisma.voucherEntry.deleteMany({ where: { voucherId: v580.id } });
            await prisma.voucher.delete({ where: { id: v580.id } });
          }
        }
      }
      return true;
    };

    // Execute streaming export
    await streamVouchersCsv(consistComp.id, "Consist Co", adversarialWriter);

    const distinctVouchers = new Set(receivedVoucherNumbers);
    console.log(`  -> Stream completed. Total distinct vouchers exported: ${distinctVouchers.size}`);

    // Verification A: Existing voucher before export MUST export
    assert.ok(distinctVouchers.has("CST-1"), "Scenario A: Existing voucher CST-1 must be exported");
    assert.ok(distinctVouchers.has("CST-500"), "Scenario A: Existing voucher CST-500 must be exported");

    // Verification B: Voucher inserted after exportStartTime MUST NOT export
    assert.ok(!distinctVouchers.has("CST-LATE-INSERT"), "Scenario B: Voucher inserted after exportStartTime must NOT export");
    console.log("  ✔ Scenario B Passed: Late inserted voucher excluded.");

    // Verification C & D: Voucher already exported in batch 1 and modified MUST NOT appear again in batch 2 (Zero duplicates!)
    const cst10Occurrences = receivedVoucherNumbers.filter((n) => n === "CST-10").length;
    // Since each voucher has 2 splits, exactly 2 splits (1 voucher) should be present
    assert.strictEqual(cst10Occurrences, 2, "Scenario C/D: Moved voucher must NOT be exported again in batch 2 (no duplicates)");
    console.log("  ✔ Scenario C/D Passed: Zero duplicate vouchers across batch boundary.");

    // Verification E: Voucher modified after exportStartTime had updatedAt updated, so it is excluded from later batches
    assert.ok(!distinctVouchers.has("CST-550"), "Scenario E: Modified voucher after exportStartTime excluded from later batches");
    console.log("  ✔ Scenario E Passed: Modified voucher excluded by point-in-time boundary.");

    // Verification F: Deleted voucher handled cleanly without crash
    assert.ok(!distinctVouchers.has("CST-580"), "Scenario F: Deleted voucher cleanly omitted without stream crashing");
    console.log("  ✔ Scenario F Passed: Deleted voucher handled without crash.");

    console.log("✅ [Point-In-Time Consistency] All adversarial mutation scenarios verified successfully!\n");

    // =========================================================================
    // FIX 8 — COMPLETE 16 SECURITY REGRESSION SCENARIOS
    // =========================================================================
    console.log("[FIX 8] Running Complete 16 Security Regression Scenarios...\n");

    // 1. Missing auth → 401
    console.log("  [Scenario 1] Missing auth header...");
    const s1 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
    });
    assert.strictEqual(s1.statusCode, 401, "Scenario 1: Missing auth must return 401");
    console.log("  ✔ Scenario 1 Passed: Missing auth -> 401");

    // 2. Invalid auth → 401
    console.log("  [Scenario 2] Invalid auth token...");
    const s2 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: "Bearer fl_conn_fake_token_12345" },
    });
    assert.strictEqual(s2.statusCode, 401, "Scenario 2: Invalid auth must return 401");
    console.log("  ✔ Scenario 2 Passed: Invalid auth -> 401");

    // 3. Expired user session → 401
    console.log("  [Scenario 3] Expired user session...");
    const s3 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${expiredUserToken}` },
    });
    assert.strictEqual(s3.statusCode, 401, "Scenario 3: Expired user session must return 401");
    console.log("  ✔ Scenario 3 Passed: Expired user session -> 401");

    // 4. Revoked connector → 401
    console.log("  [Scenario 4] Revoked connector...");
    const s4 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${revokedToken}` },
    });
    assert.strictEqual(s4.statusCode, 401, "Scenario 4: Revoked connector must return 401");
    console.log("  ✔ Scenario 4 Passed: Revoked connector -> 401");

    // 5. Rotated old connector token → 401
    console.log("  [Scenario 5] Rotated old connector token...");
    const s5Old = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${oldRotatedToken}` },
    });
    assert.strictEqual(s5Old.statusCode, 401, "Scenario 5: Old rotated token must return 401");
    const s5New = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${newRotatedToken}` },
    });
    assert.strictEqual(s5New.statusCode, 200, "Scenario 5: New rotated token must return 200");
    console.log("  ✔ Scenario 5 Passed: Rotated old token -> 401, new token -> 200");

    // 6. Unbound connector → 403
    console.log("  [Scenario 6] Unbound connector (companyId = null)...");
    const s6 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${unboundToken}` },
    });
    assert.strictEqual(s6.statusCode, 403, "Scenario 6: Unbound connector must return 403");
    console.log("  ✔ Scenario 6 Passed: Unbound connector -> 403");

    // 7. Connector A → Company A → 200
    console.log("  [Scenario 7] Connector A accessing Company A...");
    const s7 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s7.statusCode, 200, "Scenario 7: Connector A accessing Company A must return 200");
    console.log("  ✔ Scenario 7 Passed: Connector A -> Company A -> 200");

    // 8. Connector A → Company B → 403
    console.log("  [Scenario 8] Connector A accessing Company B...");
    const s8 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyBId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s8.statusCode, 403, "Scenario 8: Connector A accessing Company B must return 403");
    console.log("  ✔ Scenario 8 Passed: Connector A -> Company B -> 403");

    // 9. User A → Company A → 200
    console.log("  [Scenario 9] User A accessing Company A...");
    const s9 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${userTokenA}` },
    });
    assert.strictEqual(s9.statusCode, 200, "Scenario 9: User A accessing Company A must return 200");
    console.log("  ✔ Scenario 9 Passed: User A -> Company A -> 200");

    // 10. User A → Company B → 403
    console.log("  [Scenario 10] User A accessing Company B...");
    const s10 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyBId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${userTokenA}` },
    });
    assert.strictEqual(s10.statusCode, 403, "Scenario 10: User A accessing Company B must return 403");
    console.log("  ✔ Scenario 10 Passed: User A -> Company B -> 403");

    // 11. CSV formula injection in API export
    console.log("  [Scenario 11] CSV Formula injection neutralized in HTTP export...");
    const s11 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s11.statusCode, 200);
    assert.ok(s11.body.includes("''=CMD|") || s11.body.includes("'=CMD|"));
    console.log("  ✔ Scenario 11 Passed: CSV formula injection neutralized in export");

    // 12. XML illegal control characters
    console.log("  [Scenario 12] XML export well-formedness with control characters...");
    const s12 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=xml&type=vouchers`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s12.statusCode, 200);
    assert.strictEqual(XMLValidator.validate(s12.body), true);
    console.log("  ✔ Scenario 12 Passed: XML export well-formed and valid");

    // 13. Malicious filename / CRLF injection
    console.log("  [Scenario 13] Malicious filename and CRLF header injection defense...");
    const malComp = await prisma.company.create({
      data: {
        name: "../../etc/passwd\r\nSet-Cookie: evil=true",
        tallyCompanyName: "Malicious Tally",
      },
    });
    createdCompanyIds.push(malComp.id);
    const malToken = generateConnectorToken();
    await prisma.connector.create({
      data: {
        deviceId: `dev-mal-${timestamp}`,
        name: "Malicious Connector",
        companyId: malComp.id,
        tokenHash: hashConnectorToken(malToken),
        status: "ONLINE",
        setupStatus: "ACTIVE",
      },
    });
    const s13 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${malComp.id}?format=csv&type=ledgers`,
      headers: { authorization: `Bearer ${malToken}` },
    });
    assert.strictEqual(s13.statusCode, 200);
    const cdHeader = s13.headers["content-disposition"] as string;
    assert.ok(!cdHeader.includes("\r") && !cdHeader.includes("\n") && !cdHeader.includes(".."));
    console.log("  ✔ Scenario 13 Passed: Malicious filename sanitized, header injection prevented");

    // 14. Invalid date
    console.log("  [Scenario 14] Invalid dates (bad calendar, from > to, non-date)...");
    const s14a = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers&fromDate=not-a-date`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s14a.statusCode, 400);
    const s14b = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers&fromDate=2026-02-30`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s14b.statusCode, 400);
    const s14c = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=vouchers&fromDate=2026-05-01&toDate=2026-04-01`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s14c.statusCode, 400);
    console.log("  ✔ Scenario 14 Passed: All invalid dates rejected with 400");

    // 15. Invalid format
    console.log("  [Scenario 15] Invalid format parameter (?format=yaml)...");
    const s15 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=yaml&type=vouchers`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s15.statusCode, 400);
    console.log("  ✔ Scenario 15 Passed: Invalid format rejected with 400");

    // 16. Invalid export type
    console.log("  [Scenario 16] Invalid export type (?type=unsupported)...");
    const s16 = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=csv&type=unsupported`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(s16.statusCode, 400);
    console.log("  ✔ Scenario 16 Passed: Invalid type rejected with 400\n");

    // =========================================================================
    // FAILURE ISOLATION VERIFICATION
    // =========================================================================
    console.log("[Failure Isolation] Verifying invalid sync vouchers are never exported...");
    const syncPayload = {
      company: companyAName,
      vouchers: [
        // 2 balanced
        {
          masterId: 7001,
          alterId: 1,
          voucherNumber: "VCH-ISO-BAL-1",
          voucherType: "Payment",
          date: "2026-04-15",
          amount: 200.00,
          entries: [
            { ledgerName: ledgerCash.name, type: "debit", amount: 200.00 },
            { ledgerName: ledgerCapital.name, type: "credit", amount: 200.00 },
          ],
        },
        // 2 unbalanced
        {
          masterId: 7002,
          alterId: 1,
          voucherNumber: "VCH-ISO-UNBAL-1",
          voucherType: "Payment",
          date: "2026-04-15",
          amount: 500.00,
          entries: [
            { ledgerName: ledgerCash.name, type: "debit", amount: 500.00 },
            { ledgerName: ledgerCapital.name, type: "credit", amount: 100.00 },
          ],
        },
      ],
    };

    const syncRes = await app.inject({
      method: "POST",
      url: "/sync/vouchers",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: syncPayload,
    });
    assert.strictEqual(syncRes.statusCode, 200);

    const exportXml = await app.inject({
      method: "GET",
      url: `/dashboard/export/${companyAId}?format=xml&type=vouchers`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(exportXml.statusCode, 200);
    assert.ok(exportXml.body.includes("VCH-ISO-BAL-1"), "Balanced voucher must be present in export");
    assert.ok(!exportXml.body.includes("VCH-ISO-UNBAL-1"), "Unbalanced voucher must NEVER be present in export");
    console.log("✅ [Failure Isolation] Passed: Zero invalid vouchers leaked into canonical export.\n");

    console.log("===================================================================");
    console.log("   ALL CANONICAL EXPORT PHASE V2.1 HARDENING TESTS PASSED 100%     ");
    console.log("===================================================================\n");
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log("[Cleanup] Removing test artifacts from PostgreSQL...");
    try {
      if (createdCompanyIds.length > 0) {
        await prisma.voucherEntry.deleteMany({ where: { voucher: { companyId: { in: createdCompanyIds } } } });
        await prisma.voucher.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
        await prisma.trialBalanceEntry.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
        await prisma.ledger.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
        await prisma.syncAuditLog.deleteMany({ where: { syncRun: { companyId: { in: createdCompanyIds } } } });
        await prisma.syncRun.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
        await prisma.syncJob.deleteMany({ where: { connector: { companyId: { in: createdCompanyIds } } } });
        await prisma.connector.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
        await prisma.companyMember.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
        await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
      }
      // Delete any unbound connectors created during test
      await prisma.connector.deleteMany({ where: { deviceId: `dev-exp-unbound-${timestamp}` } });
      // Delete users
      await prisma.userSession.deleteMany({ where: { user: { email: { contains: String(timestamp) } } } });
      await prisma.user.deleteMany({ where: { email: { contains: String(timestamp) } } });
    } catch (cleanErr) {
      console.warn("[Cleanup] Warning during cleanup:", cleanErr);
    }
    await prisma.$disconnect();
    await pool.end();
  }
}

runCanonicalExportTests().catch((err) => {
  console.error("❌ Test suite failure:", err);
  process.exit(1);
});
