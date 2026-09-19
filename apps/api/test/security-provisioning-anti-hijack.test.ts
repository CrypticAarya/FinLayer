import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function runProvisioningAntiHijackSecurityTests() {
  console.log("===================================================================");
  console.log("   FINLAYER API: PROVISIONING ANTI-HIJACKING SECURITY TEST SUITE   ");
  console.log("===================================================================\n");

  const app = await buildApp({ logger: false });
  await app.ready();

  const timestamp = Date.now();
  const legitimateCompanyName = `Legit Company ${timestamp}`;
  let userAToken: string;
  let userAId: string;
  let userBToken: string;
  let userBId: string;
  let createdCompanyId: string;

  try {
    // ─── Setup: Create Two Distinct Users ─────────────────────────────────────
    console.log("[Setup] Creating User A (Legitimate Owner) and User B (Attacker)...");
    const sessionResA = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: {
        email: `user-a-${timestamp}@legit.com`,
        name: "Legit Owner A",
      },
    });
    assert.equal(sessionResA.statusCode, 200);
    userAToken = sessionResA.json().token;
    userAId = sessionResA.json().user.id;

    const sessionResB = await app.inject({
      method: "POST",
      url: "/auth/session",
      payload: {
        email: `user-b-${timestamp}@attacker.com`,
        name: "Attacker B",
      },
    });
    assert.equal(sessionResB.statusCode, 200);
    userBToken = sessionResB.json().token;
    userBId = sessionResB.json().user.id;
    console.log("  ✔ Setup Complete.\n");

    // ─── TEST 1: New company provisioning succeeds ────────────────────────────
    console.log("[Test 1] User A provisions a new company via POST /setup/provision...");
    const provResA = await app.inject({
      method: "POST",
      url: "/setup/provision",
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        companyName: legitimateCompanyName,
        tallyUrl: "http://localhost:9000",
        apiUrl: "http://localhost:4000",
        connectorName: "Legit Connector",
      },
    });
    assert.equal(provResA.statusCode, 200, "New company provisioning must return 200 OK");
    const provDataA = provResA.json();
    assert.equal(provDataA.success, true);
    assert.ok(provDataA.companyId);
    createdCompanyId = provDataA.companyId;

    // Verify User A was bound as OWNER
    const membershipA = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: userAId,
          companyId: createdCompanyId,
        },
      },
    });
    assert.ok(membershipA, "User A must have a CompanyMember record");
    assert.equal(membershipA?.role, "OWNER", "User A must have role OWNER");

    // Seed a ledger for this company to test data access
    await prisma.ledger.create({
      data: {
        companyId: createdCompanyId,
        name: "Legitimate Cash Account",
        parent: "Cash-in-hand",
        masterId: 101,
        alterId: 1,
      },
    });

    console.log(`  ✔ Test 1 Passed: Company "${legitimateCompanyName}" provisioned successfully with User A as OWNER.`);

    // ─── TEST 2: Existing company provisioning attempt fails (HTTP 403) ───────
    console.log("\n[Test 2] User B (Attacker) attempts to provision existing company to hijack ownership...");
    const provResB = await app.inject({
      method: "POST",
      url: "/setup/provision",
      headers: { authorization: `Bearer ${userBToken}` },
      payload: {
        companyName: legitimateCompanyName, // TARGETING EXISTING COMPANY!
        tallyUrl: "http://localhost:9000",
        apiUrl: "http://localhost:4000",
        connectorName: "Rogue Connector",
      },
    });

    assert.equal(provResB.statusCode, 403, "Must reject existing company provisioning with HTTP 403 Forbidden");
    assert.match(provResB.json().error, /company already exists/i);
    console.log("  ✔ Test 2 Passed: Existing company provisioning rejected with 403 Forbidden.");

    // ─── TEST 3: Existing company owner remains unchanged ─────────────────────
    console.log("\n[Test 3] Verifying company ownership and memberships remain unchanged in DB...");
    const allMembers = await prisma.companyMember.findMany({
      where: { companyId: createdCompanyId },
    });

    assert.equal(allMembers.length, 1, "There must still be exactly 1 member for the company");
    assert.equal(allMembers[0].userId, userAId, "The only member must be User A");
    assert.equal(allMembers[0].role, "OWNER", "User A must still be OWNER");

    // Explicitly verify User B was NOT granted membership
    const membershipB = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: userBId,
          companyId: createdCompanyId,
        },
      },
    });
    assert.equal(membershipB, null, "User B must NOT have any membership in the victim company");
    console.log("  ✔ Test 3 Passed: User A remains sole OWNER. Zero membership created for User B.");

    // ─── TEST 4: Existing company data remains inaccessible to User B ─────────
    console.log("\n[Test 4] Verifying User B cannot access company data after failed hijack attempt...");
    
    // 4a: Ledger access attempt
    const ledgerAccess = await app.inject({
      method: "GET",
      url: `/dashboard/data/ledgers?companyId=${createdCompanyId}`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    assert.equal(ledgerAccess.statusCode, 403, "User B accessing Company A ledgers must return 403");

    // 4b: Voucher access attempt
    const voucherAccess = await app.inject({
      method: "GET",
      url: `/dashboard/data/vouchers?companyId=${createdCompanyId}`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    assert.equal(voucherAccess.statusCode, 403, "User B accessing Company A vouchers must return 403");

    // 4c: Company listing isolation
    const listingAccess = await app.inject({
      method: "GET",
      url: "/dashboard/data",
      headers: { authorization: `Bearer ${userBToken}` },
    });
    assert.equal(listingAccess.statusCode, 200);
    const userBCompanies = listingAccess.json().companies;
    const leaked = userBCompanies.some((c: any) => c.id === createdCompanyId || c.name === legitimateCompanyName);
    assert.equal(leaked, false, "Company A must be completely invisible to User B in dashboard data");
    console.log("  ✔ Test 4 Passed: Company data strictly inaccessible to User B across all endpoints.");

    console.log("\n===================================================================");
    console.log("   ALL 4 PROVISIONING ANTI-HIJACKING TESTS PASSED (100% SUCCESS)   ");
    console.log("===================================================================");
  } finally {
    // ─── Cleanup ──────────────────────────────────────────────────────────────
    console.log("\n[Cleanup] Cleaning up test records...");
    if (createdCompanyId!) {
      await prisma.ledger.deleteMany({ where: { companyId: createdCompanyId } });
      await prisma.companyMember.deleteMany({ where: { companyId: createdCompanyId } });
      await prisma.company.deleteMany({ where: { id: createdCompanyId } });
    }
    if (userAId!) {
      await prisma.userSession.deleteMany({ where: { userId: userAId } });
      await prisma.user.deleteMany({ where: { id: userAId } });
    }
    if (userBId!) {
      await prisma.userSession.deleteMany({ where: { userId: userBId } });
      await prisma.user.deleteMany({ where: { id: userBId } });
    }
    await prisma.$disconnect();
    await pool.end();
    console.log("[Cleanup] Done.");
  }
}

runProvisioningAntiHijackSecurityTests().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
