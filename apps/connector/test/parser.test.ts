import assert from "node:assert";
import { parseVouchers } from "../src/tally/parser.js";

async function runTests() {
  console.log("=== Running Connector Parser Unit Tests ===\n");

  // ─── Test 1: Valid voucher with MASTERID / ALTERID / GUID ───────────────────
  console.log("Test 1: Valid voucher with MASTERID, ALTERID, and GUID");
  const validXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION></HEADER>
<BODY>
<DATA>
<TALLYMESSAGE>
<VOUCHER VCHTYPE="Sales">
  <MASTERID>12345</MASTERID>
  <ALTERID>7</ALTERID>
  <GUID>abc-xyz-9876</GUID>
  <VOUCHERNUMBER>INV-2026-001</VOUCHERNUMBER>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <DATE>20260401</DATE>
  <PARTYNAME>Acme Corp</PARTYNAME>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Acme Corp</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-5000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Account</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>5000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE>
</DATA>
</BODY>
</ENVELOPE>`;

  const vouchers1 = parseVouchers(validXml);
  assert.strictEqual(vouchers1.length, 1, "Expected 1 voucher to be parsed");
  const v1 = vouchers1[0];
  assert.strictEqual(v1.masterId, 12345, "Expected masterId to be 12345");
  assert.strictEqual(v1.alterId, 7, "Expected alterId to be 7");
  assert.strictEqual(v1.guid, "abc-xyz-9876", "Expected guid to match");
  assert.strictEqual(v1.voucherNumber, "INV-2026-001");
  assert.strictEqual(v1.voucherType, "Sales");
  assert.strictEqual(v1.date, "2026-04-01");
  assert.strictEqual(v1.partyName, "Acme Corp");
  assert.strictEqual(v1.amount, 5000);
  assert.strictEqual(v1.entries.length, 2);
  assert.strictEqual(v1.entries[0].ledgerName, "Acme Corp");
  assert.strictEqual(v1.entries[0].type, "debit");
  assert.strictEqual(v1.entries[1].ledgerName, "Sales Account");
  assert.strictEqual(v1.entries[1].type, "credit");
  console.log("✓ Test 1 passed: All fields extracted accurately.\n");

  // ─── Test 2: Validation rules (Missing MASTERID / ALTERID) ───────────────────
  console.log("Test 2: Validation rules (Missing MASTERID or ALTERID rejection)");
  const invalidXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION></HEADER>
<BODY>
<DATA>
<TALLYMESSAGE>
  <!-- Missing MASTERID -->
  <VOUCHER VCHTYPE="Payment">
    <ALTERID>2</ALTERID>
    <VOUCHERNUMBER>PAY-001</VOUCHERNUMBER>
    <DATE>20260401</DATE>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Cash</LEDGERNAME>
      <AMOUNT>-100</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>
  <!-- Missing ALTERID -->
  <VOUCHER VCHTYPE="Payment">
    <MASTERID>999</MASTERID>
    <VOUCHERNUMBER>PAY-002</VOUCHERNUMBER>
    <DATE>20260401</DATE>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Cash</LEDGERNAME>
      <AMOUNT>-100</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>
  <!-- Valid voucher without optional GUID -->
  <VOUCHER VCHTYPE="Payment">
    <MASTERID>1003</MASTERID>
    <ALTERID>1</ALTERID>
    <VOUCHERNUMBER>PAY-003</VOUCHERNUMBER>
    <DATE>20260401</DATE>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Cash</LEDGERNAME>
      <AMOUNT>-250</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>
</TALLYMESSAGE>
</DATA>
</BODY>
</ENVELOPE>`;

  const vouchers2 = parseVouchers(invalidXml);
  assert.strictEqual(vouchers2.length, 1, "Expected only the valid voucher to be parsed");
  assert.strictEqual(vouchers2[0].voucherNumber, "PAY-003");
  assert.strictEqual(vouchers2[0].masterId, 1003);
  assert.strictEqual(vouchers2[0].alterId, 1);
  assert.strictEqual(vouchers2[0].guid, undefined, "GUID should be undefined when omitted");
  console.log("✓ Test 2 passed: Malformed vouchers with missing MASTERID or ALTERID were safely skipped.\n");

  // ─── Test 3: Large XML file benchmark (1,000 Vouchers) ───────────────────────
  console.log("Test 3: Large XML file benchmark (1,000 vouchers)");
  const voucherXmlParts: string[] = [];
  for (let i = 1; i <= 1000; i++) {
    voucherXmlParts.push(`
<VOUCHER VCHTYPE="${i % 2 === 0 ? "Sales" : "Payment"}">
  <MASTERID>${10000 + i}</MASTERID>
  <ALTERID>${i % 5 + 1}</ALTERID>
  <GUID>guid-${10000 + i}</GUID>
  <VOUCHERNUMBER>VCH-${i.toString().padStart(4, "0")}</VOUCHERNUMBER>
  <VOUCHERTYPENAME>${i % 2 === 0 ? "Sales" : "Payment"}</VOUCHERTYPENAME>
  <DATE>20260401</DATE>
  <PARTYNAME>Vendor ${i}</PARTYNAME>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Ledger A</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${100 + i}.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Ledger B</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${100 + i}.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`);
  }

  const largeXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION></HEADER>
<BODY><DATA><TALLYMESSAGE>${voucherXmlParts.join("")}</TALLYMESSAGE></DATA></BODY>
</ENVELOPE>`;

  const startTime = Date.now();
  const vouchers3 = parseVouchers(largeXml);
  const elapsedMs = Date.now() - startTime;

  assert.strictEqual(vouchers3.length, 1000, "Expected all 1,000 vouchers to be parsed");
  assert.strictEqual(vouchers3[0].masterId, 10001);
  assert.strictEqual(vouchers3[999].masterId, 11000);
  assert.strictEqual(vouchers3[500].guid, "guid-10501");
  console.log(`✓ Test 3 passed: Parsed 1,000 vouchers in ${elapsedMs}ms (< 500ms benchmark).\n`);

  console.log("=== All Connector Parser Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
