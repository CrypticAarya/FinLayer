import { config } from "./config.ts";
import { runLedgerSync } from "./sync/sync-runner.ts";

async function main() {
  console.log("FinLayer Connector started");

  console.log("Configuration:");
  console.log(config);

  const result = await runLedgerSync();

  console.log("Sync Result:");
  console.log({
    created: result.created.length,
    updated: result.updated.length,
    unchanged: result.unchanged.length,
  });
}

main().catch((error) => {
  console.error("Connector failed:");
  console.error(error);
  process.exit(1);
});
