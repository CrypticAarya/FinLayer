import { sendToTally } from "../tally/client.ts";
import { getLedgers as getLedgerRequest } from "../tally/requests.ts";
import { parseLedgers } from "../tally/parser.ts";
import { compareLedgers } from "./ledger-sync.ts";
import { loadState, saveState } from "../state/state-store.ts";
import { sendLedgersToApi } from "../api/client.ts";
import { config } from "../config.ts";
import type { Ledger, SyncResult } from "./types.ts";

interface LedgerState {
  ledgers: Ledger[];
}

export async function runLedgerSync(): Promise<SyncResult> {
  const requestXml = getLedgerRequest();
  const responseXml = await sendToTally(requestXml);
  const currentLedgers = parseLedgers(responseXml);

  const previousState = await loadState<LedgerState>();
  const previous = previousState?.ledgers ?? [];

  const result = compareLedgers(previous, currentLedgers);

  await saveState<LedgerState>({
    ledgers: currentLedgers,
  });

  await sendLedgersToApi(config.companyName, currentLedgers);

  return result;
}
