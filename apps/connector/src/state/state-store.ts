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
  const isPkg = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  if (isPkg) {
    return resolve(dirname(process.execPath), "connector-state.json");
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

  return cwdPath;
}

export async function loadConnectorState(): Promise<ConnectorState | null> {
  try {
    const filePath = getConnectorFilePath();
    const data = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(data) as ConnectorState;
    if (parsed && parsed.deviceId && parsed.connectorId) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveConnectorState(state: ConnectorState): Promise<void> {
  const isPkg = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  const filePath = isPkg
    ? resolve(dirname(process.execPath), "connector-state.json")
    : resolve(process.cwd(), "connector-state.json");

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

