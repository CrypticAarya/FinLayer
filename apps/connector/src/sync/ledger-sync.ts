import type { Ledger, SyncResult } from "./types.ts";

export function compareLedgers(
  previous: Ledger[],
  current: Ledger[]
): SyncResult {
  const previousMap = new Map<number, Ledger>();
  for (const ledger of previous) {
    previousMap.set(ledger.masterId, ledger);
  }

  const created: Ledger[] = [];
  const updated: Ledger[] = [];
  const unchanged: Ledger[] = [];

  for (const ledger of current) {
    const prev = previousMap.get(ledger.masterId);

    if (!prev) {
      created.push(ledger);
    } else if (prev.alterId !== ledger.alterId) {
      updated.push(ledger);
    } else {
      unchanged.push(ledger);
    }
  }

  return {
    created,
    updated,
    unchanged,
  };
}
