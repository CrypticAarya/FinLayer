import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { autoUpdater } from "electron-updater";

// Reuse existing connector services and types
import {
  fetchActiveCompany,
  fetchCompaniesFromTally,
  getCurrentCompanyRequest,
  getSimpleListOfCompaniesRequest,
  type TallyCompany,
} from "../../connector/src/tally/company-service.js";
import {
  registerConnectorWithApi,
  selectCompanyForConnector,
  sendHeartbeatToApi,
  reportTallyConnected,
  reportTallyCompanies,
  CONNECTOR_VERSION,
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
const DEFAULT_UPDATE_URL = "https://updates.finlayer.com/finlayer";

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
  } catch (err) {
    console.warn("Could not parse .env file:", err);
  }
  return result;
}

function resolveInitialApiUrl(): string {
  // 1. Command-line argument: --api-url=... or --api-url ...
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--api-url=")) {
      const val = arg.split("=")[1];
      if (val) return normalizeUrl(val);
    }
    if (arg === "--api-url" && process.argv[i + 1]) {
      return normalizeUrl(process.argv[i + 1]);
    }
  }

  // 2. Environment variable: FINLAYER_API_URL
  if (process.env.FINLAYER_API_URL && process.env.FINLAYER_API_URL.trim()) {
    return normalizeUrl(process.env.FINLAYER_API_URL.trim());
  }

  // 3. Local/Packaged Configuration files
  const searchDirs = [
    process.cwd(),
    __dirname,
    path.join(__dirname, ".."),
    path.join(__dirname, "../.."),
  ];

  try {
    const userData = app.getPath("userData");
    if (userData) searchDirs.unshift(userData);
  } catch {}

  // Check config.json / config.local.json
  for (const dir of searchDirs) {
    for (const name of ["config.json", "config.local.json"]) {
      const p = path.join(dir, name);
      if (existsSync(p)) {
        try {
          const content = JSON.parse(readFileSync(p, "utf-8"));
          if (content.apiUrl && typeof content.apiUrl === "string") {
            return normalizeUrl(content.apiUrl);
          }
          if (content.FINLAYER_API_URL && typeof content.FINLAYER_API_URL === "string") {
            return normalizeUrl(content.FINLAYER_API_URL);
          }
        } catch {}
      }
    }
  }

  // Check .env / .env.local
  for (const dir of searchDirs) {
    for (const name of [".env", ".env.local"]) {
      const p = path.join(dir, name);
      if (existsSync(p)) {
        const envVars = parseEnvFile(p);
        if (envVars.FINLAYER_API_URL) {
          return normalizeUrl(envVars.FINLAYER_API_URL);
        }
      }
    }
  }

  // 4. Production flag (e.g. FINLAYER_ENV=production)
  if (process.env.FINLAYER_ENV === "production") {
    return PRODUCTION_API_URL;
  }

  // 5. Staging build default
  return STAGING_API_URL;
}

function resolveUpdateUrl(): string {
  if (process.env.FINLAYER_UPDATE_URL && process.env.FINLAYER_UPDATE_URL.trim()) {
    return normalizeUrl(process.env.FINLAYER_UPDATE_URL.trim());
  }
  return DEFAULT_UPDATE_URL;
}

function resolveInitialTallyUrl(): string {
  // 1. Command-line argument: --tally-url=... or --tally-url ...
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--tally-url=")) {
      const val = arg.split("=")[1];
      if (val) return normalizeUrl(val);
    }
    if (arg === "--tally-url" && process.argv[i + 1]) {
      return normalizeUrl(process.argv[i + 1]);
    }
  }

  // 2. Environment variable: TALLY_URL
  if (process.env.TALLY_URL && process.env.TALLY_URL.trim()) {
    return normalizeUrl(process.env.TALLY_URL.trim());
  }

  // 3. Local/Packaged Configuration files
  const searchDirs = [
    process.cwd(),
    __dirname,
    path.join(__dirname, ".."),
    path.join(__dirname, "../.."),
  ];

  try {
    const userData = app.getPath("userData");
    if (userData) searchDirs.unshift(userData);
  } catch {}

  // Check config.json / config.local.json
  for (const dir of searchDirs) {
    for (const name of ["config.json", "config.local.json"]) {
      const p = path.join(dir, name);
      if (existsSync(p)) {
        try {
          const content = JSON.parse(readFileSync(p, "utf-8"));
          if (content.tallyUrl && typeof content.tallyUrl === "string") {
            return normalizeUrl(content.tallyUrl);
          }
          if (content.TALLY_URL && typeof content.TALLY_URL === "string") {
            return normalizeUrl(content.TALLY_URL);
          }
        } catch {}
      }
    }
  }

  // Check .env / .env.local
  for (const dir of searchDirs) {
    for (const name of [".env", ".env.local"]) {
      const p = path.join(dir, name);
      if (existsSync(p)) {
        const envVars = parseEnvFile(p);
        if (envVars.TALLY_URL) {
          return normalizeUrl(envVars.TALLY_URL);
        }
      }
    }
  }

  return "http://127.0.0.1:9000";
}

