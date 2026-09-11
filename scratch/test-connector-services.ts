import {
  saveConnectorState,
  loadConnectorState,
  type ConnectorState,
} from "../apps/connector/src/state/state-store.js";
import {
  getCompaniesRequest,
  parseTallyCompanies,
} from "../apps/connector/src/tally/company-service.js";
import {
  registerConnectorWithApi,
  sendHeartbeatToApi,
  reportTallyConnected,
  reportTallyCompanies,
  selectCompanyForConnector,
} from "../apps/connector/src/api/client.js";
import { config } from "../apps/connector/src/config.js";

async function main() {
  config.apiUrl = "http://127.0.0.1:4000";
  console.log("=== Testing FinLayer Connector Services ===");

  // 1. Test company-service request generator & parser
  console.log("\n[1] Testing company-service logic...");
  const xmlReq = getCompaniesRequest();
  if (!xmlReq.includes("List of Companies")) {
    throw new Error("getCompaniesRequest failed to produce valid XML envelope");
  }

  const sampleTallyXml = `
    <ENVELOPE>
      <BODY>
        <DATA>
          <COLLECTION>
            <COMPANY NAME="Demo Hardware Pvt Ltd">
              <NAME>Demo Hardware Pvt Ltd</NAME>
            </COMPANY>
            <COMPANY NAME="Acme Trading Corp">
              <NAME>Acme Trading Corp</NAME>
            </COMPANY>
          </COLLECTION>
        </DATA>
      </BODY>
    </ENVELOPE>
  `;
  const parsedCompanies = parseTallyCompanies(sampleTallyXml);
  console.log(`Parsed ${parsedCompanies.length} companies:`, parsedCompanies.map(c => c.name));
  if (parsedCompanies.length !== 2 || parsedCompanies[0].name !== "Demo Hardware Pvt Ltd") {
    throw new Error("parseTallyCompanies failed to parse companies correctly");
  }
  console.log("✓ company-service logic verified");

  // 2. Test state-store
  console.log("\n[2] Testing state-store...");
  const testState: ConnectorState = {
    deviceId: "test-device-verification",
    connectorId: "test-conn-verification",
    registeredAt: new Date().toISOString(),
    deviceName: "Windows-Test-PC",
    operatingSystem: "Windows 11",
    setupStatus: "REGISTERED",
  };
  await saveConnectorState(testState);
  const loadedState = await loadConnectorState();
  if (!loadedState || loadedState.deviceId !== testState.deviceId) {
    throw new Error("state-store failed to persist and reload state");
  }
  console.log("✓ state-store verified:", loadedState.deviceId);

  // 3. Test API Client against FinLayer API server
  console.log("\n[3] Testing API client communication...");
  const reg = await registerConnectorWithApi({
    deviceId: `verify-${Date.now()}`,
    deviceName: "Windows-Verification-Runner",
    operatingSystem: "Windows 11 / x64",
  });
  console.log("Registered test connector ID:", reg.connectorId);
  if (!reg.connectorId) {
    throw new Error("registerConnectorWithApi returned invalid response");
  }

  const hb = await sendHeartbeatToApi(reg.connectorId);
  console.log("Heartbeat response status:", hb.status, "setupStatus:", hb.setupStatus);
  if (hb.status !== "ONLINE") {
    throw new Error("sendHeartbeatToApi failed");
  }

  await reportTallyConnected(reg.connectorId);
  console.log("Reported Tally connected to API");

  await reportTallyCompanies(reg.connectorId, [{ name: "Acme Enterprises" }]);
  console.log("Reported Tally companies to API");

  const compSelect = await selectCompanyForConnector(reg.connectorId, "Acme Enterprises");
  console.log("Selected company ID:", compSelect.companyId);
  if (!compSelect.companyId) {
    throw new Error("selectCompanyForConnector failed");
  }
  console.log("✓ API client & connector registration verified");

  console.log("\n=== ALL CONNECTOR LOGIC VERIFIED SUCCESSFULLY ===");
}

main().catch((err) => {
  console.error("❌ Connector verification failed:", err);
  process.exit(1);
});
