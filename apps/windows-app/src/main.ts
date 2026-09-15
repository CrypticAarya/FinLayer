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
const DEFAULT_UPDATE_URL = "https://github.com/CrypticAarya/FinLayer/releases";

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

  // 5. Default API URL (localhost)
  return "http://127.0.0.1:4000";
}

function resolveUpdateUrl(): string {
  if (process.env.FINLAYER_UPDATE_URL && process.env.FINLAYER_UPDATE_URL.trim()) {
    return normalizeUrl(process.env.FINLAYER_UPDATE_URL.trim());
  }
  return DEFAULT_UPDATE_URL;
}

function isDemoMode(): boolean {
  if (process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1") {
    return true;
  }
  if (process.env.DEMO_MODE === "false" || process.env.DEMO_MODE === "0") {
    return false;
  }
  return true; // Default to demo mode for seamless founder demo
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
configureConnector();

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

let testFlowState: ConnectorState | null = null;

async function loadLocalState(): Promise<ConnectorState> {
  if (process.env.TEST_FLOW === "1" && !testFlowState) {
    testFlowState = {
      deviceId: "win-test-flow-" + Date.now(),
      connectorId: "",
      registeredAt: new Date().toISOString(),
      deviceName: "Windows-Test-PC",
      operatingSystem: "Windows 11 / 10",
      setupStatus: "REGISTERED",
    };
    return testFlowState;
  }
  if (process.env.TEST_FLOW === "1" && testFlowState) {
    return testFlowState;
  }

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
  if (process.env.TEST_FLOW === "1") {
    testFlowState = state;
  }
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

  const customUpdateUrl = process.env.FINLAYER_UPDATE_URL?.trim();
  if (customUpdateUrl) {
    console.log(`[AutoUpdater] Configured custom update URL: ${customUpdateUrl}`);
    try {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: customUpdateUrl,
      });
    } catch (err) {
      console.warn("[AutoUpdater] Error setting custom feed URL:", err);
    }
  } else {
    console.log(`[AutoUpdater] Configured GitHub Releases update provider: CrypticAarya/FinLayer`);
    try {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "CrypticAarya",
        repo: "FinLayer",
      });
    } catch (err) {
      console.warn("[AutoUpdater] Error setting GitHub feed URL:", err);
    }
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

  // Enable opening DevTools via F12, Ctrl+Shift+I, or if FINLAYER_DEBUG / --devtools is set
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (process.env.FINLAYER_DEBUG === "1" || process.argv.includes("--devtools")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();

    // Trigger silent background update check on app startup (if not in automated testing mode)
    if (process.env.TEST_VERIFY !== "1" && process.env.TEST_UPDATE !== "1") {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.log("[AutoUpdater] Initial silent check skipped:", err.message);
        });
      }, 3000);
    }

    if (process.env.TEST_UPDATE === "1") {
      console.log("✓ TEST_UPDATE: Running auto-update verification test");
      isSetupActive = true;
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          console.error("[AutoUpdater] Check failed:", err);
        });
      }, 500);

      setTimeout(async () => {
        const bannerState = await mainWindow?.webContents.executeJavaScript(`
          (() => {
            const banner = document.getElementById("update-banner");
            const ver = document.getElementById("update-banner-version");
            return {
              display: banner ? banner.style.display : "not found",
              versionText: ver ? ver.textContent : ""
            };
          })()
        `);
        console.log("[TEST_UPDATE Result] Banner state:", JSON.stringify(bannerState));
        setTimeout(() => app.quit(), 500);
      }, 7000);
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

    if (process.env.TEST_FLOW === "1") {
      console.log("✓ TEST_FLOW: Starting automated end-to-end flow test");
      mainWindow?.webContents.executeJavaScript(`
        (async () => {
          console.log("[Preload Bridge] Object.keys(window.finlayer): " + JSON.stringify(Object.keys(window.finlayer || {})));

          console.log("[Test Flow] 1. Clicking Start Setup...");
          document.getElementById("btn-start-setup")?.click();

          console.log("[Test Flow] Waiting for company detection...");
          let companyBtn = null;
          for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 500));
            companyBtn = document.getElementById("btn-continue-company");
            const foundView = document.getElementById("company-found-view");
            if (foundView && foundView.style.display !== "none" && companyBtn) {
              console.log("[Test Flow] Company found view is visible!");
              break;
            }
          }

          console.log("[Test Flow] 2. Company detected! Clicking Continue to Google step...");
          companyBtn?.click();

          await new Promise(r => setTimeout(r, 1200));
          console.log("[Test Flow] 3. In Google Sheet step. Clicking Connect Google Account...");
          const googleBtn = document.getElementById("btn-connect-google");
          if (googleBtn) {
            googleBtn.click();
          } else {
            console.error("[Test Flow] btn-connect-google not found!");
          }

          await new Promise(r => setTimeout(r, 2000));
          console.log("[Test Flow] Complete flow verification finished!");
        })();
      `);
      setTimeout(() => {
        console.log("✓ TEST_FLOW completed");
        app.quit();
      }, 15000);
    }

    if (process.env.TEST_FALLBACK === "1") {
      console.log("✓ TEST_FALLBACK: Testing UI fallback when companyId is missing");
      mainWindow?.webContents.executeJavaScript(`
        (async () => {
          const googleBtn = document.getElementById("btn-connect-google");
          if (googleBtn) {
            googleBtn.click();
          }
          await new Promise(r => setTimeout(r, 600));
          const errEl = document.getElementById("google-error-message");
          console.log("[Fallback Result] Display style: " + errEl?.style.display + ", Text: " + errEl?.textContent?.trim());
        })();
      `);
      setTimeout(() => {
        console.log("✓ TEST_FALLBACK completed");
        app.quit();
      }, 3000);
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
    demoMode: isDemoMode(),
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

    // Ensure registered with API
    if (!state.connectorId) {
      try {
        console.log(`[IPC] Registering connector with API at ${API_URL}...`);
        const reg = await registerConnectorWithApi({
          deviceId: state.deviceId,
          deviceName: state.deviceName || "Windows-PC",
          operatingSystem: "Windows 11 / 10",
        });
        state.connectorId = reg.connectorId;
        state.setupStatus = "REGISTERED";
        await saveLocalState(state);
        console.log(`[IPC] Connector registered: ${state.connectorId}`);
      } catch (e) {
        console.warn("[IPC] API registration error:", e);
      }
    }

    // Report discovery to API and select company
    if (state.connectorId) {
      await reportTallyConnected(state.connectorId).catch(() => {});
      await reportTallyCompanies(state.connectorId, [{ name: companyName }]).catch(() => {});

      // Automatically map company
      try {
        console.log(`[IPC] Selecting company "${companyName}" for connector "${state.connectorId}"...`);
        const selection = await selectCompanyForConnector(state.connectorId, companyName);
        console.log(`[IPC] selectCompanyForConnector returned:`, selection);
        if (selection && selection.companyId) {
          state.companyId = selection.companyId;
          state.setupStatus = "WAITING_FOR_GOOGLE";
          await saveLocalState(state);
        }
      } catch (e) {
        console.warn("[IPC] API company mapping error:", e);
      }
    }

    await saveLocalState(state);
    configureConnector(state);

    console.log("[IPC] finlayer:fetch-active-company returning:", {
      success: true,
      companyName,
      companyId: state.companyId,
      connectorId: state.connectorId,
    });

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

// 5. Start Google OAuth Flow (or Direct Demo Sheet Connection)
ipcMain.handle("finlayer:start-google-auth", async (_event, companyId: string) => {
  console.log("[MAIN] start-google-auth called", companyId);

  // If companyId was not passed from renderer, recover from persistent local state
  if (!companyId) {
    const state = await loadLocalState();
    if (state.companyId) {
      companyId = state.companyId;
      console.log("[MAIN] Recovered companyId from persistent state:", companyId);
    } else if (state.connectorId && state.tallyCompanyName) {
      try {
        const selection = await selectCompanyForConnector(state.connectorId, state.tallyCompanyName);
        if (selection && selection.companyId) {
          state.companyId = selection.companyId;
          companyId = selection.companyId;
          await saveLocalState(state);
          console.log("[MAIN] Dynamically mapped company and saved state:", companyId);
        }
      } catch (e) {
        console.warn("[MAIN] Dynamic company selection failed:", e);
      }
    }
  }

  if (!companyId) {
    console.error("[MAIN] Google auth failed: Company ID missing");
    return {
      success: false,
      error: "Please retry company detection",
    };
  }

  // 1. In DEMO_MODE, bypass Google OAuth login and connect demo Google Sheet directly
  if (isDemoMode()) {
    console.log(`[DEMO_MODE] Connecting demo Google Sheet automatically without OAuth for companyId: ${companyId}`);
    try {
      const demoRes = await fetch(`${API_URL}/google/demo-connect/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await demoRes.json()) as any;
      console.log("[DEMO_MODE] Demo sheet connection established:", data);
      return {
        success: true,
        connected: true,
        demoMode: true,
        spreadsheetId: data.spreadsheetId,
        spreadsheetUrl: data.spreadsheetUrl,
      };
    } catch (err) {
      console.warn("[DEMO_MODE] Automatic demo-connect failed, falling back to browser connect:", err);
    }
  }

  // 2. Production Google OAuth Flow (untouched for future production)
  const oauthUrl = `${API_URL}/google/connect/${companyId}`;
  console.log(`Opening browser:\n${oauthUrl}`);

  try {
    await shell.openExternal(oauthUrl);
    return { success: true, url: oauthUrl, demoMode: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MAIN] shell.openExternal failed: ${msg}`);
    return { success: false, error: msg };
  }
});

// 5b. Get Sync Progress Status (for demo flow sync confirmation)
ipcMain.handle("finlayer:get-sync-status", async (_event, companyId: string) => {
  try {
    const res = await fetch(`${API_URL}/dashboard/financial-summary/${companyId}`);
    if (!res.ok) return { completed: false };
    const data = (await res.json()) as any;
    const hasSyncHistory = Boolean(data.company?.syncHistories?.length || data.lastSync);
    return {
      completed: Boolean(data.success && hasSyncHistory),
      summary: data.summary || null,
      lastSync: data.lastSync || null,
    };
  } catch {
    return { completed: false };
  }
});

// 6. Check Google Connection Status
ipcMain.handle("finlayer:check-google-status", async (_event, companyId: string) => {
  if (!companyId) {
    const state = await loadLocalState();
    if (state.companyId) {
      companyId = state.companyId;
    }
  }

  console.log("[WINDOWS] Checking Google status");
  console.log(`[WINDOWS] Company ID: ${companyId}`);

  try {
    const res = await fetch(`${API_URL}/google/status/${companyId}`);
    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.log(`[WINDOWS] Google connection response: HTTP ${res.status} ${errorText}`);
      return { connected: false, companyId };
    }
    const data = (await res.json()) as { connected: boolean; companyId?: string; email?: string; connection?: any; demoMode?: boolean };
    console.log("[WINDOWS] Google connection response:", JSON.stringify(data));
    return {
      connected: Boolean(data.connected),
      demoMode: Boolean(data.demoMode ?? isDemoMode()),
      companyId: data.companyId || companyId,
      email: data.email || data.connection?.googleEmail || null,
      connection: data.connection || null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[WINDOWS] Google connection response: error - ${msg}`);
    return { connected: false, error: msg };
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

    // Trigger an immediate initial sync job to sync Tally data to Google Sheet
    try {
      const syncRes = await fetch(`${API_URL}/sync/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId: state.connectorId,
          type: "FINANCIAL_DATA",
        }),
      });
      if (syncRes.ok) {
        console.log(`[WINDOWS] Triggered initial FINANCIAL_DATA sync job for connector: ${state.connectorId}`);
      }
    } catch (e) {
      console.warn("[WINDOWS] Could not trigger initial sync job:", e);
    }
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
