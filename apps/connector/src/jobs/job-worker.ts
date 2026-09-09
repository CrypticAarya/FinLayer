import { fetchPendingJob, completeSyncJob, sendLedgersToApi, sendVouchersToApi } from "../api/client.ts";
import { fetchLedgersFromTally, fetchVouchersFromTally } from "../services/tally-service.ts";
import { config } from "../config.ts";

export interface JobWorkerHandle {
  stop: () => void;
}

async function syncLedgersPipeline(): Promise<void> {
  console.log("Fetching ledgers from Tally...");
  const ledgers = await fetchLedgersFromTally();
  console.log(`Received ${ledgers.length} ledgers from Tally`);

  console.log("Sending ledgers to FinLayer API...");
  const uploadResponse = await sendLedgersToApi(config.companyName, ledgers);
  console.log(`API upload response: company="${uploadResponse.company}", received=${uploadResponse.received}, created=${uploadResponse.created}, updated=${uploadResponse.updated}`);
  console.log("Ledger sync uploaded successfully");
}

async function syncVouchersPipeline(): Promise<void> {
  console.log("Fetching vouchers from Tally...");
  const vouchers = await fetchVouchersFromTally();
  console.log(`Received ${vouchers.length} vouchers from Tally`);

  console.log("Sending vouchers to FinLayer API...");
  const uploadResponse = await sendVouchersToApi(config.companyName, vouchers);
  console.log(`API upload response: company="${uploadResponse.company}", received=${uploadResponse.received}, created=${uploadResponse.created}`);
  console.log("Voucher sync uploaded successfully");
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
      console.log("Checking for sync jobs...");
      const job = await fetchPendingJob(connectorId);

      if (!job) {
        return;
      }

      isProcessing = true;
      console.log(`Sync job received: ${job.type}`);

      if (job.type === "LEDGERS") {
        try {
          await syncLedgersPipeline();

          console.log("Marking job complete");
          await completeSyncJob(job.id);
          console.log("Sync job marked complete");
        } catch (jobError) {
          console.error(
            `Error executing LEDGERS sync for job ${job.id}:`,
            jobError instanceof Error ? jobError.message : jobError
          );
          console.warn(`Job ${job.id} remains pending.`);
        }
      } else if (job.type === "VOUCHERS") {
        try {
          await syncVouchersPipeline();

          console.log("Marking job complete");
          await completeSyncJob(job.id);
          console.log("Sync job marked complete");
        } catch (jobError) {
          console.error(
            `Error executing VOUCHERS sync for job ${job.id}:`,
            jobError instanceof Error ? jobError.message : jobError
          );
          console.warn(`Job ${job.id} remains pending.`);
        }
      } else if (job.type === "BOTH") {
        try {
          console.log("Starting ledger sync...");
          await syncLedgersPipeline();
          console.log("Ledger sync completed");

          console.log("Starting voucher sync...");
          await syncVouchersPipeline();
          console.log("Voucher sync completed");

          console.log("Marking job complete");
          await completeSyncJob(job.id);
          console.log("Sync job marked complete");
        } catch (jobError) {
          console.error(
            `Error executing BOTH sync for job ${job.id}:`,
            jobError instanceof Error ? jobError.message : jobError
          );
          console.warn(`Job ${job.id} remains pending.`);
        }
      } else {
        console.warn(`Unsupported job type: ${job.type}`);
      }
    } catch (error) {
      console.error("Error in job worker:", error);
    } finally {
      isProcessing = false;
    }
  };

  const timer = setInterval(checkJobs, pollIntervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
