import { appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Resolve log file path relative to the executable (or project root in dev).
// When packaged with pkg, process.execPath points to FinLayerConnector.exe,
// ensuring logs are written to <exe-folder>/logs/connector.log rather than
// the read-only C:\snapshot virtual filesystem.
// ---------------------------------------------------------------------------

function resolveLogPath(): string {
  const isPkg = Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg);
  const exeFolder = isPkg
    ? dirname(process.execPath)
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");

  const logsDir = resolve(exeFolder, "logs");
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {
    // If folder creation fails, don't crash
  }
  return resolve(logsDir, "connector.log");
}

const LOG_PATH = resolveLogPath();

// ---------------------------------------------------------------------------
// Timestamp formatter  →  "2026-09-09 15:50:01"
// ---------------------------------------------------------------------------

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// ---------------------------------------------------------------------------
// Core write — appends to file and echoes to console
// ---------------------------------------------------------------------------

function write(level: "INFO" | "WARN" | "ERROR", message: string): void {
  const line = `[${timestamp()}] ${level} ${message}`;

  // File
  try {
    const logsDir = dirname(LOG_PATH);
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(LOG_PATH, line + "\n", "utf-8");
  } catch {
    // If file write fails (permissions etc.), don't crash the connector
  }

  // Console (keeps dev workflow working)
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const logger = {
  info(message: string): void {
    write("INFO", message);
  },
  warn(message: string): void {
    write("WARN", message);
  },
  error(message: string): void {
    write("ERROR", message);
  },
};
