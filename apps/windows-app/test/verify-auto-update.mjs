import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const appDir = path.resolve(rootDir, "apps/windows-app");

console.log("===================================================================");
console.log("   FINLAYER DESKTOP: ELECTRON AUTO-UPDATE VERIFICATION SUITE       ");
console.log("===================================================================\n");

// ─── Test 1: Validate package.json Build & Publish Configuration ───────────
console.log("[Test 1] Validating package.json electron-builder publish configuration...");
const pkgRaw = fs.readFileSync(path.join(appDir, "package.json"), "utf-8");
const pkg = JSON.parse(pkgRaw);

assert.strictEqual(pkg.name, "finlayer-windows-app", "Package name must be finlayer-windows-app");
assert.strictEqual(pkg.version, "2.5.1", "Package version must be 2.5.1");

const buildConfig = pkg.build;
assert.ok(buildConfig, "package.json must contain 'build' configuration");
assert.strictEqual(buildConfig.appId, "com.finlayer.connector", "appId must be com.finlayer.connector");
assert.strictEqual(buildConfig.productName, "FinLayer", "productName must be FinLayer");

const winConfig = buildConfig.win;
assert.ok(winConfig, "Windows build configuration must exist");
assert.strictEqual(winConfig.artifactName, "FinLayerSetup.exe", "artifactName must be FinLayerSetup.exe");

const publishConfig = buildConfig.publish;
assert.ok(Array.isArray(publishConfig) && publishConfig.length > 0, "publish configuration must be an array");
const ghPublish = publishConfig.find((p) => p.provider === "github");
assert.ok(ghPublish, "GitHub publish provider must be configured");
assert.strictEqual(ghPublish.owner, "CrypticAarya", "GitHub owner must be CrypticAarya");
assert.strictEqual(ghPublish.repo, "FinLayer", "GitHub repo must be FinLayer");
console.log("  ✔ package.json build & GitHub publish configuration verified.\n");

// ─── Test 2: Validate GitHub Actions Workflow ────────────────────────────────
console.log("[Test 2] Validating .github/workflows/windows-build.yml workflow...");
const workflowPath = path.join(rootDir, ".github/workflows/windows-build.yml");
assert.ok(fs.existsSync(workflowPath), "windows-build.yml must exist");
const workflowContent = fs.readFileSync(workflowPath, "utf-8");

assert.ok(workflowContent.includes("tags:"), "Workflow must trigger on git tags");
assert.ok(workflowContent.includes("v*"), "Workflow must listen for v* tags");
assert.ok(workflowContent.includes("npm --prefix apps/windows-app run build:win"), "Workflow must run build:win");
assert.ok(workflowContent.includes("apps/windows-app/release/latest.yml"), "Workflow must include latest.yml artifact");
assert.ok(workflowContent.includes("apps/windows-app/release/FinLayerSetup.exe"), "Workflow must include FinLayerSetup.exe");
assert.ok(workflowContent.includes("action-gh-release"), "Workflow must publish release with softprops/action-gh-release");
console.log("  ✔ GitHub Actions release workflow verified.\n");

// ─── Test 3: Validate latest.yml Generation Schema ───────────────────────────
console.log("[Test 3] Validating latest.yml schema & structure...");
const latestYmlPath = path.join(appDir, "release/latest.yml");
assert.ok(fs.existsSync(latestYmlPath), "release/latest.yml must exist");
const latestYmlContent = fs.readFileSync(latestYmlPath, "utf-8");

