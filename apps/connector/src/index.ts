import { config } from "./config.js";
import { registerAndStartHeartbeat } from "./services/registration-service.js";
import { startJobWorker } from "./jobs/job-worker.js";
import { logger } from "./logger.js";

async function main() {
  logger.info("FinLayer Connector started");
  logger.info(`Configuration: apiUrl=${config.apiUrl} tallyUrl=${config.tallyUrl} company="${config.companyName}" connector="${config.connectorName}"`);

  const { connectorId } = await registerAndStartHeartbeat();

  logger.info(`FinLayer Connector active with ID: ${connectorId}`);

  startJobWorker(connectorId);
}

main().catch((error) => {
  logger.error(`Connector failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
