export const config = {
  tallyUrl:
    process.env.TALLY_URL ?? "http://127.0.0.1:9000/",
  companyName:
    process.env.TALLY_COMPANY ?? "FinLayer Test Company",
  syncIntervalMinutes:
    Number(process.env.SYNC_INTERVAL_MINUTES ?? "15"),
};
