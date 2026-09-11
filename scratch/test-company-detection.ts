/**
 * Local Test: Tally Company Detection & Parsing Verification
 * Tests multiple XML responses:
 * 1. Current company response (##SVCURRENTCOMPANY and <CURRENTCOMPANY>)
 * 2. List of companies response (with <ISACTIVE>, <DSPDISPNAME>, multiple companies)
 * 3. Empty response (no companies loaded, None, empty collection)
 */

import {
  parseTallyCompanyResponse,
  cleanCompanyName,
  isValidCompanyName,
} from "../apps/connector/src/tally/company-service.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✓ PASSED: ${message}`);
}

console.log("==================================================");
console.log("Running Tally Company Detection Tests");
console.log("==================================================\n");

// ── Test 1: Current Company Response (Dynamic TDL / CurrentCompanyObj) ────────
console.log("─── Test 1A: Current Company Object Response (##SVCURRENTCOMPANY) ───");
const xmlCurrentCompanyObj = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <STATUS>1</STATUS>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <COLLECTION>
    <CURRENTCOMPANYOBJ>
     <NAME>HIMALAYA OVERSEAS NOIDA</NAME>
    </CURRENTCOMPANYOBJ>
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;

const res1A = parseTallyCompanyResponse(xmlCurrentCompanyObj);
console.log("Result 1A:", JSON.stringify(res1A, null, 2));
assert(res1A.activeCompanyName === "HIMALAYA OVERSEAS NOIDA", "Test 1A active company must be 'HIMALAYA OVERSEAS NOIDA'");
assert(res1A.companies.length >= 1, "Test 1A should have at least 1 company parsed");

console.log("\n─── Test 1B: Current Company Tag Response (<CURRENTCOMPANY> / <SVCURRENTCOMPANY>) ───");
const xmlCurrentCompanyTag = `<ENVELOPE>
 <HEADER><VERSION>1</VERSION></HEADER>
 <BODY>
  <DATA>
   <CURRENTCOMPANY>HIMALAYA OVERSEAS NOIDA</CURRENTCOMPANY>
   <SVCURRENTCOMPANY>HIMALAYA OVERSEAS NOIDA</SVCURRENTCOMPANY>
  </DATA>
 </BODY>
</ENVELOPE>`;

const res1B = parseTallyCompanyResponse(xmlCurrentCompanyTag);
console.log("Result 1B:", JSON.stringify(res1B, null, 2));
assert(res1B.activeCompanyName === "HIMALAYA OVERSEAS NOIDA", "Test 1B active company must be 'HIMALAYA OVERSEAS NOIDA'");

// ── Test 2: List of Companies Response ────────────────────────────────────────
console.log("\n─── Test 2A: List of Companies with IsActive Flag ───");
const xmlListWithIsActive = `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <STATUS>1</STATUS>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
  </DESC>
  <DATA>
   <COLLECTION>
    <COMPANY NAME="INACTIVE ENTERPRISES PVT LTD">
     <NAME>INACTIVE ENTERPRISES PVT LTD</NAME>
     <ISACTIVE>No</ISACTIVE>
    </COMPANY>
    <COMPANY NAME="HIMALAYA OVERSEAS NOIDA">
     <NAME>HIMALAYA OVERSEAS NOIDA</NAME>
     <ISACTIVE>Yes</ISACTIVE>
    </COMPANY>
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;

const res2A = parseTallyCompanyResponse(xmlListWithIsActive);
console.log("Result 2A:", JSON.stringify(res2A, null, 2));
assert(res2A.companies.length === 2, "Test 2A should parse 2 companies");
assert(res2A.activeCompanyName === "HIMALAYA OVERSEAS NOIDA", "Test 2A should pick active company via IsActive=Yes");

console.log("\n─── Test 2B: List of Companies with <DSPDISPNAME> ───");
const xmlListWithDsp = `<ENVELOPE>
 <BODY>
  <DATA>
   <COLLECTION>
    <LISTOFCOMPANIES>
     <DSPDISPNAME>HIMALAYA OVERSEAS NOIDA</DSPDISPNAME>
    </LISTOFCOMPANIES>
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;

const res2B = parseTallyCompanyResponse(xmlListWithDsp);
console.log("Result 2B:", JSON.stringify(res2B, null, 2));
assert(res2B.activeCompanyName === "HIMALAYA OVERSEAS NOIDA", "Test 2B active company should be 'HIMALAYA OVERSEAS NOIDA'");

console.log("\n─── Test 2C: Multiple Companies (First Company Fallback) ───");
const xmlMultipleFallback = `<ENVELOPE>
 <BODY>
  <DATA>
   <COLLECTION>
    <COMPANY NAME="HIMALAYA OVERSEAS NOIDA" />
    <COMPANY NAME="SECONDARY BRANCH NOIDA" />
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;

const res2C = parseTallyCompanyResponse(xmlMultipleFallback);
console.log("Result 2C:", JSON.stringify(res2C, null, 2));
assert(res2C.companies.length === 2, "Test 2C should parse 2 companies");
assert(res2C.activeCompanyName === "HIMALAYA OVERSEAS NOIDA", "Test 2C should fallback to first company");

// ── Test 3: Empty Response ───────────────────────────────────────────────────
console.log("\n─── Test 3A: Empty Collection ───");
const xmlEmptyCollection = `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
 <BODY>
  <DATA>
   <COLLECTION>
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;

const res3A = parseTallyCompanyResponse(xmlEmptyCollection);
console.log("Result 3A:", JSON.stringify(res3A, null, 2));
assert(res3A.companies.length === 0, "Test 3A should have 0 companies");
assert(res3A.activeCompanyName === null, "Test 3A activeCompanyName must be null");

console.log("\n─── Test 3B: No Company Loaded (Placeholder / (None)) ───");
const xmlNoneLoaded = `<ENVELOPE>
 <HEADER><VERSION>1</VERSION></HEADER>
 <BODY>
  <DATA>
   <CURRENTCOMPANY></CURRENTCOMPANY>
   <SVCURRENTCOMPANY>(None)</SVCURRENTCOMPANY>
  </DATA>
 </BODY>
</ENVELOPE>`;

const res3B = parseTallyCompanyResponse(xmlNoneLoaded);
console.log("Result 3B:", JSON.stringify(res3B, null, 2));
assert(res3B.companies.length === 0, "Test 3B should ignore (None)");
assert(res3B.activeCompanyName === null, "Test 3B activeCompanyName must be null");

console.log("\n==================================================");
console.log("✓ ALL TALLY COMPANY DETECTION TESTS PASSED SUCCESSFULLY!");
console.log("==================================================");
