import { config } from "./config.ts";
import { registerAndStartHeartbeat } from "./services/registration-service.ts";
import { startJobWorker } from "./jobs/job-worker.ts";

async function main() {
  console.log("FinLayer Connector started");

  console.log("Configuration:");
  console.log(config);

  const { connectorId } = await registerAndStartHeartbeat();

  console.log(`FinLayer Connector active with ID: ${connectorId}`);

  startJobWorker(connectorId);
}

main().catch((error) => {
  console.error("Connector failed:");
  console.error(error);
  process.exit(1);
});

