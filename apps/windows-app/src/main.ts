import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

// Reuse existing connector services and types
import { fetchCompaniesFromTally, type TallyCompany } from "../../connector/src/tally/company-service.js";
import {
  registerConnectorWithApi,
  selectCompanyForConnector,
  sendHeartbeatToApi,
  reportTallyConnected,
  reportTallyCompanies,
} from "../../connector/src/api/client.js";
import { startJobWorker, type JobWorkerHandle } from "../../connector/src/jobs/job-worker.js";
import { config as connectorConfig } from "../../connector/src/config.js";
import type { ConnectorState } from "../../connector/src/state/state-store.js";

// ─── Internal API Configuration Resolution ─────────────────────────────────────
// Staging default: http://192.168.88.25:4000
// Production later: https://api.finlayer.com
// Development: overridable internally via env / config / cli flags

const PRODUCTION_API_URL = "https://api.finlayer.com";
const STAGING_API_URL = "http://192.168.88.25:4000";

function normalizeUrl(url: string): string {
  let trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed.replace(/\/+$/, "");
}

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          result[key] = val;
        }
      }
    }
  } catch {}
  return result;
}

function parseJsonConfig(filePath: string): Record<string, any> {
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch {}
  return {};
}

function getCliApiUrl(): string | null {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--api-url=")) {
      return arg.split("=")[1].trim();
    }
    if (arg.startsWith("--apiUrl=")) {
      return arg.split("=")[1].trim();
    }
    if (arg.startsWith("--finlayer-api-url=")) {
      return arg.split("=")[1].trim();
    }
    if (
      (arg === "--api-url" || arg === "--apiUrl" || arg === "--finlayer-api-url") &&
      process.argv[i + 1]
    ) {
      return process.argv[i + 1].trim();
    }
  }
  return null;
}

function resolveInitialApiUrl(): string {
  // 1. Command-line flag (--api-url=http://...) - internal dev
  const cliArg = getCliApiUrl();
  if (cliArg) return normalizeUrl(cliArg);

  // 2. Explicit environment variables (FINLAYER_API_URL or API_URL) - internal dev
  const envVar = process.env.FINLAYER_API_URL || process.env.API_URL;
  if (envVar) return normalizeUrl(envVar);

  // 3. Search for config files or .env files in candidates (internal dev)
  const candidateDirs: string[] = [];
  try {
    const isPackaged = app?.isPackaged || Boolean((process as any).pkg);
    if (isPackaged) {
      candidateDirs.push(path.dirname(process.execPath));
    }
  } catch {}
  try {
    candidateDirs.push(app.getPath("userData"));
  } catch {}
  candidateDirs.push(process.cwd());

  for (const dir of candidateDirs) {
    for (const fileName of ["config.json", "finlayer.config.json"]) {
      const fullPath = path.join(dir, fileName);
      const json = parseJsonConfig(fullPath);
      const url = json.FINLAYER_API_URL || json.apiUrl || json.api_url || json.API_URL;
      if (url && typeof url === "string" && url.trim()) {
        return normalizeUrl(url);
      }
    }

    const envPath = path.join(dir, ".env");
    const envFile = parseEnvFile(envPath);
    const envUrl = envFile.FINLAYER_API_URL || envFile.API_URL;
    if (envUrl && typeof envUrl === "string" && envUrl.trim()) {
      return normalizeUrl(envUrl);
    }
  }

  // 4. Production flag (e.g. FINLAYER_ENV=production)
  if (process.env.FINLAYER_ENV === "production") {
    return PRODUCTION_API_URL;
  }

  // 5. Staging build default
  return STAGING_API_URL;
}

const API_URL = resolveInitialApiUrl();
const TALLY_URL = process.env.TALLY_URL || "http://127.0.0.1:9000";

let mainWindow: BrowserWindow | null = null;
let jobWorkerHandle: JobWorkerHandle | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

function getStateFilePath(): string {
  try {
    const userData = app.getPath("userData");
    return path.join(userData, "connector-state.json");
  } catch {
    return path.join(process.cwd(), "connector-state.json");
  }
}

async function loadLocalState(): Promise<ConnectorState> {
  const filePath = getStateFilePath();
  try {
    if (existsSync(filePath)) {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as ConnectorState;
    }
  } catch (e) {
    console.warn("Could not read local state file:", e);
  }

  // First run initial state
  const deviceId = `win-${crypto.randomUUID()}`;
  const initialState: ConnectorState = {
    deviceId,
    connectorId: "",
    registeredAt: new Date().toISOString(),
    deviceName: os.hostname() || "Windows-PC",
    operatingSystem: "Windows 11 / 10",
    setupStatus: "REGISTERED",
  };

  await saveLocalState(initialState);
  return initialState;
}

async function saveLocalState(state: ConnectorState): Promise<void> {
  const filePath = getStateFilePath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save local state:", e);
  }
}

function configureConnector(state?: ConnectorState) {
  connectorConfig.apiUrl = API_URL;
  connectorConfig.tallyUrl = TALLY_URL;
  if (state?.tallyCompanyName) {
    connectorConfig.companyName = state.tallyCompanyName;
  }
}

