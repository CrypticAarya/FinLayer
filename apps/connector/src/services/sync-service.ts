import { runLedgerSync } from "../sync/sync-runner.ts";

export async function syncCompany() {
  return await runLedgerSync();
}