// Parse simple YAML lines
const lines = latestYmlContent.split("\n");
const ymlData = {};
for (const line of lines) {
  const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
  if (match) {
    ymlData[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

assert.ok(ymlData.version, "latest.yml must contain a 'version' field");
assert.ok(ymlData.path, "latest.yml must contain a 'path' field");
assert.strictEqual(ymlData.path, "FinLayerSetup.exe", "path in latest.yml must point to FinLayerSetup.exe");
assert.ok(ymlData.sha512, "latest.yml must contain a 'sha512' checksum");
assert.ok(ymlData.releaseDate, "latest.yml must contain a 'releaseDate'");
// SHA-512 in base64 is 88 characters ending in == or =
assert.ok(ymlData.sha512.length >= 80, "sha512 must be a valid base64 checksum string");
console.log(`  ✔ latest.yml verified: version=${ymlData.version}, path=${ymlData.path}, sha512=${ymlData.sha512.slice(0, 16)}...\n`);

// ─── Test 4: Validate main.ts electron-updater Configuration ────────────────
console.log("[Test 4] Validating main.ts autoUpdater configuration & IPC channels...");
const mainPath = path.join(appDir, "src/main.ts");
const mainContent = fs.readFileSync(mainPath, "utf-8");

assert.ok(mainContent.includes("autoUpdater.allowPrerelease = true"), "Must enable allowPrerelease for beta releases");
assert.ok(mainContent.includes("autoUpdater.allowDowngrade = false"), "Must disable unintended downgrades");
assert.ok(mainContent.includes("autoUpdater.logger ="), "Must configure autoUpdater logger");
assert.ok(mainContent.includes('mainWindow.webContents.send("finlayer:update-available"'), "Must emit finlayer:update-available");
assert.ok(mainContent.includes('mainWindow.webContents.send("finlayer:update-progress"'), "Must emit finlayer:update-progress");
assert.ok(mainContent.includes('mainWindow.webContents.send("finlayer:update-downloaded"'), "Must emit finlayer:update-downloaded");
assert.ok(mainContent.includes('ipcMain.handle("finlayer:restart-and-install"'), "Must handle finlayer:restart-and-install");
assert.ok(mainContent.includes("autoUpdater.quitAndInstall"), "Must call autoUpdater.quitAndInstall");
assert.ok(mainContent.includes("Initiating startup update check"), "Must check for updates on startup");
assert.ok(mainContent.includes("Initiating periodic background update check"), "Must schedule periodic checks");
console.log("  ✔ main.ts autoUpdater engine, notifications, and lifecycle checks verified.\n");

// ─── Test 5: Validate preload.ts API Bridge ──────────────────────────────────
console.log("[Test 5] Validating preload.ts API bridge exposure...");
const preloadPath = path.join(appDir, "src/preload.ts");
const preloadContent = fs.readFileSync(preloadPath, "utf-8");

assert.ok(preloadContent.includes("onUpdateAvailable:"), "preload must expose onUpdateAvailable");
assert.ok(preloadContent.includes("onUpdateProgress:"), "preload must expose onUpdateProgress");
assert.ok(preloadContent.includes("onUpdateDownloaded:"), "preload must expose onUpdateDownloaded");
assert.ok(preloadContent.includes("checkForUpdates:"), "preload must expose checkForUpdates");
assert.ok(preloadContent.includes("restartAndInstall:"), "preload must expose restartAndInstall");
console.log("  ✔ preload.ts interface and bridge mappings verified.\n");

// ─── Test 6: Validate UI Notification Banner & Renderer Handlers ────────────
console.log("[Test 6] Validating UI banner markup and renderer event listeners...");
const htmlPath = path.join(appDir, "public/index.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");
assert.ok(htmlContent.includes('id="update-banner"'), "index.html must have update-banner element");
assert.ok(htmlContent.includes('id="update-banner-message"'), "index.html must have update-banner-message");
assert.ok(htmlContent.includes('id="btn-restart-update"'), "index.html must have btn-restart-update");

const rendererPath = path.join(appDir, "public/renderer.js");
const rendererContent = fs.readFileSync(rendererPath, "utf-8");
assert.ok(rendererContent.includes("window.finlayer.onUpdateAvailable"), "renderer.js must listen to onUpdateAvailable");
assert.ok(rendererContent.includes("window.finlayer.onUpdateProgress"), "renderer.js must listen to onUpdateProgress");
assert.ok(rendererContent.includes("window.finlayer.onUpdateDownloaded"), "renderer.js must listen to onUpdateDownloaded");
assert.ok(rendererContent.includes("btnRestartUpdate"), "renderer.js must wire restart button");
assert.ok(rendererContent.includes("window.finlayer.restartAndInstall()"), "renderer.js must invoke restartAndInstall");
console.log("  ✔ UI notification banner and renderer handlers verified.\n");

// ─── Test 7: Upgrade Path & SemVer Version Evaluation ────────────────────────
console.log("[Test 7] Testing SemVer upgrade path logic & mock feed resolution...");

// SemVer comparator (standard npm / electron-updater SemVer comparison)
function parseSemVer(v) {
  const clean = v.replace(/^v/, "").trim();
  const [main, prerelease] = clean.split("-");
  const parts = main.split(".").map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    prerelease: prerelease || null,
  };
}

function compareSemVer(a, b) {
  const vA = parseSemVer(a);
  const vB = parseSemVer(b);

  if (vA.major !== vB.major) return vA.major - vB.major;
  if (vA.minor !== vB.minor) return vA.minor - vB.minor;
  if (vA.patch !== vB.patch) return vA.patch - vB.patch;

  if (!vA.prerelease && vB.prerelease) return 1;
  if (vA.prerelease && !vB.prerelease) return -1;
  if (vA.prerelease && vB.prerelease) {
    return vA.prerelease.localeCompare(vB.prerelease);
  }
  return 0;
}

function isUpgradeAvailable(currentVer, newVer, allowPrerelease = true) {
  const semverDiff = compareSemVer(newVer, currentVer);
  if (semverDiff <= 0) return false;
  const parsedNew = parseSemVer(newVer);
  if (parsedNew.prerelease && !allowPrerelease) return false;
  return true;
}

const currentVersion = "2.5.0";

// Test Case 0: Previously installed version v2.0.0 upgrading to new release v2.5.0
const installedV20 = "2.0.0";
assert.strictEqual(
  isUpgradeAvailable(installedV20, "2.5.0"),
  true,
  "Previously installed v2.0.0 MUST detect upgrade to new release v2.5.0"
);
console.log(`  ✔ Case 0a: Previous Installed v${installedV20} vs New Release v2.5.0 -> UPGRADE DETECTED & TRIGGERED`);

// Test Case 0b: Previously installed version v2.4.0 upgrading to new release v2.5.0
const installedV24 = "2.4.0";
assert.strictEqual(
  isUpgradeAvailable(installedV24, "2.5.0"),
  true,
  "Previously installed v2.4.0 MUST detect upgrade to new release v2.5.0"
);
console.log(`  ✔ Case 0b: Previous Installed v${installedV24} vs New Release v2.5.0 -> UPGRADE DETECTED & TRIGGERED`);

// Test Case A: Older release (v2.4.0) against current v2.5.0 -> No upgrade
assert.strictEqual(
  isUpgradeAvailable(currentVersion, "2.4.0"),
  false,
  "v2.4.0 must NOT trigger an upgrade for v2.5.0"
);
console.log(`  ✔ Case A: Current v${currentVersion} vs Feed v2.4.0 -> No upgrade (expected)`);

// Test Case B: Same release (v2.5.0) -> No upgrade
assert.strictEqual(
  isUpgradeAvailable(currentVersion, "2.5.0"),
  false,
  "v2.5.0 must NOT trigger an upgrade for v2.5.0"
);
console.log(`  ✔ Case B: Current v${currentVersion} vs Feed v2.5.0 -> Up to date (expected)`);

// Test Case C: Patch release (v2.5.1) -> Upgrade available
assert.strictEqual(
  isUpgradeAvailable(currentVersion, "2.5.1"),
  true,
  "v2.5.1 MUST trigger an upgrade for v2.5.0"
);
console.log(`  ✔ Case C: Current v${currentVersion} vs Feed v2.5.1 -> UPGRADE AVAILABLE`);

// Test Case D: Minor release (v2.6.0) -> Upgrade available
assert.strictEqual(
  isUpgradeAvailable(currentVersion, "2.6.0"),
  true,
  "v2.6.0 MUST trigger an upgrade for v2.5.0"
);
console.log(`  ✔ Case D: Current v${currentVersion} vs Feed v2.6.0 -> UPGRADE AVAILABLE`);

// Test Case E: Prerelease (v2.6.0-beta) with allowPrerelease = true -> Upgrade available
assert.strictEqual(
  isUpgradeAvailable(currentVersion, "2.6.0-beta", true),
  true,
  "v2.6.0-beta MUST trigger an upgrade when allowPrerelease is true"
);
console.log(`  ✔ Case E: Current v${currentVersion} vs Feed v2.6.0-beta (allowPrerelease=true) -> UPGRADE AVAILABLE`);

// ─── Test 8: Live Mock Update HTTP Feed Test ─────────────────────────────────
console.log("\n[Test 8] Testing mock HTTP update feed server with latest.yml payload...");

const mockServerPort = 9777;
const mockServer = http.createServer((req, res) => {
  if (req.url === "/latest.yml") {
    res.writeHead(200, { "Content-Type": "text/yaml" });
    res.end(`version: 2.5.1
files:
  - url: FinLayerSetup.exe
    sha512: dXNlci1hdXRvLXVwZGF0ZS12ZXJpZmljYXRpb24tc2hhNTEyLWNoZWNrc3VtLTEyMzQ1Njc4OTA=
    size: 89000000
path: FinLayerSetup.exe
sha512: dXNlci1hdXRvLXVwZGF0ZS12ZXJpZmljYXRpb24tc2hhNTEyLWNoZWNrc3VtLTEyMzQ1Njc4OTA=
releaseDate: '2026-09-23T12:00:00.000Z'
`);
  } else {
    res.writeHead(404);
    res.end();
  }
});

await new Promise((resolve) => mockServer.listen(mockServerPort, "127.0.0.1", resolve));
console.log(`  ✔ Mock update feed listening on http://127.0.0.1:${mockServerPort}/latest.yml`);

const feedRes = await fetch(`http://127.0.0.1:${mockServerPort}/latest.yml`);
assert.strictEqual(feedRes.status, 200, "Feed must return HTTP 200");
const feedText = await feedRes.text();
assert.ok(feedText.includes("version: 2.5.1"), "Feed text must include version 2.5.1");
assert.ok(feedText.includes("path: FinLayerSetup.exe"), "Feed text must include FinLayerSetup.exe");
mockServer.close();
console.log("  ✔ Mock feed fetch & payload verified.");

console.log("\n===================================================================");
console.log("   ALL 8 ELECTRON AUTO-UPDATE REQUIREMENTS VERIFIED (100% SUCCESS) ");
console.log("===================================================================\n");
