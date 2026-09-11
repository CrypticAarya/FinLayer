import { fetchLedgersFromTally } from "./tally-service.js";
import { sendLedgersToApi } from "../api/client.js";
import { config } from "../config.js";
import type { Ledger } from "../sync/types.js";

export async function syncLedgers(): Promise<Ledger[]> {
  const ledgers = await fetchLedgersFromTally();
  await sendLedgersToApi(config.companyName, ledgers);
  return ledgers;
}

export async function syncCompany(): Promise<Ledger[]> {
  return await syncLedgers();
}
