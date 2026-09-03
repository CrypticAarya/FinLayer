import { config } from "./config.ts";
import { getLedgers } from "./tally/requests.ts";

async function main() {
  console.log("FinLayer Connector started");

  console.log("Configuration:");
  console.log(config);

  console.log("Fetching ledgers from Tally...");

  const response = await getLedgers();

  console.log("Tally Response:");
  console.log(response);
}

main().catch((error) => {
  console.error("Connector failed:");
  console.error(error);
  process.exit(1);
});
