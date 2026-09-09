import { XMLParser } from "fast-xml-parser";
import type { Voucher, VoucherEntry } from "../sync/types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
});

function extractValue(value: any): any {
  if (value && typeof value === "object" && "#text" in value) {
    return value["#text"];
  }
  return value;
}

export function parseLedgers(xml: string) {
  const result = parser.parse(xml);

  const ledgers =
    result?.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER ?? [];

  const ledgerList = Array.isArray(ledgers)
    ? ledgers
    : [ledgers];

  return ledgerList
    .filter((l: any) => l != null && typeof l === "object")
    .map((ledger: any) => ({
      name: String(ledger["@_NAME"] ?? extractValue(ledger.NAME) ?? "").trim(),
      parent: String(extractValue(ledger.PARENT) ?? "").trim(),
      masterId: Number(extractValue(ledger.MASTERID) ?? 0),
      alterId: Number(extractValue(ledger.ALTERID) ?? 0),
    }))
    .filter((l: any) => l.name.length > 0);
}

export function parseVouchers(xml: string): Voucher[] {
  const result = parser.parse(xml);

  const tallyMessages = result?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE;
  if (!tallyMessages) {
    return [];
  }

  const messageList = Array.isArray(tallyMessages)
    ? tallyMessages
    : [tallyMessages];

  const rawVouchers: any[] = [];
  for (const msg of messageList) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.VOUCHER) {
      if (Array.isArray(msg.VOUCHER)) {
        rawVouchers.push(...msg.VOUCHER);
      } else {
        rawVouchers.push(msg.VOUCHER);
      }
    }
  }

  const parsedVouchers: Voucher[] = [];

  for (const v of rawVouchers) {
    if (!v || typeof v !== "object") continue;

    const voucherNumber = String(extractValue(v.VOUCHERNUMBER) ?? "").trim();
    const voucherType = String(
      extractValue(v.VOUCHERTYPENAME) ?? v["@_VCHTYPE"] ?? ""
    ).trim();
    const rawDate = String(extractValue(v.DATE) ?? "").trim();

    // Normalize date: Tally returns YYYYMMDD (e.g. 20260401)
    let formattedDate = rawDate;
    if (/^\d{8}$/.test(rawDate)) {
      formattedDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    }

    const partyNameRaw = extractValue(v.PARTYNAME) ?? extractValue(v.PARTYLEDGERNAME);
    const partyName = partyNameRaw ? String(partyNameRaw).trim() : undefined;

    if (!voucherNumber || !voucherType || !formattedDate) {
      console.warn(
        `[Parser] Skipping malformed voucher: missing voucherNumber (${voucherNumber}), voucherType (${voucherType}), or date (${rawDate})`
      );
      continue;
    }

    // Ledger entries can be in ALLLEDGERENTRIES.LIST or LEDGERENTRIES.LIST
    const rawEntriesContainer =
      v["ALLLEDGERENTRIES.LIST"] ?? v["LEDGERENTRIES.LIST"] ?? [];
    const entryList = Array.isArray(rawEntriesContainer)
      ? rawEntriesContainer
      : [rawEntriesContainer];

    const entries: VoucherEntry[] = [];

    for (const e of entryList) {
      if (!e || typeof e !== "object") continue;

      const ledgerName = String(extractValue(e.LEDGERNAME) ?? "").trim();
      if (!ledgerName) {
        console.warn(`[Parser] Skipping entry in voucher ${voucherNumber}: missing LEDGERNAME`);
        continue;
      }

      const rawAmountVal = extractValue(e.AMOUNT);
      const numAmount = Number(rawAmountVal);
      if (isNaN(numAmount)) {
        console.warn(
          `[Parser] Skipping entry in voucher ${voucherNumber} (ledger: ${ledgerName}): invalid amount "${rawAmountVal}"`
        );
        continue;
      }

      // Tally semantics:
      // Negative amount in Tally XML or ISDEEMEDPOSITIVE === 'Yes' indicates DEBIT.
      // Positive amount in Tally XML or ISDEEMEDPOSITIVE === 'No' indicates CREDIT.
      const isDeemedPositive = String(extractValue(e.ISDEEMEDPOSITIVE) ?? "").trim().toLowerCase();
      let type: "debit" | "credit";
      if (isDeemedPositive === "yes" || numAmount < 0) {
        type = "debit";
      } else {
        type = "credit";
      }

      const absoluteAmount = Math.abs(numAmount);

      entries.push({
        ledgerName,
        amount: absoluteAmount,
        type,
      });
    }

    if (entries.length === 0) {
      console.warn(
        `[Parser] Skipping voucher ${voucherNumber}: has no valid ledger entries`
      );
      continue;
    }

    // Calculate total voucher amount: sum of debits (or credits if no debits)
    const debitTotal = entries
      .filter((e) => e.type === "debit")
      .reduce((sum, e) => sum + e.amount, 0);
    const creditTotal = entries
      .filter((e) => e.type === "credit")
      .reduce((sum, e) => sum + e.amount, 0);
    const voucherAmount = debitTotal > 0 ? debitTotal : creditTotal;

    parsedVouchers.push({
      voucherNumber,
      voucherType,
      date: formattedDate,
      partyName: partyName && partyName.length > 0 ? partyName : undefined,
      amount: voucherAmount,
      entries,
    });
  }

  return parsedVouchers;
}


