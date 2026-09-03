export interface Ledger {
  name: string;
  parent: string;
  masterId: number;
  alterId: number;
}

export interface SyncResult {
  created: Ledger[];
  updated: Ledger[];
  unchanged: Ledger[];
}
