import { sendToTally } from "../tally/client.ts";
import { getLedgers, getVouchers } from "../tally/requests.ts";
import { parseLedgers, parseVouchers } from "../tally/parser.ts";
import { config } from "../config.ts";
import type { Ledger, Voucher } from "../sync/types.ts";

export async function fetchLedgersFromTally(): Promise<Ledger[]> {
  const requestXml = getLedgers();
  console.log(`Tally request sent to ${config.tallyUrl} (company: "${config.companyName}", payload: ${requestXml.length} bytes)`);

  const responseXml = await sendToTally(requestXml);
  console.log(`Tally response received (${responseXml.length} bytes)`);

  const ledgers = parseLedgers(responseXml);
  console.log(`Number of ledgers parsed: ${ledgers.length}`);

  return ledgers;
}

export async function fetchVouchersFromTally(
  companyName: string = config.companyName,
  fromDate: string = config.syncFromDate,
  toDate: string = config.syncToDate
): Promise<Voucher[]> {
  const requestXml = getVouchers(companyName, fromDate, toDate);
  console.log(
    `Tally request sent to ${config.tallyUrl} (company: "${companyName}", from: "${fromDate}", to: "${toDate}", payload: ${requestXml.length} bytes)`
  );

  const responseXml = await sendToTally(requestXml);
  console.log(`Tally response received (${responseXml.length} bytes)`);

  const vouchers = parseVouchers(responseXml);
  console.log(`Number of vouchers parsed: ${vouchers.length}`);

  return vouchers;
}