const API_URL = resolveInitialApiUrl();
let activeTallyUrl = resolveInitialTallyUrl();

let mainWindow: BrowserWindow | null = null;
let jobWorkerHandle: JobWorkerHandle | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

// ─── Separate User State Storage (%APPDATA%/FinLayer/) ─────────────────────────

function getUserDataDir(): string {
  try {
    return app.getPath("userData");
  } catch {
    const base = process.env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
    return path.join(base, "FinLayer");
  }
}

function getStateFilePath(): string {
  return path.join(getUserDataDir(), "connector-state.json");
}

function getUpdateStateFilePath(): string {
  return path.join(getUserDataDir(), "update-state.json");
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

interface UpdateState {
  lastCheck: string;
  availableVersion?: string;
  downloadedVersion?: string;
  status: "IDLE" | "CHECKING" | "AVAILABLE" | "DOWNLOADING" | "DOWNLOADED" | "ERROR";
  error?: string;
}

async function loadUpdateState(): Promise<UpdateState> {
  const filePath = getUpdateStateFilePath();
  try {
    if (existsSync(filePath)) {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as UpdateState;
    }
  } catch {}
  return { lastCheck: "", status: "IDLE" };
}

async function saveUpdateState(state: Partial<UpdateState>): Promise<void> {
  const filePath = getUpdateStateFilePath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const current = await loadUpdateState();
    const merged = { ...current, ...state };
    await fs.writeFile(filePath, JSON.stringify(merged, null, 2), "utf-8");
  } catch (e) {
    console.error("[AutoUpdater] Failed to save update state:", e);
  }
}

// ─── Auto-Updater Engine ──────────────────────────────────────────────────────

