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

export interface VoucherEntry {
  ledgerName: string;
  amount: number;
  type: "debit" | "credit";
}

export interface Voucher {
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyName?: string;
  amount: number;
  entries: VoucherEntry[];
}