function startBackgroundServices(connectorId: string) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (jobWorkerHandle) jobWorkerHandle.stop();

  // 1. Periodic heartbeat every 30s
  heartbeatTimer = setInterval(async () => {
    try {
      await sendHeartbeatToApi(connectorId);
    } catch {}
  }, 30000);

  // 2. Start sync job worker
  jobWorkerHandle = startJobWorker(connectorId, 4000);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 740,
    minHeight: 600,
    title: "FinLayer — Windows Connector",
    backgroundColor: "#070d19",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("❌ Renderer load failed:", errorCode, errorDescription);
  });

  mainWindow.webContents.on("console-message", (event: any, ...args: any[]) => {
    const msg = typeof event?.message === "string" ? event.message : args[1] || args[0] || "";
    console.log(`[Renderer] ${msg}`);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (process.env.TEST_VERIFY === "1") {
      console.log("✓ TEST_VERIFY: Main process started, BrowserWindow ready-to-show, renderer loaded");
      mainWindow?.webContents.executeJavaScript(`
        const btn = document.getElementById("btn-start-setup");
        if (btn) {
          btn.click();
        }
      `);
      setTimeout(() => app.quit(), 1000);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// 1. Get Initial App State
ipcMain.handle("finlayer:get-initial-state", async () => {
  const state = await loadLocalState();
  configureConnector(state);

  return {
    success: true,
    state,
    tallyUrl: TALLY_URL,
  };
});

// 2. Detect TallyPrime on http://127.0.0.1:9000
ipcMain.handle("finlayer:detect-tally", async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(TALLY_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Company</ID></HEADER><BODY><DESC></DESC></BODY></ENVELOPE>`,
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeout);

    const connected = Boolean(res && (res.ok || res.status === 200 || res.status === 400));
    return {
      connected,
      url: TALLY_URL,
      statusText: connected ? "Connected" : "Not Connected",
    };
  } catch {
    return {
      connected: false,
      url: TALLY_URL,
      statusText: "Not Connected",
    };
  }
});

// 3. Fetch Tally Companies using existing company-service
ipcMain.handle("finlayer:fetch-tally-companies", async () => {
  try {
    const state = await loadLocalState();
    const companies: TallyCompany[] = await fetchCompaniesFromTally(TALLY_URL);

    // If connector is registered with API, report discovery
    if (state.connectorId) {
      await reportTallyConnected(state.connectorId).catch(() => {});
      if (companies.length > 0) {
        await reportTallyCompanies(state.connectorId, companies).catch(() => {});
      }
    }

    return {
      success: true,
      companies,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      companies: [],
      error: msg,
    };
  }
});

// 4. Register Connector & Select Company
ipcMain.handle("finlayer:select-company", async (_event, companyName: string) => {
  try {
    const state = await loadLocalState();
    configureConnector(state);

    // 1. Ensure registered with API
    if (!state.connectorId) {
      const reg = await registerConnectorWithApi({
        deviceId: state.deviceId,
        deviceName: state.deviceName || "Windows-PC",
        operatingSystem: "Windows 11 / 10",
      });
      state.connectorId = reg.connectorId;
      state.setupStatus = "REGISTERED";
      await saveLocalState(state);
    }

    // 2. Select Company
    const selection = await selectCompanyForConnector(state.connectorId, companyName);
    state.companyId = selection.companyId;
    state.tallyCompanyName = companyName;
    state.setupStatus = "WAITING_FOR_GOOGLE";
    await saveLocalState(state);

    configureConnector(state);

    return {
      success: true,
      companyId: state.companyId,
      connectorId: state.connectorId,
      companyName,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: msg,
    };
  }
});

// 5. Start Google OAuth in default browser
ipcMain.handle("finlayer:start-google-auth", async (_event, companyId: string) => {
  const url = `${API_URL}/google/connect/${companyId}`;
  await shell.openExternal(url);
  return { success: true, url };
});

// 5b. Mock Google Connect for 1-click test/development
ipcMain.handle("finlayer:mock-connect-google", async (_event, companyId: string) => {
  try {
    const res = await fetch(`${API_URL}/google/mock-connect/${companyId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// 6. Check Google Connection Status
ipcMain.handle("finlayer:check-google-status", async (_event, companyId: string) => {
  try {
    const res = await fetch(`${API_URL}/google/status/${companyId}`);
    if (!res.ok) return { connected: false };
    const data = (await res.json()) as { connected: boolean; connection?: any };
    return {
      connected: Boolean(data.connected),
      connection: data.connection || null,
    };
  } catch {
    return { connected: false };
  }
});

// 7. Complete Setup & Start Background Worker
ipcMain.handle("finlayer:complete-setup", async () => {
  const state = await loadLocalState();
  state.setupStatus = "ACTIVE";
  await saveLocalState(state);

  configureConnector(state);
  if (state.connectorId) {
    startBackgroundServices(state.connectorId);
  }

  return { success: true };
});

// 8. Open Dashboard
ipcMain.handle("finlayer:open-dashboard", async () => {
  await shell.openExternal(`${API_URL}/dashboard`);
  return { success: true };
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const state = await loadLocalState();
  if (state.connectorId && state.setupStatus === "ACTIVE") {
    configureConnector(state);
    startBackgroundServices(state.connectorId);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