let pendingDownloadedUpdate: { version: string } | null = null;
let isSetupActive = false;

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const updateUrl = resolveUpdateUrl();
  console.log(`[AutoUpdater] Configured update URL: ${updateUrl}`);

  try {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: updateUrl,
    });
  } catch (err) {
    console.warn("[AutoUpdater] Error setting feed URL:", err);
  }

  autoUpdater.on("checking-for-update", () => {
    console.log("[AutoUpdater] Checking for updates silently...");
    saveUpdateState({ status: "CHECKING", lastCheck: new Date().toISOString() });
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[AutoUpdater] Update available: v${info.version}`);
    saveUpdateState({ status: "AVAILABLE", availableVersion: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    console.log(`[AutoUpdater] App is up to date (current: v${app.getVersion()})`);
    saveUpdateState({ status: "IDLE" });
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[AutoUpdater] Download progress: ${Math.round(progress.percent)}%`);
    saveUpdateState({ status: "DOWNLOADING" });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[AutoUpdater] Update downloaded: v${info.version}`);
    saveUpdateState({
      status: "DOWNLOADED",
      downloadedVersion: info.version,
    });

    // Only show update notification after setup is completed!
    if (isSetupActive && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("finlayer:update-downloaded", { version: info.version });
    } else {
      pendingDownloadedUpdate = { version: info.version };
      console.log("[AutoUpdater] Onboarding in progress: update notification deferred until setup completes.");
    }
  });

  autoUpdater.on("error", (err) => {
    console.log("[AutoUpdater] Silent error during update check/download:", err?.message || err);
    saveUpdateState({ status: "ERROR", error: err?.message || String(err) });
  });
}

function configureConnector(state?: ConnectorState) {
  connectorConfig.apiUrl = API_URL;
  connectorConfig.tallyUrl = activeTallyUrl;
  if (state?.tallyCompanyName) {
    connectorConfig.companyName = state.tallyCompanyName;
  }
}

function startBackgroundServices(connectorId: string) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (jobWorkerHandle) jobWorkerHandle.stop();

  // 1. Periodic heartbeat every 30s with connector version
  heartbeatTimer = setInterval(async () => {
    try {
      await sendHeartbeatToApi(connectorId, { version: CONNECTOR_VERSION });
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

    // Trigger silent background update check on app startup (if not in automated testing mode)
    if (process.env.TEST_VERIFY !== "1") {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.log("[AutoUpdater] Initial silent check skipped:", err.message);
        });
      }, 3000);
    }

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
  if (state.setupStatus === "ACTIVE") {
    isSetupActive = true;
  }
  configureConnector(state);

  return {
    success: true,
    state,
    tallyUrl: activeTallyUrl,
    appVersion: app.getVersion(),
    connectorVersion: CONNECTOR_VERSION,
  };
});

// 2. Detect TallyPrime on activeTallyUrl (with localhost/127.0.0.1 fallback probe)
ipcMain.handle("finlayer:detect-tally", async () => {
  const candidateUrls = [activeTallyUrl];
  if (activeTallyUrl.includes("127.0.0.1")) {
    candidateUrls.push(activeTallyUrl.replace("127.0.0.1", "localhost"));
  } else if (activeTallyUrl.includes("localhost")) {
    candidateUrls.push(activeTallyUrl.replace("localhost", "127.0.0.1"));
  }

  for (const probeUrl of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(probeUrl, {
        method: "POST",
        headers: { "Content-Type": "text/xml" },
        body: getSimpleListOfCompaniesRequest(),
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeout);

      const connected = Boolean(res && (res.ok || res.status === 200 || res.status === 400));
      if (connected) {
        activeTallyUrl = probeUrl;
        connectorConfig.tallyUrl = activeTallyUrl;
        return {
          connected: true,
          url: activeTallyUrl,
          statusText: "Connected",
        };
      }
    } catch {}
  }

  return {
    connected: false,
    url: activeTallyUrl,
    statusText: "Not Connected",
  };
});

// 2b. Automatically detect active company and auto-map
ipcMain.handle("finlayer:fetch-active-company", async () => {
  try {
    console.log(`[IPC] finlayer:fetch-active-company called. Probing Tally URL: ${activeTallyUrl}`);
    let active = await fetchActiveCompany(activeTallyUrl);

    // If active company wasn't found and we're on localhost/127.0.0.1, try alternative
    if (!active || !active.name) {
      const alternate = activeTallyUrl.includes("127.0.0.1")
        ? activeTallyUrl.replace("127.0.0.1", "localhost")
        : activeTallyUrl.includes("localhost")
        ? activeTallyUrl.replace("localhost", "127.0.0.1")
        : null;
      if (alternate) {
        console.log(`[IPC] Attempting alternate Tally URL: ${alternate}`);
        active = await fetchActiveCompany(alternate);
        if (active && active.name) {
          activeTallyUrl = alternate;
          connectorConfig.tallyUrl = activeTallyUrl;
        }
      }
    }

    if (!active || !active.name) {
      console.log("[IPC] No active company detected across all Tally strategies.");
      return {
        success: false,
        noCompanyOpen: true,
      };
    }

    const companyName = active.name;
    console.log(`[IPC] Active company successfully detected: "${companyName}"`);

    const state = await loadLocalState();
    state.tallyCompanyName = companyName;
    configureConnector(state);

    // Ensure registered with API (graceful if API has network latency)
    if (!state.connectorId) {
      try {
        const reg = await registerConnectorWithApi({
          deviceId: state.deviceId,
          deviceName: state.deviceName || "Windows-PC",
          operatingSystem: "Windows 11 / 10",
        });
        state.connectorId = reg.connectorId;
        state.setupStatus = "REGISTERED";
        await saveLocalState(state);
      } catch (e) {
        console.warn("[IPC] API registration postponed:", e);
      }
    }

    // Report discovery to API
    if (state.connectorId) {
      await reportTallyConnected(state.connectorId).catch(() => {});
      await reportTallyCompanies(state.connectorId, [{ name: companyName }]).catch(() => {});

      // Automatically map company
      try {
        const selection = await selectCompanyForConnector(state.connectorId, companyName);
        state.companyId = selection.companyId;
        state.setupStatus = "WAITING_FOR_GOOGLE";
      } catch (e) {
        console.warn("[IPC] API company mapping postponed:", e);
      }
    }

    await saveLocalState(state);
    configureConnector(state);

    return {
      success: true,
      companyName,
      companyId: state.companyId,
      connectorId: state.connectorId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[IPC] finlayer:fetch-active-company error:", msg);
    return {
      success: false,
      error: msg,
    };
  }
});

// 3. Fetch Tally Companies using existing company-service
ipcMain.handle("finlayer:fetch-tally-companies", async () => {
  try {
    const state = await loadLocalState();
    const companies: TallyCompany[] = await fetchCompaniesFromTally(activeTallyUrl);

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
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: msg,
    };
  }
});

// 5. Start Google OAuth Flow
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

  isSetupActive = true;
  configureConnector(state);
  if (state.connectorId) {
    startBackgroundServices(state.connectorId);
  }

  // If an update was downloaded during onboarding, notify user now that setup is complete
  if (pendingDownloadedUpdate && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("finlayer:update-downloaded", pendingDownloadedUpdate);
    pendingDownloadedUpdate = null;
  }

  return { success: true };
});

// 8. Open Dashboard
ipcMain.handle("finlayer:open-dashboard", async () => {
  await shell.openExternal(`${API_URL}/dashboard`);
  return { success: true };
});

// 9. Get App & Connector Version
ipcMain.handle("finlayer:get-app-version", async () => {
  return {
    appVersion: app.getVersion(),
    connectorVersion: CONNECTOR_VERSION,
    updateUrl: resolveUpdateUrl(),
  };
});

// 10. Manual Check for Updates
ipcMain.handle("finlayer:check-for-updates", async () => {
  try {
    const res = await autoUpdater.checkForUpdates();
    return {
      success: true,
      updateInfo: res?.updateInfo ?? null,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// 11. Restart and Install Update
ipcMain.handle("finlayer:restart-and-install", () => {
  console.log("[AutoUpdater] User requested restart and install. Applying update...");
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const state = await loadLocalState();
  if (state.setupStatus === "ACTIVE") {
    isSetupActive = true;
    if (state.connectorId) {
      configureConnector(state);
      startBackgroundServices(state.connectorId);
    }
  }

  setupAutoUpdater();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
