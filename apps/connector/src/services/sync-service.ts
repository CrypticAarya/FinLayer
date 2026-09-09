import { fetchLedgersFromTally } from "./tally-service.ts";
import { sendLedgersToApi } from "../api/client.ts";
import { config } from "../config.ts";
import type { Ledger } from "../sync/types.ts";

export async function syncLedgers(): Promise<Ledger[]> {
  const ledgers = await fetchLedgersFromTally();
  await sendLedgersToApi(config.companyName, ledgers);
  return ledgers;
}

export async function syncCompany(): Promise<Ledger[]> {
  return await syncLedgers();
}
