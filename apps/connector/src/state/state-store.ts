import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

function getSafeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function getStateFilePath(): string {
  const safeName = getSafeFilename(config.companyName);
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../../data/states", `${safeName}.json`);
}

export async function loadState<T>(): Promise<T | null> {
  try {
    const filePath = getStateFilePath();
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function saveState<T>(state: T): Promise<void> {
  const filePath = getStateFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

export interface ConnectorState {
  deviceId: string;
  connectorId: string;
  registeredAt: string;
  deviceName?: string;
  operatingSystem?: string;
  company?: string;
  companyId?: string;
  tallyCompanyName?: string;
  setupStatus?:
    | "REGISTERED"
    | "TALLY_CONNECTED"
    | "WAITING_FOR_COMPANY"
    | "WAITING_FOR_GOOGLE"
    | "ACTIVE";
}

export function getConnectorFilePath(): string {
  if (process.env.FINLAYER_STATE_PATH && existsSync(process.env.FINLAYER_STATE_PATH)) {
    return process.env.FINLAYER_STATE_PATH;
  }

  // Check AppData / Library location (used by FinLayer Windows desktop app)
  const appDataBase = process.env.APPDATA || (
    process.platform === "darwin"
      ? resolve(process.env.HOME || "", "Library", "Application Support")
      : resolve(process.env.HOME || "", ".config")
  );
  const appDataStatePath = resolve(appDataBase, "FinLayer", "connector-state.json");
  if (existsSync(appDataStatePath)) {
    return appDataStatePath;
  }

  const isPkg = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  if (isPkg) {
    const pkgPath = resolve(dirname(process.execPath), "connector-state.json");
    if (existsSync(pkgPath)) return pkgPath;
  }

  const cwdPath = resolve(process.cwd(), "connector-state.json");
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  // Fallback to legacy location if exists
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const legacyPath = resolve(currentDir, "../../data/connector.json");
  if (existsSync(legacyPath)) {
    return legacyPath;
  }

  // If AppData directory exists, prefer AppData
  if (existsSync(resolve(appDataBase, "FinLayer"))) {
    return appDataStatePath;
  }

  return isPkg ? resolve(dirname(process.execPath), "connector-state.json") : cwdPath;
}

export async function loadConnectorState(): Promise<ConnectorState | null> {
  const appDataBase = process.env.APPDATA || (
    process.platform === "darwin"
      ? resolve(process.env.HOME || "", "Library", "Application Support")
      : resolve(process.env.HOME || "", ".config")
  );
  const candidatePaths = [
    process.env.FINLAYER_STATE_PATH,
    resolve(appDataBase, "FinLayer", "connector-state.json"),
    getConnectorFilePath(),
  ].filter(Boolean) as string[];

  for (const filePath of candidatePaths) {
    try {
      if (existsSync(filePath)) {
        const data = await readFile(filePath, "utf-8");
        const parsed = JSON.parse(data) as ConnectorState;
        if (parsed && (parsed.deviceId || parsed.connectorId || parsed.tallyCompanyName)) {
          return parsed;
        }
      }
    } catch {}
  }
  return null;
}

export async function saveConnectorState(state: ConnectorState): Promise<void> {
  const filePath = getConnectorFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

export async function deleteConnectorState(): Promise<void> {
  const paths = [
    resolve(process.cwd(), "connector-state.json"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../data/connector.json"),
  ];
  for (const p of paths) {
    try {
      await unlink(p);
    } catch {}
  }
}

