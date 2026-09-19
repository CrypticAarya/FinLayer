import prisma from "../db/prisma.js";
import type { Prisma } from "@prisma/client";

// ─── CSV Sanitization & Formatting ───────────────────────────────────────────

/**
 * Mitigates CSV Formula Injection (CWE-1236) on TEXT/STRING fields ONLY.
 * Never called on numeric financial fields.
 * If a string (even after leading spaces, tabs, or newlines) begins with '=', '+', '-', '@', '\t', '\r', or '\n',
 * prefixes with a single quote (') to neutralize spreadsheet formula execution while preserving content.
 */
export function sanitizeCsvText(val: string | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  // Match formula operators (=, +, -, @) or command/DDE triggers after any leading whitespace (spaces, tabs, newlines)
  if (/^\s*[=+\-@\t\r\n]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Escapes a cell according to RFC 4180.
 * If it contains quotes, commas, carriage returns, or newlines, wraps in quotes
 * and doubles any internal quotation marks.
 */
export function escapeCsvCell(cell: string): string {
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/**
 * Formats a text cell: sanitizes for formula injection, then escapes for CSV.
 */
export function formatCsvTextCell(val: string | null | undefined): string {
  const sanitized = sanitizeCsvText(val);
  return escapeCsvCell(sanitized);
}

/**
 * Formats a numeric financial cell:
 * - NEVER modifies or quotes for formula injection.
 * - Negative numbers like -5000.00 remain strictly valid numbers with leading minus.
 * - Decimal precision is preserved deterministically without floating-point math.
 */
export function formatCsvNumericCell(val: number | string | Prisma.Decimal | null | undefined): string {
  if (val == null) return "0.00";
  if (typeof val === "number") {
    return val.toFixed(2);
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : "0.00";
  }
  // Prisma.Decimal instance
  if (typeof (val as any).toFixed === "function") {
    return (val as any).toFixed(2);
  }
  return String(val);
}

/**
 * Formats an integer identity field (MasterID, AlterID).
 */
export function formatCsvIntegerCell(val: number | null | undefined): string {
  if (val == null) return "0";
  return String(Math.floor(val));
}

// ─── XML Sanitization & Formatting ───────────────────────────────────────────

/**
 * Strictly escapes XML entities (&, <, >, ", ') and strips illegal XML 1.0 control characters.
 * Valid XML 1.0 characters: #x9 (tab), #xA (line feed), #xD (carriage return), and [#x20-#xD7FF].
 * Forbidden characters in range #x00-#x08, #x0B-#x0C, #x0E-#x1F are stripped to preserve well-formedness.
 */
export function escapeXml(unsafe: string | null | undefined): string {
  if (unsafe == null) return "";
  // 1. Strip illegal XML 1.0 control characters
  const sanitized = String(unsafe).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");
  // 2. Escape standard XML entities
  return sanitized.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

// ─── Filename & Header Sanitization ──────────────────────────────────────────

/**
 * Sanitizes company names and parameters for use in filenames.
 * Strips directory traversal sequences, control characters, CRLF, and non-alphanumeric symbols.
 */
export function sanitizeFilenameComponent(name: string): string {
  if (!name || typeof name !== "string") return "company";
  const sanitized = name
    .replace(/[\r\n\t\0]/g, "")
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return sanitized || "company";
}

/**
 * Builds safe Content-Disposition attachment header preventing HTTP response splitting.
 */
export function buildContentDispositionHeader(filename: string): string {
  const safeAscii = filename.replace(/[\r\n"]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

// ─── Date Range Validation ───────────────────────────────────────────────────

export interface ValidatedDateRange {
  startDate?: Date;
  endDate?: Date;
  startDateStr?: string;
  endDateStr?: string;
}

/**
 * Validates fromDate and toDate query parameters:
 * - Must strictly match YYYY-MM-DD
 * - Must be a valid calendar date (e.g. 2026-02-30 is rejected)
 * - fromDate must be <= toDate
 * - Evaluated with UTC boundaries (00:00:00.000 to 23:59:59.999)
 */
export function validateDateRange(
  fromDate?: string,
  toDate?: string
): { valid: true; range: ValidatedDateRange } | { valid: false; error: string } {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let startDateStr: string | undefined;
  let endDateStr: string | undefined;

  if (fromDate !== undefined && fromDate !== "") {
    if (!dateRegex.test(fromDate)) {
      return { valid: false, error: `Invalid fromDate format: "${fromDate}". Expected YYYY-MM-DD.` };
    }
    const parts = fromDate.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (
      dateObj.getUTCFullYear() !== y ||
      dateObj.getUTCMonth() !== m - 1 ||
      dateObj.getUTCDate() !== d
    ) {
      return { valid: false, error: `Invalid calendar date for fromDate: "${fromDate}".` };
    }
    startDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    startDateStr = fromDate;
  }

  if (toDate !== undefined && toDate !== "") {
    if (!dateRegex.test(toDate)) {
      return { valid: false, error: `Invalid toDate format: "${toDate}". Expected YYYY-MM-DD.` };
    }
    const parts = toDate.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (
      dateObj.getUTCFullYear() !== y ||
      dateObj.getUTCMonth() !== m - 1 ||
      dateObj.getUTCDate() !== d
    ) {
      return { valid: false, error: `Invalid calendar date for toDate: "${toDate}".` };
    }
    endDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    endDateStr = toDate;
  }

  if (startDate && endDate && startDate > endDate) {
    return {
      valid: false,
      error: `fromDate ("${fromDate}") must be less than or equal to toDate ("${toDate}").`,
    };
  }

  return {
    valid: true,
    range: { startDate, endDate, startDateStr, endDateStr },
  };
}

// ─── Bounded Streaming Batch Exporters ────────────────────────────────────────

const BATCH_SIZE = 500;

export type ChunkWriter = (chunk: string) => Promise<boolean | void> | boolean | void;

/**
 * Streams canonical vouchers as CSV.
 * Cardinality: ONE CSV ROW = ONE VOUCHER ENTRY/SPLIT.
 */
export async function streamVouchersCsv(
  companyId: string,
  companyName: string,
  writeChunk: ChunkWriter,
  range?: ValidatedDateRange,
  abortSignal?: AbortSignal
): Promise<number> {
  if (abortSignal?.aborted) return 0;

  const exportStartTime = new Date();

  // 1. Header row
  const header = [
    "Company_ID",
    "Company_Name",
    "Voucher_ID",
    "Master_ID",
    "Alter_ID",
    "GUID",
    "Voucher_Number",
    "Voucher_Type",
    "Date",
    "Party_Name",
    "Voucher_Total_Amount",
    "Entry_ID",
    "Ledger_ID",
    "Ledger_Name",
    "Entry_Type",
    "Split_Amount",
  ].join(",") + "\r\n";

  const ok = await writeChunk(header);
  if (ok === false || abortSignal?.aborted) {
    return 0;
  }

  // 2. Build where filter with point-in-time consistency boundary
  const where: Prisma.VoucherWhereInput = {
    companyId,
    updatedAt: { lte: exportStartTime },
  };
  if (range?.startDate || range?.endDate) {
    where.date = {};
    if (range.startDate) where.date.gte = range.startDate;
    if (range.endDate) where.date.lte = range.endDate;
  }

  let totalSplitsWritten = 0;
  let cursor: string | undefined;

  while (true) {
    if (abortSignal?.aborted) {
      break;
    }

    const batch = await prisma.voucher.findMany({
      where,
      include: {
        voucherEntries: {
          include: {
            ledger: { select: { id: true, name: true } },
          },
          orderBy: { id: "asc" },
        },
      },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { date: "asc" },
        { id: "asc" },
      ],
    });

    if (batch.length === 0 || abortSignal?.aborted) {
      break;
    }

    for (const v of batch) {
      if (abortSignal?.aborted) break;

      const dateStr = v.date.toISOString().split("T")[0];
      const totalAmountStr = formatCsvNumericCell(v.amount);

      for (const entry of v.voucherEntries) {
        if (abortSignal?.aborted) break;

        const row = [
          escapeCsvCell(companyId),
          formatCsvTextCell(companyName),
          escapeCsvCell(v.id),
          formatCsvIntegerCell(v.masterId),
          formatCsvIntegerCell(v.alterId),
          escapeCsvCell(v.guid || ""),
          formatCsvTextCell(v.voucherNumber),
          formatCsvTextCell(v.voucherType),
          escapeCsvCell(dateStr),
          formatCsvTextCell(v.partyName || ""),
          totalAmountStr,
          escapeCsvCell(entry.id),
          escapeCsvCell(entry.ledgerId),
          formatCsvTextCell(entry.ledger.name),
          escapeCsvCell(entry.type),
          formatCsvNumericCell(entry.amount),
        ].join(",") + "\r\n";

        const canContinue = await writeChunk(row);
        totalSplitsWritten++;
        if (canContinue === false || abortSignal?.aborted) {
          return totalSplitsWritten;
        }
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE || abortSignal?.aborted) {
      break;
    }
  }

  return totalSplitsWritten;
}

/**
 * Streams canonical vouchers as FinLayer Canonical XML.
 */
export async function streamVouchersXml(
  companyId: string,
  companyName: string,
  tallyCompanyName: string,
  writeChunk: ChunkWriter,
  range?: ValidatedDateRange,
  abortSignal?: AbortSignal
): Promise<number> {
  if (abortSignal?.aborted) return 0;

  const exportStartTime = new Date();

  const where: Prisma.VoucherWhereInput = {
    companyId,
    updatedAt: { lte: exportStartTime },
  };
  if (range?.startDate || range?.endDate) {
    where.date = {};
    if (range.startDate) where.date.gte = range.startDate;
    if (range.endDate) where.date.lte = range.endDate;
  }

  const totalVouchers = await prisma.voucher.count({ where });
  const isoNow = new Date().toISOString();

  let openTag = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<FINLAYER_EXPORT version="2.0" type="vouchers" generatedAt="${isoNow}">\n` +
    `  <COMPANY id="${escapeXml(companyId)}" name="${escapeXml(companyName)}" tallyName="${escapeXml(tallyCompanyName)}" />\n` +
    `  <VOUCHERS count="${totalVouchers}"`;

  if (range?.startDateStr) openTag += ` fromDate="${escapeXml(range.startDateStr)}"`;
  if (range?.endDateStr) openTag += ` toDate="${escapeXml(range.endDateStr)}"`;
  openTag += `>\n`;

  const ok = await writeChunk(openTag);
  if (ok === false || abortSignal?.aborted) {
    return 0;
  }

  let cursor: string | undefined;

  while (true) {
    if (abortSignal?.aborted) break;

    const batch = await prisma.voucher.findMany({
      where,
      include: {
        voucherEntries: {
          include: {
            ledger: { select: { id: true, name: true } },
          },
          orderBy: { id: "asc" },
        },
      },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { date: "asc" },
        { id: "asc" },
      ],
    });

    if (batch.length === 0 || abortSignal?.aborted) {
      break;
    }

    for (const v of batch) {
      if (abortSignal?.aborted) break;

      const dateStr = v.date.toISOString().split("T")[0];
      const totalAmountStr = formatCsvNumericCell(v.amount);

      let vTag = `    <VOUCHER id="${escapeXml(v.id)}" masterId="${v.masterId}" alterId="${v.alterId}"`;
      if (v.guid) vTag += ` guid="${escapeXml(v.guid)}"`;
      vTag += ` voucherNumber="${escapeXml(v.voucherNumber)}" voucherType="${escapeXml(v.voucherType)}" date="${dateStr}" partyName="${escapeXml(v.partyName || "")}" totalAmount="${totalAmountStr}">\n`;
      vTag += `      <ENTRIES count="${v.voucherEntries.length}">\n`;

      for (const e of v.voucherEntries) {
        vTag += `        <ENTRY id="${escapeXml(e.id)}" ledgerId="${escapeXml(e.ledgerId)}" ledgerName="${escapeXml(e.ledger.name)}" type="${escapeXml(e.type)}" amount="${formatCsvNumericCell(e.amount)}" />\n`;
      }

      vTag += `      </ENTRIES>\n`;
      vTag += `    </VOUCHER>\n`;

      const canContinue = await writeChunk(vTag);
      if (canContinue === false || abortSignal?.aborted) {
        return totalVouchers;
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE || abortSignal?.aborted) {
      break;
    }
  }

  if (!abortSignal?.aborted) {
    await writeChunk(`  </VOUCHERS>\n</FINLAYER_EXPORT>\n`);
  }
  return totalVouchers;
}

/**
 * Streams canonical ledgers as CSV.
 */
export async function streamLedgersCsv(
  companyId: string,
  companyName: string,
  writeChunk: ChunkWriter,
  abortSignal?: AbortSignal
): Promise<number> {
  if (abortSignal?.aborted) return 0;

  const header = [
    "Company_ID",
    "Company_Name",
    "Ledger_ID",
    "Ledger_Name",
    "Parent_Group",
    "Master_ID",
    "Alter_ID",
    "Updated_At",
  ].join(",") + "\r\n";

  const ok = await writeChunk(header);
  if (ok === false || abortSignal?.aborted) {
    return 0;
  }

  let totalWritten = 0;
  let cursor: string | undefined;

  while (true) {
    if (abortSignal?.aborted) break;

    const batch = await prisma.ledger.findMany({
      where: { companyId },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { name: "asc" },
        { id: "asc" },
      ],
    });

    if (batch.length === 0 || abortSignal?.aborted) {
      break;
    }

    for (const l of batch) {
      if (abortSignal?.aborted) break;

      const row = [
        escapeCsvCell(companyId),
        formatCsvTextCell(companyName),
        escapeCsvCell(l.id),
        formatCsvTextCell(l.name),
        formatCsvTextCell(l.parent),
        formatCsvIntegerCell(l.masterId),
        formatCsvIntegerCell(l.alterId),
        escapeCsvCell(l.updatedAt.toISOString()),
      ].join(",") + "\r\n";

      const canContinue = await writeChunk(row);
      totalWritten++;
      if (canContinue === false || abortSignal?.aborted) {
        return totalWritten;
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE || abortSignal?.aborted) {
      break;
    }
  }

  return totalWritten;
}

/**
 * Streams canonical ledgers as FinLayer Canonical XML.
 */
export async function streamLedgersXml(
  companyId: string,
  companyName: string,
  tallyCompanyName: string,
  writeChunk: ChunkWriter,
  abortSignal?: AbortSignal
): Promise<number> {
  if (abortSignal?.aborted) return 0;

  const totalLedgers = await prisma.ledger.count({ where: { companyId } });
  const isoNow = new Date().toISOString();

  const openTag = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<FINLAYER_EXPORT version="2.0" type="ledgers" generatedAt="${isoNow}">\n` +
    `  <COMPANY id="${escapeXml(companyId)}" name="${escapeXml(companyName)}" tallyName="${escapeXml(tallyCompanyName)}" />\n` +
    `  <LEDGERS count="${totalLedgers}">\n`;

  const ok = await writeChunk(openTag);
  if (ok === false || abortSignal?.aborted) {
    return 0;
  }

  let cursor: string | undefined;

  while (true) {
    if (abortSignal?.aborted) break;

    const batch = await prisma.ledger.findMany({
      where: { companyId },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { name: "asc" },
        { id: "asc" },
      ],
    });

    if (batch.length === 0 || abortSignal?.aborted) {
      break;
    }

    for (const l of batch) {
      if (abortSignal?.aborted) break;

      const tag = `    <LEDGER id="${escapeXml(l.id)}" masterId="${l.masterId}" alterId="${l.alterId}" name="${escapeXml(l.name)}" parentGroup="${escapeXml(l.parent)}" updatedAt="${l.updatedAt.toISOString()}" />\n`;
      const canContinue = await writeChunk(tag);
      if (canContinue === false || abortSignal?.aborted) {
        return totalLedgers;
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE || abortSignal?.aborted) {
      break;
    }
  }

  if (!abortSignal?.aborted) {
    await writeChunk(`  </LEDGERS>\n</FINLAYER_EXPORT>\n`);
  }
  return totalLedgers;
}

/**
 * Streams canonical trial balance entries as CSV.
 * Semantic Grounding: Represents the latest synchronized snapshot in FinLayer DB.
 * Debit_Amount and Credit_Amount are non-negative balances as stored.
 */
export async function streamTrialBalanceCsv(
  companyId: string,
  companyName: string,
  writeChunk: ChunkWriter,
  abortSignal?: AbortSignal
): Promise<number> {
  if (abortSignal?.aborted) return 0;

  const header = [
    "Company_ID",
    "Company_Name",
    "Ledger_Name",
    "Group_Name",
    "Debit_Amount",
    "Credit_Amount",
    "Updated_At",
  ].join(",") + "\r\n";

  const ok = await writeChunk(header);
  if (ok === false || abortSignal?.aborted) {
    return 0;
  }

  let totalWritten = 0;
  let cursor: string | undefined;

  while (true) {
    if (abortSignal?.aborted) break;

    const batch = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { groupName: "asc" },
        { id: "asc" },
      ],
    });

    if (batch.length === 0 || abortSignal?.aborted) {
      break;
    }

    for (const tb of batch) {
      if (abortSignal?.aborted) break;

      const row = [
        escapeCsvCell(companyId),
        formatCsvTextCell(companyName),
        formatCsvTextCell(tb.ledgerName),
        formatCsvTextCell(tb.groupName),
        formatCsvNumericCell(tb.debitAmount),
        formatCsvNumericCell(tb.creditAmount),
        escapeCsvCell(tb.updatedAt.toISOString()),
      ].join(",") + "\r\n";

      const canContinue = await writeChunk(row);
      totalWritten++;
      if (canContinue === false || abortSignal?.aborted) {
        return totalWritten;
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE || abortSignal?.aborted) {
      break;
    }
  }

  return totalWritten;
}

/**
 * Streams canonical trial balance entries as FinLayer Canonical XML.
 * Uses PostgreSQL database-side aggregation for totals to eliminate unbounded in-memory array loading.
 */
export async function streamTrialBalanceXml(
  companyId: string,
  companyName: string,
  tallyCompanyName: string,
  writeChunk: ChunkWriter,
  abortSignal?: AbortSignal
): Promise<number> {
  if (abortSignal?.aborted) return 0;

  // FIX 6: Execute aggregation inside PostgreSQL (O(1) memory)
  const aggregation = await prisma.trialBalanceEntry.aggregate({
    where: { companyId },
    _count: true,
    _sum: {
      debitAmount: true,
      creditAmount: true,
    },
  });

  const totalCount = aggregation._count ?? 0;
  const debitTotal = aggregation._sum.debitAmount ?? 0;
  const creditTotal = aggregation._sum.creditAmount ?? 0;
  const isoNow = new Date().toISOString();

  const openTag = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<FINLAYER_EXPORT version="2.0" type="trial-balance" generatedAt="${isoNow}">\n` +
    `  <COMPANY id="${escapeXml(companyId)}" name="${escapeXml(companyName)}" tallyName="${escapeXml(tallyCompanyName)}" />\n` +
    `  <TRIAL_BALANCE count="${totalCount}" debitTotal="${debitTotal.toFixed(2)}" creditTotal="${creditTotal.toFixed(2)}">\n`;

  const ok = await writeChunk(openTag);
  if (ok === false || abortSignal?.aborted) {
    return 0;
  }

  let cursor: string | undefined;

  while (true) {
    if (abortSignal?.aborted) break;

    const batch = await prisma.trialBalanceEntry.findMany({
      where: { companyId },
      take: BATCH_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: [
        { groupName: "asc" },
        { id: "asc" },
      ],
    });

    if (batch.length === 0 || abortSignal?.aborted) {
      break;
    }

    for (const tb of batch) {
      if (abortSignal?.aborted) break;

      const tag = `    <ENTRY ledgerName="${escapeXml(tb.ledgerName)}" groupName="${escapeXml(tb.groupName)}" debitAmount="${tb.debitAmount.toFixed(2)}" creditAmount="${tb.creditAmount.toFixed(2)}" updatedAt="${tb.updatedAt.toISOString()}" />\n`;
      const canContinue = await writeChunk(tag);
      if (canContinue === false || abortSignal?.aborted) {
        return totalCount;
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE || abortSignal?.aborted) {
      break;
    }
  }

  if (!abortSignal?.aborted) {
    await writeChunk(`  </TRIAL_BALANCE>\n</FINLAYER_EXPORT>\n`);
  }
  return totalCount;
}
