import { sendToTally } from "../tally/client.js";
import { getLedgers, getVouchers, getTrialBalanceRequest } from "../tally/requests.js";
import { parseLedgers, parseVouchers, parseTrialBalance } from "../tally/parser.js";
import { config } from "../config.js";
import type { Ledger, Voucher, TrialBalanceItem } from "../sync/types.js";
import { logger } from "../logger.js";

export async function fetchLedgersFromTally(
  companyName: string = config.companyName
): Promise<Ledger[]> {
  const requestXml = getLedgers(companyName);
  logger.info(`Tally request sent to ${config.tallyUrl} (company: "${companyName}", payload: ${requestXml.length} bytes)`);

  const responseXml = await sendToTally(requestXml);
  logger.info(`Tally response received (${responseXml.length} bytes)`);

  const ledgers = parseLedgers(responseXml);
  logger.info(`Number of ledgers parsed: ${ledgers.length}`);

  return ledgers;
}

export async function fetchVouchersFromTally(
  companyName: string = config.companyName,
  fromDate: string = config.syncFromDate,
  toDate: string = config.syncToDate
): Promise<Voucher[]> {
  const requestXml = getVouchers(companyName, fromDate, toDate);
  logger.info(
    `Tally request sent to ${config.tallyUrl} (company: "${companyName}", from: "${fromDate}", to: "${toDate}", payload: ${requestXml.length} bytes)`
  );

  const responseXml = await sendToTally(requestXml);
  logger.info(`Tally response received (${responseXml.length} bytes)`);

  const vouchers = parseVouchers(responseXml);
  logger.info(`Number of vouchers parsed: ${vouchers.length}`);

  return vouchers;
}

export async function getTrialBalance(
  companyName: string = config.companyName,
  fromDate: string = config.syncFromDate,
  toDate: string = config.syncToDate
): Promise<TrialBalanceItem[]> {
  const requestXml = getTrialBalanceRequest(companyName, fromDate, toDate);
  logger.info(
    `Tally request sent to ${config.tallyUrl} (company: "${companyName}", from: "${fromDate}", to: "${toDate}", payload: ${requestXml.length} bytes)`
  );

  const responseXml = await sendToTally(requestXml);
  logger.info(`Tally response received (${responseXml.length} bytes)`);

  const trialBalance = parseTrialBalance(responseXml);
  logger.info(`Number of trial balance entries parsed: ${trialBalance.length}`);

  return trialBalance;
}

export const fetchTrialBalanceFromTally = getTrialBalance;
