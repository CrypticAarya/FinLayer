import { fetchPendingJob, completeSyncJob, sendLedgersToApi, sendVouchersToApi, sendTrialBalanceToApi } from "../api/client.js";
import { fetchLedgersFromTally, fetchVouchersFromTally, getTrialBalance } from "../services/tally-service.js";
import { loadConnectorState } from "../state/state-store.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface JobWorkerHandle {
  stop: () => void;
}

async function getActiveCompanyName(): Promise<string> {
  const state = await loadConnectorState();
  return state?.tallyCompanyName || config.companyName;
}

async function syncLedgersPipeline(): Promise<void> {
  const company = await getActiveCompanyName();
  logger.info(`Fetching ledgers from Tally for company "${company}"...`);
  const ledgers = await fetchLedgersFromTally(company);
  logger.info(`Received ${ledgers.length} ledgers from Tally`);

  logger.info("Sending ledgers to FinLayer API...");
  const uploadResponse = await sendLedgersToApi(company, ledgers);
  logger.info(`API upload response: company="${uploadResponse.company}", received=${uploadResponse.received}, created=${uploadResponse.created}, updated=${uploadResponse.updated}`);
  logger.info("Ledger sync uploaded successfully");
}

async function syncVouchersPipeline(): Promise<void> {
  const company = await getActiveCompanyName();
  logger.info(`Fetching vouchers from Tally for company "${company}"...`);
  const vouchers = await fetchVouchersFromTally(company);
  logger.info(`Received ${vouchers.length} vouchers from Tally`);

  logger.info("Sending vouchers to FinLayer API...");
  const uploadResponse = await sendVouchersToApi(company, vouchers);
  logger.info(`API upload response: company="${uploadResponse.company}", received=${uploadResponse.received}, created=${uploadResponse.created}`);
  logger.info("Voucher sync uploaded successfully");
}

async function syncTrialBalancePipeline(): Promise<void> {
  const company = await getActiveCompanyName();
  logger.info(`Fetching trial balance from Tally for company "${company}"...`);
  const trialBalance = await getTrialBalance(company);
  logger.info(`Received ${trialBalance.length} trial balance entries from Tally`);

  logger.info("Sending trial balance to FinLayer API...");
  const uploadResponse = await sendTrialBalanceToApi(company, trialBalance);
  logger.info(
    `API upload response: company="${uploadResponse.company}", received=${uploadResponse.received}, created=${uploadResponse.created}, updated=${uploadResponse.updated}`
  );
  logger.info("Trial balance sync uploaded successfully");
}

export async function syncFinancialDataPipeline(_job?: any): Promise<void> {
  const company = await getActiveCompanyName();
  logger.info(`Starting FINANCIAL_DATA sync pipeline for company "${company}"...`);

  // 1. Fetch Trial Balance from Tally & send to API
  logger.info(`Fetching trial balance from Tally for company "${company}"...`);
  const trialBalance = await getTrialBalance(company);
  logger.info(`Received ${trialBalance.length} trial balance entries from Tally`);
  logger.info("Sending trial balance to FinLayer API...");
  const tbRes = await sendTrialBalanceToApi(company, trialBalance);
  logger.info(`API Trial Balance response: received=${tbRes.received}, created=${tbRes.created}, updated=${tbRes.updated}`);

  // 2. Fetch Ledgers from Tally & send to API
  logger.info(`Fetching ledgers from Tally for company "${company}"...`);
  const ledgers = await fetchLedgersFromTally(company);
  logger.info(`Received ${ledgers.length} ledgers from Tally`);
  logger.info("Sending ledgers to FinLayer API...");
  const ledgersRes = await sendLedgersToApi(company, ledgers);
  logger.info(`API Ledgers response: received=${ledgersRes.received}, created=${ledgersRes.created}, updated=${ledgersRes.updated}`);

  // 3. Fetch Vouchers from Tally & send to API
  logger.info(`Fetching vouchers from Tally for company "${company}"...`);
  const vouchers = await fetchVouchersFromTally(company);
  logger.info(`Received ${vouchers.length} vouchers from Tally`);
  logger.info("Sending vouchers to FinLayer API...");
  const vouchersRes = await sendVouchersToApi(company, vouchers);
  logger.info(`API Vouchers response: received=${vouchersRes.received}, created=${vouchersRes.created}`);

  logger.info("FINANCIAL_DATA pipeline completed successfully");
}

export function startJobWorker(
  connectorId: string,
  pollIntervalMs: number = 5000
): JobWorkerHandle {
  let isProcessing = false;

  const checkJobs = async () => {
    if (isProcessing) {
      return;
    }

    try {
      logger.info("Checking for sync jobs...");
      const job = await fetchPendingJob(connectorId);

      if (!job) {
        return;
      }

      isProcessing = true;
      logger.info(`Sync job received: ${job.type}`);

      if (job.type === "LEDGERS") {
        try {
          await syncLedgersPipeline();

          logger.info("Marking job complete");
          await completeSyncJob(job.id);
          logger.info("Sync job marked complete");
        } catch (jobError) {
          logger.error(
            `Error executing LEDGERS sync for job ${job.id}: ${jobError instanceof Error ? jobError.message : String(jobError)}`
          );
          logger.warn(`Job ${job.id} remains pending.`);
        }
      } else if (job.type === "VOUCHERS") {
        try {
          await syncVouchersPipeline();

          logger.info("Marking job complete");
          await completeSyncJob(job.id);
          logger.info("Sync job marked complete");
        } catch (jobError) {
          logger.error(
            `Error executing VOUCHERS sync for job ${job.id}: ${jobError instanceof Error ? jobError.message : String(jobError)}`
          );
          logger.warn(`Job ${job.id} remains pending.`);
        }
      } else if (job.type === "BOTH") {
        try {
          logger.info("Starting ledger sync...");
          await syncLedgersPipeline();
          logger.info("Ledger sync completed");

          logger.info("Starting voucher sync...");
          await syncVouchersPipeline();
          logger.info("Voucher sync completed");

          logger.info("Marking job complete");
          await completeSyncJob(job.id);
          logger.info("Sync job marked complete");
        } catch (jobError) {
          logger.error(
            `Error executing BOTH sync for job ${job.id}: ${jobError instanceof Error ? jobError.message : String(jobError)}`
          );
          logger.warn(`Job ${job.id} remains pending.`);
        }
      } else if (job.type === "TRIAL_BALANCE") {
        try {
          await syncTrialBalancePipeline();

          logger.info("Marking job complete");
          await completeSyncJob(job.id);
          logger.info("Sync job marked complete");
        } catch (jobError) {
          logger.error(
            `Error executing TRIAL_BALANCE sync for job ${job.id}: ${jobError instanceof Error ? jobError.message : String(jobError)}`
          );
          logger.warn(`Job ${job.id} remains pending.`);
        }
      } else if (job.type === "FINANCIAL_DATA") {
        try {
          await syncFinancialDataPipeline(job);

          logger.info("Marking job complete");
          await completeSyncJob(job.id);
          logger.info("FINANCIAL_DATA sync job marked complete");
        } catch (jobError) {
          logger.error(
            `Error executing FINANCIAL_DATA sync for job ${job.id}: ${jobError instanceof Error ? jobError.message : String(jobError)}`
          );
          logger.warn(`Job ${job.id} remains pending.`);
        }
      } else {
        logger.warn(`Unsupported job type: ${job.type}`);
      }
    } catch (error) {
      logger.error(`Error in job worker: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isProcessing = false;
    }
  };

  const timer = setInterval(checkJobs, pollIntervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
