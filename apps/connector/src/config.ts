import os from "node:os";

export const config = {
  tallyUrl:
    process.env.TALLY_URL ?? "http://127.0.0.1:9000/",
  companyName:
    process.env.TALLY_COMPANY ?? "FinLayer Test Company",
  syncIntervalMinutes:
    Number(process.env.SYNC_INTERVAL_MINUTES ?? "15"),
  apiUrl:
    process.env.API_URL ?? "http://localhost:4000",
  connectorName:
    process.env.CONNECTOR_NAME ?? `FinLayer Agent (${os.hostname()})`,
  deviceId:
    process.env.DEVICE_ID ?? `finlayer-${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
  heartbeatIntervalSeconds:
    Number(process.env.HEARTBEAT_INTERVAL_SECONDS ?? "30"),
  syncFromDate:
    process.env.SYNC_FROM_DATE ?? "1-Apr-2026",
  syncToDate:
    process.env.SYNC_TO_DATE ?? "1-Apr-2026",
};
