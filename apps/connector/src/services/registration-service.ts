import { config } from "../config.ts";
import { registerConnectorWithApi, sendHeartbeatToApi } from "../api/client.ts";
import { saveConnectorState, type ConnectorState } from "../state/state-store.ts";

export interface RegistrationResult {
  connectorId: string;
  state: ConnectorState;
  stopHeartbeat: () => void;
}

export async function registerAndStartHeartbeat(): Promise<RegistrationResult> {
  console.log("Registering connector with FinLayer API...");
  console.log({
    company: config.companyName,
    name: config.connectorName,
    deviceId: config.deviceId,
  });

  const { connectorId } = await registerConnectorWithApi(
    config.companyName,
    config.connectorName,
    config.deviceId
  );

  console.log(`Connector registered. ID: ${connectorId}`);

  const state: ConnectorState = {
    connectorId,
    deviceId: config.deviceId,
    name: config.connectorName,
    company: config.companyName,
    registeredAt: new Date().toISOString(),
  };

  await saveConnectorState(state);
  console.log("Connector state saved locally.");

  // Send initial heartbeat
  try {
    await sendHeartbeatToApi(connectorId);
    console.log("Initial heartbeat sent successfully.");
  } catch (err) {
    console.error("Failed to send initial heartbeat:", err);
  }

  // Periodic heartbeat every 30 seconds
  const intervalMs = config.heartbeatIntervalSeconds * 1000;
  console.log(`Starting heartbeat loop (every ${config.heartbeatIntervalSeconds}s)...`);

  const timer = setInterval(async () => {
    try {
      await sendHeartbeatToApi(connectorId);
      console.log(`[${new Date().toISOString()}] Heartbeat sent.`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Failed to send heartbeat:`, err);
    }
  }, intervalMs);

  return {
    connectorId,
    state,
    stopHeartbeat: () => clearInterval(timer),
  };
}
