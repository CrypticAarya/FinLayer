import os from "node:os";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Type-safe config interface
// ---------------------------------------------------------------------------

export interface ConnectorConfig {
  tallyUrl: string;
  companyName: string;
  syncIntervalMinutes: number;
  apiUrl: string;
  connectorName: string;
  deviceId: string;
  heartbeatIntervalSeconds: number;
  syncFromDate: string;
  syncToDate: string;
}

/**
 * Subset of ConnectorConfig that can be specified in config.json.
 * deviceId is always derived from the hostname; syncIntervalMinutes,
 * heartbeatIntervalSeconds, and date ranges can be overridden here too.
 */
interface ConfigFile {
  apiUrl?: string;
  tallyUrl?: string;
  companyName?: string;
  connectorName?: string;
  syncIntervalMinutes?: number;
  heartbeatIntervalSeconds?: number;
  syncFromDate?: string;
  syncToDate?: string;
}

// ---------------------------------------------------------------------------
// Load optional config.json:
// When running as packaged EXE (pkg): dirname(process.execPath)/config.json
// When running in dev/node: process.cwd()/config.json or project root
// ---------------------------------------------------------------------------

function loadConfigFile(): ConfigFile {
  const isPkg = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  const configPath = isPkg
    ? resolve(dirname(process.execPath), "config.json")
    : resolve(process.cwd(), "config.json");

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as ConfigFile;
    console.log(`[Config] Loaded external config from ${configPath}`);
    try {
      logger.info(`[Config] Loaded external config from ${configPath}`);
    } catch {
      // logger may not be available yet
    }
    return parsed;
  } catch {
    // If not in cwd during dev, try project root relative to module
    if (!isPkg) {
      try {
        const fallbackPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "config.json");
        const raw = readFileSync(fallbackPath, "utf-8");
        const parsed = JSON.parse(raw) as ConfigFile;
        console.log(`[Config] Loaded external config from ${fallbackPath}`);
        try {
          logger.info(`[Config] Loaded external config from ${fallbackPath}`);
        } catch {}
        return parsed;
      } catch {
        // file absent
      }
    }
    return {};
  }
}

// ---------------------------------------------------------------------------
// Build final config
// Priority:
// In packaged EXE: config.json > env var > default
// In dev: env var > config.json > default
// ---------------------------------------------------------------------------

function buildConfig(): ConnectorConfig {
  const isPkg = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  const file = loadConfigFile();

  const hostname = os.hostname();
  const defaultDeviceId = `finlayer-${hostname.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

  return {
    apiUrl: isPkg
      ? (file.apiUrl ?? process.env.API_URL ?? "http://localhost:4000")
      : (process.env.API_URL ?? file.apiUrl ?? "http://localhost:4000"),

    tallyUrl: isPkg
      ? (file.tallyUrl ?? process.env.TALLY_URL ?? "http://127.0.0.1:9000/")
      : (process.env.TALLY_URL ?? file.tallyUrl ?? "http://127.0.0.1:9000/"),

    companyName: isPkg
      ? (file.companyName ?? process.env.TALLY_COMPANY ?? "")
      : (process.env.TALLY_COMPANY ?? file.companyName ?? ""),

    connectorName: isPkg
      ? (file.connectorName ?? process.env.CONNECTOR_NAME ?? `FinLayer Agent (${hostname})`)
      : (process.env.CONNECTOR_NAME ?? file.connectorName ?? `FinLayer Agent (${hostname})`),

    deviceId:
      process.env.DEVICE_ID ??
      defaultDeviceId,

    syncIntervalMinutes: isPkg
      ? (file.syncIntervalMinutes ?? (process.env.SYNC_INTERVAL_MINUTES !== undefined ? Number(process.env.SYNC_INTERVAL_MINUTES) : 15))
      : (process.env.SYNC_INTERVAL_MINUTES !== undefined ? Number(process.env.SYNC_INTERVAL_MINUTES) : (file.syncIntervalMinutes ?? 15)),

    heartbeatIntervalSeconds: isPkg
      ? (file.heartbeatIntervalSeconds ?? (process.env.HEARTBEAT_INTERVAL_SECONDS !== undefined ? Number(process.env.HEARTBEAT_INTERVAL_SECONDS) : 30))
      : (process.env.HEARTBEAT_INTERVAL_SECONDS !== undefined ? Number(process.env.HEARTBEAT_INTERVAL_SECONDS) : (file.heartbeatIntervalSeconds ?? 30)),

    syncFromDate: isPkg
      ? (file.syncFromDate ?? process.env.SYNC_FROM_DATE ?? "1-Apr-2026")
      : (process.env.SYNC_FROM_DATE ?? file.syncFromDate ?? "1-Apr-2026"),

    syncToDate: isPkg
      ? (file.syncToDate ?? process.env.SYNC_TO_DATE ?? "1-Apr-2026")
      : (process.env.SYNC_TO_DATE ?? file.syncToDate ?? "1-Apr-2026"),
  };
}

export const config: ConnectorConfig = buildConfig();
