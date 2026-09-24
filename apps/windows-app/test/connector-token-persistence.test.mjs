import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distMainPath = path.resolve(__dirname, "../dist/main.js");

console.log("===================================================================");
console.log("   FINLAYER DESKTOP: CONNECTOR TOKEN PERSISTENCE TEST SUITE        ");
console.log("===================================================================\n");

// Ensure dist bundle exists
assert.ok(fs.existsSync(distMainPath), `dist/main.js must exist at ${distMainPath}`);

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finlayer-token-test-"));
  const testStatePath = path.join(tempDir, "connector-state.json");
  process.env.FINLAYER_STATE_PATH = testStatePath;

  const TEST_TOKEN = "fl_conn_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const TEST_CONNECTOR_ID = "cmufzr85100001mjqb6tmnfn4";
  const TEST_DEVICE_ID = "win-test-device-uuid-999";

  // ─── Setup Mock FinLayer API Server ─────────────────────────────────────────
  console.log("[Setup] Starting mock FinLayer API server...");
  let registeredConnectorPayload = null;

  const server = http.createServer(async (req, res) => {
    const url = req.url || "";
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    if (req.method === "POST" && url === "/connectors/register") {
      registeredConnectorPayload = JSON.parse(body || "{}");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          connectorId: TEST_CONNECTOR_ID,
          setupStatus: "REGISTERED",
          token: TEST_TOKEN,
        })
      );
      return;
    }

    if (req.method === "GET" && url.includes("/pending")) {
      const auth = req.headers["authorization"];
      if (!auth || !auth.startsWith("Bearer fl_conn_")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Missing or invalid Authorization header." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, job: null }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverPort = server.address().port;
  const mockApiUrl = `http://127.0.0.1:${serverPort}`;
  process.env.FINLAYER_API_URL = mockApiUrl;
  console.log(`  ✔ Mock FinLayer API listening on ${mockApiUrl}\n`);

  try {
    // ─── Setup Mock safeStorage (Windows DPAPI Simulation) ─────────────────────
    console.log("[Setup] Injecting mock safeStorage (Windows DPAPI emulation)...");
    globalThis.__mockSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (plaintext) => Buffer.from(`dpapi:${Buffer.from(plaintext).toString("base64")}`),
      decryptString: (buffer) => {
        const str = buffer.toString("utf-8");
        if (!str.startsWith("dpapi:")) {
          throw new Error("Invalid DPAPI ciphertext format");
        }
        return Buffer.from(str.slice(6), "base64").toString("utf-8");
      },
    };

    // Import main bundle
    const main = await import(distMainPath);
    const {
      saveLocalState,
      loadLocalState,
      tokenStorage,
      getStateFilePath,
      registerConnectorWithApi,
      setConnectorToken,
      getAuthHeaders,
      connectorConfig,
    } = main;

    assert.strictEqual(getStateFilePath(), testStatePath, "getStateFilePath must match FINLAYER_STATE_PATH");

    // ─── Test 1: Register Connector and Receive Token ──────────────────────────
    console.log("[Test 1] Registering connector with mock API...");
    connectorConfig.apiUrl = mockApiUrl;

    const initial = await loadLocalState();
    initial.deviceId = TEST_DEVICE_ID;
    initial.connectorId = "";
    await saveLocalState(initial);

    // Call registerConnectorWithApi
    const reg = await registerConnectorWithApi({
      deviceId: TEST_DEVICE_ID,
      deviceName: "Windows-Test-PC",
      operatingSystem: "Windows 11 / 10",
    });

    assert.strictEqual(reg.connectorId, TEST_CONNECTOR_ID, "Returned connectorId must match");
    assert.strictEqual(reg.token, TEST_TOKEN, "Returned token must match TEST_TOKEN");

    // Verify token was stored via safeStorage in test state file
    const postRegRaw = fs.readFileSync(testStatePath, "utf-8");
    const postRegState = JSON.parse(postRegRaw);
    assert.ok(postRegState.encryptedConnectorToken, "encryptedConnectorToken must exist in state file after registration");
    assert.ok(!postRegState.connectorToken, "Plaintext connectorToken must be wiped when safeStorage is available");
    console.log("  ✔ Connector registered and token securely encrypted with safeStorage (DPAPI).\n");

    // ─── Test 2: saveLocalState() Must NOT Overwrite encryptedConnectorToken ──
    console.log("[Test 2] Simulating post-registration saveLocalState (bug reproduction & fix validation)...");

    // This simulates the exact bug scenario:
    // main.ts holds an in-memory `state` object that lacks `encryptedConnectorToken`
    const inMemoryStateWithoutToken = {
      deviceId: TEST_DEVICE_ID,
      connectorId: reg.connectorId,
      setupStatus: "REGISTERED",
      registeredAt: new Date().toISOString(),
      schemaName: 1,
      // NOTE: encryptedConnectorToken is deliberately omitted here!
    };

    // Save state using saveLocalState
    await saveLocalState(inMemoryStateWithoutToken);

    // Read state from disk and verify token was PRESERVED
    const postSaveRaw = fs.readFileSync(testStatePath, "utf-8");
    const postSaveState = JSON.parse(postSaveRaw);

    assert.ok(
      postSaveState.encryptedConnectorToken,
      "CRITICAL: saveLocalState() must preserve encryptedConnectorToken even when in-memory state object omits it!"
    );
    assert.strictEqual(
      postSaveState.encryptedConnectorToken,
      postRegState.encryptedConnectorToken,
      "encryptedConnectorToken ciphertext must remain identical after saveLocalState()"
    );
    console.log("  ✔ encryptedConnectorToken was successfully preserved by saveLocalState().\n");

    // ─── Test 3: Subsequent Updates (Company Selection & Complete Setup) ───────
    console.log("[Test 3] Simulating subsequent state updates (selectCompany & completeSetup)...");
    postSaveState.companyId = "cmufzr96d00011mjq0zsuyt1g";
    postSaveState.tallyCompanyName = "HIMALAYA OVERSEAS NOIDA";
    postSaveState.setupStatus = "ACTIVE";

    // Create a state copy without token property to test multiple successive saves
    const anotherSaveState = {
      deviceId: postSaveState.deviceId,
      connectorId: postSaveState.connectorId,
      companyId: postSaveState.companyId,
      tallyCompanyName: postSaveState.tallyCompanyName,
      setupStatus: postSaveState.setupStatus,
    };

    await saveLocalState(anotherSaveState);

    const postActiveRaw = fs.readFileSync(testStatePath, "utf-8");
    const postActiveState = JSON.parse(postActiveRaw);
    assert.ok(postActiveState.encryptedConnectorToken, "encryptedConnectorToken must still exist after multiple saves");
    assert.strictEqual(postActiveState.setupStatus, "ACTIVE", "setupStatus must be ACTIVE");
    console.log("  ✔ Successive state updates correctly preserved encryptedConnectorToken.\n");

    // ─── Test 4: App Restart & Reload Flow ─────────────────────────────────────
    console.log("[Test 4] Simulating app restart: loading local state & decrypting token...");

    // 1. Wipe in-memory token cache to simulate fresh cold start
    setConnectorToken(null);

    // 2. Reload state from disk (as happens on app.whenReady())
    const reloadedState = await loadLocalState();
    assert.ok(reloadedState.encryptedConnectorToken, "Reloaded state must contain encryptedConnectorToken");
    assert.strictEqual(reloadedState.connectorId, TEST_CONNECTOR_ID, "Reloaded connectorId must match");
    assert.strictEqual(reloadedState.setupStatus, "ACTIVE", "Reloaded setupStatus must match");

    // 3. Retrieve token via tokenStorage provider (safeStorage.decryptString)
    const reloadedToken = await tokenStorage.getToken();
    assert.strictEqual(
      reloadedToken,
      TEST_TOKEN,
      "tokenStorage.getToken() on restart must successfully decrypt and return the original provisioned token!"
    );
    console.log("  ✔ App restart successfully loaded and decrypted the connector token.\n");

    // ─── Test 5: Verify Auth Header Dispatch ───────────────────────────────────
    console.log("[Test 5] Verifying API request authorization header dispatch...");
    const headers = await getAuthHeaders();
    assert.ok(headers["Authorization"], "Authorization header must be present");
    assert.strictEqual(
      headers["Authorization"],
      `Bearer ${TEST_TOKEN}`,
      "Authorization header must be 'Bearer fl_conn_...'"
    );

    // Test request to mock pending jobs endpoint with auth headers
    const pendingRes = await fetch(`${mockApiUrl}/sync/jobs/${TEST_CONNECTOR_ID}/pending`, {
      headers,
    });
    assert.strictEqual(pendingRes.status, 200, `Expected 200 OK from authenticated polling, got ${pendingRes.status}`);
    const pendingData = await pendingRes.json();
    assert.strictEqual(pendingData.success, true, "Polling request with authenticated header succeeded");
    console.log("  ✔ Polling endpoint authenticated successfully with Bearer token header.\n");

    // ─── Test 6: Fallback Plaintext Token Storage Preservation ────────────────
    console.log("[Test 6] Testing fallback token preservation (when safeStorage is unavailable)...");
    const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), "finlayer-fallback-test-"));
    const fallbackStatePath = path.join(fallbackDir, "connector-state.json");
    process.env.FINLAYER_STATE_PATH = fallbackStatePath;

    // Disable safeStorage encryption
    globalThis.__mockSafeStorage = {
      isEncryptionAvailable: () => false,
    };

    // Save fallback token
    await tokenStorage.setToken(TEST_TOKEN);
    const fbRaw1 = fs.readFileSync(fallbackStatePath, "utf-8");
    const fbState1 = JSON.parse(fbRaw1);
    assert.strictEqual(fbState1.connectorToken, TEST_TOKEN, "connectorToken must be stored in fallback state");

    // Overwrite with state object lacking connectorToken
    await saveLocalState({
      deviceId: "win-fallback-device",
      connectorId: "conn-fallback-1",
      setupStatus: "REGISTERED",
    });

    const fbRaw2 = fs.readFileSync(fallbackStatePath, "utf-8");
    const fbState2 = JSON.parse(fbRaw2);
    assert.strictEqual(
      fbState2.connectorToken,
      TEST_TOKEN,
      "saveLocalState must preserve connectorToken in fallback mode as well"
    );

    // Reload
    setConnectorToken(null);
    const fbReloadedToken = await tokenStorage.getToken();
    assert.strictEqual(fbReloadedToken, TEST_TOKEN, "Fallback token reloaded successfully on restart");
    console.log("  ✔ Fallback token preservation and reload verified.\n");

    console.log("===================================================================");
    console.log("   ALL CONNECTOR TOKEN PERSISTENCE TESTS PASSED (100% SUCCESS)    ");
    console.log("===================================================================\n");
  } finally {
    server.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
