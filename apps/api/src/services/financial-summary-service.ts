import prisma from "../db/prisma.js";

export interface FinancialSummary {
  revenue: number;
  expenses: number;
  profit: number;
  cashBalance: number;
  receivables: number;
  payables: number;
}

/**
 * Calculates financial summary metrics (revenue, expenses, profit, cashBalance, receivables, payables)
 * for a company using existing Trial Balance and Voucher/Ledger data.
 */
export async function calculateFinancialSummary(companyId: string): Promise<FinancialSummary> {
  // 1. Fetch Trial Balance entries
  const tbEntries = await prisma.trialBalanceEntry.findMany({
    where: { companyId },
  });

  let revenue = 0;
  let expenses = 0;
  let cashBalance = 0;
  let receivables = 0;
  let payables = 0;

  if (tbEntries.length > 0) {
    for (const entry of tbEntries) {
      const group = (entry.groupName || "").toLowerCase();
      const name = (entry.ledgerName || "").toLowerCase();
      const debit = Number(entry.debitAmount) || 0;
      const credit = Number(entry.creditAmount) || 0;

      // Revenue: normal credit balance
      if (
        /sales|revenue|direct income|indirect income|operating income|income/i.test(group) ||
        /sales|revenue/i.test(name)
      ) {
        revenue += Math.max(0, credit - debit);
      }
      // Expenses: normal debit balance
      else if (
        /purchase|direct expense|indirect expense|operating expense|expense|cost of goods|administrative/i.test(group) ||
        /purchase|expense/i.test(name)
      ) {
        expenses += Math.max(0, debit - credit);
      }

      // Cash / Bank: normal debit balance
      if (
        /bank accounts|cash-in-hand|bank occ|bank od|cash|bank/i.test(group) ||
        /cash|bank|hdfc|sbi|icici|axis/i.test(name)
      ) {
        cashBalance += (debit - credit);
      }

      // Receivables (Debtors): normal debit balance
      if (
        /sundry debtors|accounts receivable|debtor|receivable/i.test(group) ||
        /debtor|receivable/i.test(name)
      ) {
        receivables += Math.max(0, debit - credit);
      }

      // Payables (Creditors): normal credit balance
      if (
        /sundry creditors|accounts payable|creditor|payable/i.test(group) ||
        /creditor|payable/i.test(name)
      ) {
        payables += Math.max(0, credit - debit);
      }
    }
  }

  // 2. If no revenue or expenses were derived from Trial Balance, check Vouchers
  if (revenue === 0 && expenses === 0) {
    const vouchers = await prisma.voucher.findMany({
      where: { companyId },
      include: {
        voucherEntries: {
          include: {
            ledger: true,
          },
        },
      },
    });

    for (const v of vouchers) {
      const vType = (v.voucherType || "").toLowerCase();
      const amount = Number(v.amount) || 0;

      if (vType === "sales") {
        revenue += amount;
      } else if (vType === "purchase" || vType === "payment") {
        expenses += amount;
      }

      for (const entry of v.voucherEntries) {
        const lName = (entry.ledger?.name || "").toLowerCase();
        const lGroup = (entry.ledger?.parent || "").toLowerCase();
        const amt = Number(entry.amount) || 0;
        const isDebit = entry.type === "debit";

        if (/bank|cash/i.test(lGroup) || /bank|cash/i.test(lName)) {
          cashBalance += isDebit ? amt : -amt;
        }
        if (/debtor|receivable/i.test(lGroup) || /debtor|receivable/i.test(lName)) {
          receivables += isDebit ? amt : -amt;
        }
        if (/creditor|payable/i.test(lGroup) || /creditor|payable/i.test(lName)) {
          payables += isDebit ? -amt : amt;
        }
      }
    }
  }

  const profit = revenue - expenses;

  return {
    revenue: Math.round(Math.max(0, revenue) * 100) / 100,
    expenses: Math.round(Math.max(0, expenses) * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    cashBalance: Math.round(cashBalance * 100) / 100,
    receivables: Math.round(Math.max(0, receivables) * 100) / 100,
    payables: Math.round(Math.max(0, payables) * 100) / 100,
  };
}
