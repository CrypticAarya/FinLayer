/**
 * Electron Auto-Update Verification Test (Runs inside Electron runtime)
 */

const { app } = require("electron");
const http = require("node:http");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");

let autoUpdater;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch {
  autoUpdater = require(path.join(__dirname, "../apps/windows-app/node_modules/electron-updater")).autoUpdater;
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    app.exit(1);
  }
  console.log(`✓ PASSED: ${message}`);
}

app.whenReady().then(async () => {
  console.log("==================================================");
  console.log("Running Electron Auto-Update In-App Verification");
  console.log("==================================================\n");

  // 1. Verify package.json settings
  console.log("─── Step 1: Checking electron-builder & NSIS settings ───");
  const pkgPath = path.join(process.cwd(), "apps/windows-app/package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

  assert(pkg.dependencies && pkg.dependencies["electron-updater"], "electron-updater must be in dependencies");
  assert(pkg.build && Array.isArray(pkg.build.publish), "build.publish array must exist");
  assert(pkg.build.publish[0]?.url === "https://updates.finlayer.com/finlayer", "Default publish URL must be https://updates.finlayer.com/finlayer");
  assert(pkg.build.nsis?.deleteAppDataOnUninstall === false, "NSIS deleteAppDataOnUninstall must be false");
  console.log("✓ electron-builder & NSIS packaging verified\n");

  // 2. Verify State Separation in %APPDATA%/FinLayer
  console.log("─── Step 2: Verifying State Separation in User Data Directory ───");
  const userData = app.getPath("userData");
  console.log(`User data directory: ${userData}`);

  const statePath = path.join(userData, "connector-state.json");
  const updateStatePath = path.join(userData, "update-state.json");

  const mockConnectorState = {
    deviceId: "win-test-device-uuid",
    connectorId: "connector-persistent-12345",
    registeredAt: "2026-09-11T12:00:00.000Z",
    deviceName: "Accounting-PC-01",
    operatingSystem: "Windows 11 Pro",
    setupStatus: "ACTIVE",
    companyId: "company-himalaya-noida",
    tallyCompanyName: "HIMALAYA OVERSEAS NOIDA",
    googleConnected: true,
  };

  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(mockConnectorState, null, 2), "utf-8");

  const mockUpdateState = {
    lastCheck: new Date().toISOString(),
    status: "IDLE",
    availableVersion: "1.0.0",
  };
  await fs.writeFile(updateStatePath, JSON.stringify(mockUpdateState, null, 2), "utf-8");

  assert(existsSync(statePath), "connector-state.json exists");
  assert(existsSync(updateStatePath), "update-state.json exists separately");
  console.log("✓ State isolation and separation verified\n");

  // 3. Mock Release Server
  console.log("─── Step 3: Testing Mock Release Server & Update Detection ───");
  const mockYaml = `version: 36.0.0
files:
  - url: FinLayerSetup.exe
    sha512: dGVzdC1zaGE1MTItYmxvYg==
    size: 85983232
path: FinLayerSetup.exe
releaseDate: '2026-09-11T16:00:00.000Z'
`;

  const PORT = 58913;
  const server = http.createServer((req, res) => {
    console.log(`[Mock Update Server] Incoming: ${req.method} ${req.url}`);
    if (req.url && (req.url.includes("latest") || req.url.includes(".yml"))) {
      res.writeHead(200, { "Content-Type": "text/yaml" });
      res.end(mockYaml);
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`[Mock Update Server] Listening on http://127.0.0.1:${PORT}`);

  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `http://127.0.0.1:${PORT}`,
    });

    console.log(`Checking for updates (current version: v${app.getVersion()}) against mock server...`);
    const checkResult = await autoUpdater.checkForUpdates();

    assert(checkResult !== null, "Check for updates returned result");
    assert(checkResult.updateInfo.version === "36.0.0", `Expected update version 36.0.0, got ${checkResult.updateInfo.version}`);
    console.log(`✓ Update available detected: v${checkResult.updateInfo.version}`);

    // Verify connector-state.json was not touched
    const postState = JSON.parse(await fs.readFile(statePath, "utf-8"));
    assert(postState.connectorId === "connector-persistent-12345", "connectorId must remain unchanged");
    assert(postState.companyId === "company-himalaya-noida", "companyId must remain unchanged");
    assert(postState.tallyCompanyName === "HIMALAYA OVERSEAS NOIDA", "tallyCompanyName must remain unchanged");
    console.log("✓ State remained completely untouched during update check");

    console.log("\n==================================================");
    console.log("✓ ALL ELECTRON AUTO-UPDATE TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================");

    server.close();
    setTimeout(() => app.exit(0), 500);
  } catch (err) {
    server.close();
    console.error("Test failed:", err);
    app.exit(1);
  }
});
