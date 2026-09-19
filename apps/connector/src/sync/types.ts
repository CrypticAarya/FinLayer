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
  masterId: number;
  alterId: number;
  guid?: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyName?: string;
  amount: number;
  entries: VoucherEntry[];
}

export interface TrialBalanceItem {
  ledgerName: string;
  groupName: string;
  debitAmount: number;
  creditAmount: number;
}

export type SyncJobType = "LEDGERS" | "VOUCHERS" | "BOTH" | "TRIAL_BALANCE" | "FINANCIAL_DATA";

