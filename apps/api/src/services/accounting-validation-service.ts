export interface VoucherEntryValidationInput {
  ledgerName: string;
  amount: number;
  type: string;
}

export interface VoucherValidationInput {
  masterId: number;
  alterId: number;
  voucherNumber: string;
  voucherType: string;
  date: string;
  amount: number;
  entries: VoucherEntryValidationInput[];
}

export interface ResolvedVoucherEntry {
  ledgerId: string;
  amount: number;
  type: "debit" | "credit";
}

export interface VoucherValidationResult {
  isValid: boolean;
  debitTotal: number;
  creditTotal: number;
  error?: string;
  resolvedEntries?: ResolvedVoucherEntry[];
}

export class AccountingValidationService {
  /**
   * Validates structure, double-entry balance (Debit === Credit),
   * and resolves ledger references against the in-memory ledgerMap.
   */
  public static validateVoucher(
    voucher: VoucherValidationInput,
    ledgerMap: Map<string, string>
  ): VoucherValidationResult {
    const { entries, voucherNumber } = voucher;

    // 1. Basic entry count check (Double-entry accounting requires at least 2 lines)
    if (!entries || entries.length < 2) {
      return {
        isValid: false,
        debitTotal: 0,
        creditTotal: 0,
        error: `Voucher "${voucherNumber}" has fewer than 2 entries (double-entry requires at least 1 debit and 1 credit).`,
      };
    }

    let debitTotal = 0;
    let creditTotal = 0;
    let hasDebit = false;
    let hasCredit = false;
    const resolvedEntries: ResolvedVoucherEntry[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // 2. Validate ledger name presence
      const trimmedName = (entry.ledgerName || "").trim();
      if (!trimmedName) {
        return {
          isValid: false,
          debitTotal,
          creditTotal,
          error: `Voucher "${voucherNumber}" entry #${i + 1} has an empty ledger name.`,
        };
      }

      // 3. Resolve ledger reference against in-memory company ledgers
      const normalizedLedger = trimmedName.toLowerCase();
      const ledgerId = ledgerMap.get(normalizedLedger);
      if (!ledgerId) {
        return {
          isValid: false,
          debitTotal,
          creditTotal,
          error: `Missing ledger: "${entry.ledgerName}" does not exist for this company.`,
        };
      }

      // 4. Validate amount correctness
      const rawAmount = entry.amount;
      if (typeof rawAmount !== "number" || isNaN(rawAmount) || rawAmount === 0) {
        return {
          isValid: false,
          debitTotal,
          creditTotal,
          error: `Voucher "${voucherNumber}" entry #${i + 1} for ledger "${entry.ledgerName}" has invalid amount: ${rawAmount}.`,
        };
      }

      const absoluteAmount = Math.abs(rawAmount);

      // 5. Validate type ("debit" or "credit")
      const normalizedType = (entry.type || "").trim().toLowerCase();
      if (normalizedType !== "debit" && normalizedType !== "credit") {
        return {
          isValid: false,
          debitTotal,
          creditTotal,
          error: `Voucher "${voucherNumber}" entry #${i + 1} has invalid type "${entry.type}". Expected "debit" or "credit".`,
        };
      }

      if (normalizedType === "debit") {
        debitTotal += absoluteAmount;
        hasDebit = true;
      } else {
        creditTotal += absoluteAmount;
        hasCredit = true;
      }

      resolvedEntries.push({
        ledgerId,
        amount: absoluteAmount,
        type: normalizedType as "debit" | "credit",
      });
    }

    // 6. Ensure both a debit and credit leg exist
    if (!hasDebit || !hasCredit) {
      return {
        isValid: false,
        debitTotal,
        creditTotal,
        error: `Voucher "${voucherNumber}" is missing either a debit or credit entry.`,
      };
    }

    // 7. Double-entry balance check: Debit === Credit (calculated in paise/cents to eliminate floating-point artifacts)
    const debitCents = Math.round(debitTotal * 100);
    const creditCents = Math.round(creditTotal * 100);

    if (debitCents !== creditCents) {
      return {
        isValid: false,
        debitTotal,
        creditTotal,
        error: `Unbalanced voucher: Debit total (${debitTotal.toFixed(2)}) !== Credit total (${creditTotal.toFixed(2)}). Difference: ${(
          Math.abs(debitCents - creditCents) / 100
        ).toFixed(2)}`,
      };
    }

    return {
      isValid: true,
      debitTotal,
      creditTotal,
      resolvedEntries,
    };
  }
}
