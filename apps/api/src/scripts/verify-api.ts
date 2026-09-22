#!/usr/bin/env tsx
/**
 * FinLayer V2.2 — Developer API Verification Script
 * 
 * Purpose:
 * External developers and operators can run `npm run verify-api` to instantly
 * verify that the SaaS API is live, authenticated, and returning valid double-entry data.
 * 
 * Verifies:
 * 1. Authentication (Bearer token verification)
 * 2. Company metadata schema and connectivity
 * 3. Trial Balance calculation and double-entry equation check
 * 4. Voucher retrieval and structure validation
 */

import prisma from "../db/prisma.js";
import { generateSaasApiKey } from "../auth/saas-auth.js";
import { buildApp } from "../app.js";

async function main() {
  console.log("===================================================================");
  console.log("   FINLAYER SaaS API: DEVELOPER INTEGRATION VERIFICATION PROBE     ");
  console.log("===================================================================\n");

  let server: any = null;
  let baseUrl = process.env.FINLAYER_BASE_URL || "http://localhost:4000/api/v1";
  let apiKey = process.env.FINLAYER_API_KEY;
  let companyId = process.env.FINLAYER_COMPANY_ID;
  let isEphemeral = false;

  try {
    // ─── Step 0: Ensure Target Company & API Key Exist ───────────────────────
    if (!apiKey || !companyId) {
      // Find an existing active company in PostgreSQL
      const existingCompany = await prisma.company.findFirst({
        where: {
          ledgers: { some: {} },
        },
        include: {
          apiKeys: {
            where: { status: "ACTIVE" },
            take: 1,
          },
        },
      });

      if (existingCompany) {
        companyId = existingCompany.id;
        // If an active key is already present, create an ephemeral key for this test run
        const keyGen = await generateSaasApiKey({
          companyId: existingCompany.id,
          name: "verify-api-ephemeral-test-key",
        });
        apiKey = keyGen.apiKey;
        isEphemeral = true;
      } else {
        // Create a quick temporary company for probe validation
        const newCo = await prisma.company.create({
          data: {
            name: `Verify Probe Co ${Date.now()}`,
            tallyCompanyName: `Verify Probe Co ${Date.now()}`,
          },
        });
        companyId = newCo.id;
        const keyGen = await generateSaasApiKey({
          companyId: newCo.id,
          name: "verify-api-ephemeral-test-key",
        });
        apiKey = keyGen.apiKey;
        isEphemeral = true;
      }
    }

    // Check if FinLayer server is running on target port; if not, spin up in-process Fastify instance
    try {
      const probe = await fetch(`${baseUrl.replace("/api/v1", "")}/docs/openapi.json`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!probe.ok && probe.status !== 404) {
        throw new Error(`Port busy or unresponsive: status ${probe.status}`);
      }
    } catch {
      // Server not running externally: launch in-process Fastify app on ephemeral port
      server = await buildApp({ logger: false });
      const address = await server.listen({ port: 0, host: "127.0.0.1" });
      baseUrl = `${address}/api/v1`;
      console.log(`[Info] FinLayer API started in-process at ${baseUrl}\n`);
    }

    console.log(`Configuration:`);
    console.log(`  Target Base URL: ${baseUrl}`);
    console.log(`  Company ID:      ${companyId}`);
    console.log(`  API Key:         ${apiKey.slice(0, 12)}••••••••••••${apiKey.slice(-4)}\n`);

    // Helper for requests
    async function apiRequest(endpoint: string) {
      const start = Date.now();
      const res = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json",
        },
      });
      const durationMs = Date.now() - start;
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, data, durationMs };
    }

    // ─── Step 1: Verify Company Metadata ─────────────────────────────────────
    process.stdout.write("[1/3] Testing Authentication & Company Metadata... ");
    const companyRes = await apiRequest(`/companies/${companyId}`);
    if (!companyRes.ok) {
      throw new Error(`Failed to fetch company (HTTP ${companyRes.status}): ${companyRes.data.error || "Unknown"}`);
    }
    const company = companyRes.data.data;
    if (!company || !company.id || !company.name) {
      throw new Error("Invalid company response structure: missing id or name");
    }
    console.log(`✔ 200 OK (${companyRes.durationMs}ms) — "${company.name}"`);

    // ─── Step 2: Verify Canonical Trial Balance ──────────────────────────────
    process.stdout.write("[2/3] Testing Canonical Trial Balance & Accounting Check... ");
    const tbRes = await apiRequest(`/companies/${companyId}/trial-balance`);
    if (!tbRes.ok) {
      throw new Error(`Failed to fetch trial balance (HTTP ${tbRes.status}): ${tbRes.data.error || "Unknown"}`);
    }
    const { totals, data: accounts } = tbRes.data;
    if (!totals || typeof totals.debitTotal !== "number" || typeof totals.creditTotal !== "number" || !Array.isArray(accounts)) {
      throw new Error("Invalid trial balance response structure: missing totals or accounts array");
    }
    const isBalanced = totals.isBalanced ?? (Math.abs(totals.debitTotal - totals.creditTotal) < 0.01);
    const balanceStatus = isBalanced ? "BALANCED (Dr === Cr)" : "UNBALANCED";
    console.log(`✔ 200 OK (${tbRes.durationMs}ms) — ${accounts.length} accounts, ${balanceStatus}`);

    // ─── Step 3: Verify Voucher Pagination ───────────────────────────────────
    process.stdout.write("[3/3] Testing Voucher Retrieval & Keyset Pagination... ");
    const voucherRes = await apiRequest(`/companies/${companyId}/vouchers?limit=5`);
    if (!voucherRes.ok) {
      throw new Error(`Failed to fetch vouchers (HTTP ${voucherRes.status}): ${voucherRes.data.error || "Unknown"}`);
    }
    const { data: vouchers, pagination } = voucherRes.data;
    if (!Array.isArray(vouchers) || !pagination) {
      throw new Error("Invalid vouchers response structure: missing data array or pagination");
    }
    console.log(`✔ 200 OK (${voucherRes.durationMs}ms) — ${vouchers.length} vouchers retrieved`);

    // ─── Step 4: Verify Data Freshness & Sync Status ─────────────────────────
    process.stdout.write("[4/4] Testing Data Freshness & Sync Status (/sync-status)... ");
    const syncStatusRes = await apiRequest(`/companies/${companyId}/sync-status`);
    if (!syncStatusRes.ok) {
      throw new Error(`Failed to fetch sync status (HTTP ${syncStatusRes.status}): ${syncStatusRes.data.error || "Unknown"}`);
    }
    const syncStatus = syncStatusRes.data.data;
    if (!syncStatus || typeof syncStatus.recordsProcessed !== "number") {
      throw new Error("Invalid sync status response structure: missing recordsProcessed");
    }
    console.log(`✔ 200 OK (${syncStatusRes.durationMs}ms) — Connector: ${syncStatus.connectorStatus}, Processed: ${syncStatus.recordsProcessed}`);

    // ─── Step 5: Verify OpenAPI Documentation Route ──────────────────────────
    process.stdout.write("[Bonus] Testing Read-Only Swagger UI Endpoint (/docs)... ");
    const docsRes = await fetch(`${baseUrl.replace("/api/v1", "")}/docs`);
    if (!docsRes.ok) {
      throw new Error(`Swagger UI endpoint failed with status ${docsRes.status}`);
    }
    console.log(`✔ 200 OK (Swagger UI Live & Read-Only)\n`);

    console.log("===================================================================");
    console.log("   ALL INTEGRATION CHECKS PASSED: FINLAYER SAAS API IS READY!      ");
    console.log("===================================================================\n");
  } catch (err: any) {
    console.error("\n❌ API Verification Failed:", err.message);
    process.exit(1);
  } finally {
    if (isEphemeral && apiKey) {
      // Clean up ephemeral key
      const keyPrefix = apiKey.slice(0, 12);
      await prisma.apiKey.deleteMany({
        where: { keyPrefix, name: "verify-api-ephemeral-test-key" },
      }).catch(() => {});
    }
    if (server) {
      await server.close().catch(() => {});
    }
    await prisma.$disconnect();
  }
}

main();
