import { sendToTally } from "../tally/client.js";
import { getLedgers as getLedgerRequest } from "../tally/requests.js";
import { parseLedgers } from "../tally/parser.js";
import { compareLedgers } from "./ledger-sync.js";
import { loadState, saveState } from "../state/state-store.js";
import { sendLedgersToApi } from "../api/client.js";
import { config } from "../config.js";
import type { Ledger, SyncResult } from "./types.js";

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
