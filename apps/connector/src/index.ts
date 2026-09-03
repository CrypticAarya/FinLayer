import { config } from "./config.ts";
import { getLedgers } from "./tally/requests.ts";
import { parseLedgers } from "./tally/parser.ts";

async function main() {
  console.log("FinLayer Connector started");

  console.log("Configuration:");
  console.log(config);

  console.log("Fetching ledgers from Tally...");

  const response = await getLedgers();

  console.log("Tally Response:");
  console.log(response);

  console.log("Parsed Ledgers:");
  const ledgers = parseLedgers(response);
  console.log(JSON.stringify(ledgers, null, 2));
}

main().catch((error) => {
  console.error("Connector failed:");
  console.error(error);
  process.exit(1);
});
