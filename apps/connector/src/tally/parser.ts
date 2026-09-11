import { XMLParser } from "fast-xml-parser";
import type { TrialBalanceItem, Voucher, VoucherEntry } from "../sync/types.js";

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

function parseAmountValue(val: any): number {
  if (val == null) return 0;
  const raw = extractValue(val);
  if (typeof raw === "number") return isNaN(raw) ? 0 : raw;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/,/g, "").trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  if (typeof raw === "object") {
    const inner = raw.DSPAMTA ?? raw.DSPAMOUNT ?? raw.AMOUNT ?? raw["#text"];
    return parseAmountValue(inner);
  }
  return 0;
}

export function parseTrialBalance(xml: string): TrialBalanceItem[] {
  const result = parser.parse(xml);
  if (!result) return [];

  const bodyData =
    result?.ENVELOPE?.BODY?.DATA ??
    result?.BODY?.DATA ??
    result?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA ??
    result;

  const rawItems: any[] = [];

  const collect = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      rawItems.push(...node);
    } else if (typeof node === "object") {
      rawItems.push(node);
    }
  };

  if (bodyData?.COLLECTION?.LEDGER) {
    collect(bodyData.COLLECTION.LEDGER);
  }

  if (bodyData?.TALLYMESSAGE) {
    const messages = Array.isArray(bodyData.TALLYMESSAGE)
      ? bodyData.TALLYMESSAGE
      : [bodyData.TALLYMESSAGE];
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      if (msg.LEDGER) collect(msg.LEDGER);
      if (msg.TRIALBALANCE) collect(msg.TRIALBALANCE);
      if (msg.LINE) collect(msg.LINE);
      if (msg.DSPACCNAME) collect(msg.DSPACCNAME);
    }
  }

  if (bodyData?.TRIALBALANCE) {
    if (bodyData.TRIALBALANCE.ROW) collect(bodyData.TRIALBALANCE.ROW);
    else if (bodyData.TRIALBALANCE.LINE) collect(bodyData.TRIALBALANCE.LINE);
    else if (bodyData.TRIALBALANCE.LEDGER) collect(bodyData.TRIALBALANCE.LEDGER);
    else if (Array.isArray(bodyData.TRIALBALANCE)) collect(bodyData.TRIALBALANCE);
    else collect(bodyData.TRIALBALANCE);
  }

  if (bodyData?.DSPACCNAME) collect(bodyData.DSPACCNAME);
  if (bodyData?.LINE) collect(bodyData.LINE);
  if (bodyData?.ROW) collect(bodyData.ROW);
  if (bodyData?.LEDGER) collect(bodyData.LEDGER);

  const items: TrialBalanceItem[] = [];
  let currentGroup = "Primary";

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;

    const isGroup =
      String(raw["@_ISGROUP"] ?? raw.ISGROUP ?? raw.DSPISGROUP ?? "").toLowerCase() === "yes" ||
      String(raw["@_TYPE"] ?? raw.TYPE ?? "").toLowerCase() === "group";

    const rawName =
      raw.ledgerName ??
      raw.LEDGERNAME ??
      raw["@_NAME"] ??
      extractValue(raw.NAME) ??
      extractValue(raw.DSPDISPNAME) ??
      extractValue(raw.DSPACCNAME?.DSPDISPNAME) ??
      extractValue(raw.DSPACCNAME) ??
      "";

    const name = String(rawName).trim();
    if (!name || name.toLowerCase() === "total" || name.toLowerCase() === "grand total") {
      continue;
    }

    const explicitGroup =
      raw.groupName ??
      raw.GROUPNAME ??
      extractValue(raw.PARENT) ??
      extractValue(raw.parent) ??
      extractValue(raw.DSPGROUPNAME) ??
      "";

    const groupStr = String(explicitGroup).trim();

    if (isGroup) {
      currentGroup = name;
      const hasDebit = raw.DSPCLDRAMT != null || raw.debitAmount != null || raw.DEBITAMOUNT != null;
      const hasCredit = raw.DSPCLCRAMT != null || raw.creditAmount != null || raw.CREDITAMOUNT != null;
      const hasClosing = raw.CLOSINGBALANCE != null || raw.DSPCLRAMT != null;
      if (!hasDebit && !hasCredit && !hasClosing) {
        continue;
      }
    }

    const assignedGroup = groupStr.length > 0 ? groupStr : (currentGroup || "Primary");

    let debitAmount = 0;
    let creditAmount = 0;

    const debitNode = raw.debitAmount ?? raw.DEBITAMOUNT ?? raw.DSPCLDRAMT ?? raw.DSPCLDRAMTA ?? raw.DEBIT ?? raw.DR;
    const creditNode = raw.creditAmount ?? raw.CREDITAMOUNT ?? raw.DSPCLCRAMT ?? raw.DSPCLCRAMTA ?? raw.CREDIT ?? raw.CR;

    if (debitNode != null || creditNode != null) {
      debitAmount = Math.abs(parseAmountValue(debitNode));
      creditAmount = Math.abs(parseAmountValue(creditNode));
    } else {
      const balNode = raw.CLOSINGBALANCE ?? raw.DSPCLRAMT ?? raw.DSPCLRAMTA ?? raw.AMOUNT;
      if (balNode != null) {
        const balStr = String(extractValue(balNode) ?? "").trim().toLowerCase();
        const numVal = parseAmountValue(balNode);
        const isDeemedPositive = String(raw.ISDEEMEDPOSITIVE ?? "").trim().toLowerCase();

        if (balStr.endsWith("dr") || balStr.includes("debit")) {
          debitAmount = Math.abs(numVal);
          creditAmount = 0;
        } else if (balStr.endsWith("cr") || balStr.includes("credit")) {
          debitAmount = 0;
          creditAmount = Math.abs(numVal);
        } else if (isDeemedPositive === "yes" || numVal < 0) {
          debitAmount = Math.abs(numVal);
          creditAmount = 0;
        } else {
          debitAmount = 0;
          creditAmount = Math.abs(numVal);
        }
      }
    }

    items.push({
      ledgerName: name,
      groupName: assignedGroup,
      debitAmount,
      creditAmount,
    });
  }

  return items;
}


