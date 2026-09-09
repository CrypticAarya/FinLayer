import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";

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
  connectorId: string;
  deviceId: string;
  name: string;
  company: string;
  registeredAt: string;
}

function getConnectorFilePath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../../data/connector.json");
}

export async function loadConnectorState(): Promise<ConnectorState | null> {
  try {
    const filePath = getConnectorFilePath();
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as ConnectorState;
  } catch {
    return null;
  }
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

