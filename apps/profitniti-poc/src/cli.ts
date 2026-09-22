import { ConnectivityService } from "./services/connectivity-service.js";
import { loadFinLayerConfig, maskApiKey } from "./config.js";

async function main() {
  console.log("===================================================================");
  console.log("   PROFITNITI -> FINLAYER CONNECTIVITY TEST (CLI)                  ");
  console.log("===================================================================\n");

  const config = loadFinLayerConfig();
  console.log("Configuration Loaded:");
  console.log(`  FinLayer URL: ${config.apiUrl}`);
  console.log(`  Company ID:   ${config.companyId || "[MISSING]"}`);
  console.log(`  API Key:      ${maskApiKey(config.apiKey)}\n`);

  const service = new ConnectivityService();

  console.log("Initiating connectivity sync probe...\n");
  const result = await service.runFullConnectivitySync();

  console.log("-------------------------------------------------------------------");
  console.log(`Overall Result:   ${result.success ? "✅ SUCCESS (CONNECTED & BALANCED)" : "❌ FAILED"}`);
  console.log(`Roundtrip Time:   ${result.totalDurationMs} ms`);
  console.log("-------------------------------------------------------------------");

  if (result.company) {
    console.log("\nCompany Details Retrieved:");
    console.log(`  Name:           ${result.company.name}`);
    console.log(`  Tally Name:     ${result.company.tallyCompanyName}`);
    console.log(`  Connector:      ${result.company.connectorStatus ?? "ONLINE (Active)"}`);
    console.log(`  Last Sync:      ${result.company.lastSyncAt ? new Date(result.company.lastSyncAt).toLocaleString() : "Real-time"}`);
  }

  if (result.trialBalance) {
    console.log("\nTrial Balance Retrieved:");
    console.log(`  Ledgers Count:  ${result.trialBalance.data.length}`);
    console.log(`  Total Debit:    ₹ ${result.trialBalance.totals.debitTotal.toFixed(2)}`);
    console.log(`  Total Credit:   ₹ ${result.trialBalance.totals.creditTotal.toFixed(2)}`);
    console.log(`  Difference:     ₹ ${result.validation.difference.toFixed(2)}`);
    console.log(`  Equation Check: ${result.validation.accountingEquationSatisfied ? "✓ DEBIT = CREDIT (BALANCED)" : "⚠ UNBALANCED"}`);

    console.log("\nTop Ledgers Sample:");
    for (const item of result.trialBalance.data.slice(0, 5)) {
      console.log(`  - [${item.groupName}] ${item.ledgerName.padEnd(28)} | Dr: ₹${item.debitAmount.toFixed(2).padStart(9)} | Cr: ₹${item.creditAmount.toFixed(2).padStart(9)}`);
    }
  }

  if (result.vouchers && result.vouchers.length > 0) {
    console.log(`\nVouchers Retrieved: ${result.vouchers.length} vouchers`);
    const sample = result.sampleVoucher || result.vouchers[0];
    console.log(`  Sample Voucher: #${sample.voucherNumber} (${sample.voucherType}) on ${new Date(sample.date).toLocaleDateString()}`);
    console.log(`  Party: ${sample.partyName || "N/A"} | Amount: ₹${sample.amount.toFixed(2)}`);
    console.log(`  Entries Legs:`);
    for (const entry of sample.entries) {
      console.log(`    * [${entry.type.toUpperCase()}] ${entry.ledgerName.padEnd(25)} ₹${entry.amount.toFixed(2)}`);
    }
  }

  console.log("\nRecords Fetched Summary:");
  console.log(`  - Ledgers:               ${result.recordsFetched.ledgers}`);
  console.log(`  - Vouchers:              ${result.recordsFetched.vouchers}`);
  console.log(`  - Trial Balance Entries: ${result.recordsFetched.trialBalanceEntries}`);
  console.log(`  - Last Sync Time:        ${result.lastSyncTime}`);
  console.log(`  - Status Message:        ${result.message}`);

  console.log("\nAudit Trail Breakdown:");
  for (const step of result.auditTrail) {
    const symbol = step.status === "SUCCESS" ? "✓" : "✗";
    console.log(`  ${symbol} [${step.durationMs}ms] ${step.step}`);
    if (step.error) console.log(`      Error: ${step.error}`);
  }

  console.log("\n===================================================================\n");
  if (!result.success) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Connectivity probe error:", err);
  process.exit(1);
});
