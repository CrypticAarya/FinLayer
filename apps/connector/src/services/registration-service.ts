import crypto from "node:crypto";
import os from "node:os";
import { config } from "../config.js";
import {
  registerConnectorWithApi,
  sendHeartbeatToApi,
  reportTallyConnected,
  reportTallyCompanies,
} from "../api/client.js";
import {
  loadConnectorState,
  saveConnectorState,
  type ConnectorState,
} from "../state/state-store.js";
import { fetchCompaniesFromTally } from "../tally/company-service.js";
import { logger } from "../logger.js";

export interface RegistrationResult {
  connectorId: string;
  state: ConnectorState;
  stopHeartbeat: () => void;
}

async function performOnboardingCompanyDiscovery(
  connectorId: string,
  state: ConnectorState
): Promise<void> {
  try {
    logger.info("Onboarding: checking connection to TallyPrime XML server...");
    const companies = await fetchCompaniesFromTally();
    logger.info(`Tally connected. Discovered ${companies.length} company(ies).`);

    // Report TALLY_CONNECTED
    await reportTallyConnected(connectorId);
    state.setupStatus = "TALLY_CONNECTED";

    if (companies.length > 0) {
      await reportTallyCompanies(connectorId, companies);
      state.setupStatus = "WAITING_FOR_COMPANY";
      logger.info("Discovered companies sent to FinLayer API for onboarding selection.");
    }
  } catch (err) {
    logger.warn(
      `Could not connect to Tally or fetch companies: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function registerAndStartHeartbeat(): Promise<RegistrationResult> {
  // 1. Check for existing local registration
  const existingState = await loadConnectorState();
  if (existingState && existingState.connectorId) {
    logger.info(
      `Using existing connector registration (ID: ${existingState.connectorId}, Device: ${existingState.deviceId})`
    );

    // If connector is not yet ACTIVE, perform onboarding discovery
    if (existingState.setupStatus !== "ACTIVE" && !existingState.companyId) {
      await performOnboardingCompanyDiscovery(existingState.connectorId, existingState);
      await saveConnectorState(existingState);
    } else {
      logger.info("Connector setupStatus is ACTIVE. Skipping company discovery.");
    }

    // Send initial heartbeat
    try {
      const hb = await sendHeartbeatToApi(existingState.connectorId);
      logger.info("Initial heartbeat sent successfully.");
      if (
        hb.setupStatus &&
        (hb.setupStatus !== existingState.setupStatus ||
          hb.companyId !== existingState.companyId ||
          hb.tallyCompanyName !== existingState.tallyCompanyName)
      ) {
        existingState.setupStatus = hb.setupStatus as any;
        if (hb.companyId) existingState.companyId = hb.companyId;
        if (hb.tallyCompanyName) existingState.tallyCompanyName = hb.tallyCompanyName;
        await saveConnectorState(existingState);
        logger.info(
          `Connector status: ${existingState.setupStatus}. Linked company: "${existingState.tallyCompanyName}" (${existingState.companyId})`
        );
      }
    } catch (err) {
      logger.error(
        `Failed to send initial heartbeat: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Periodic heartbeat every 30 seconds
    const intervalMs = config.heartbeatIntervalSeconds * 1000;
    logger.info(`Starting heartbeat loop (every ${config.heartbeatIntervalSeconds}s)...`);

    const timer = setInterval(async () => {
      try {
        const hb = await sendHeartbeatToApi(existingState.connectorId);
        logger.info("Heartbeat sent.");
        if (
          hb.setupStatus &&
          (hb.setupStatus !== existingState.setupStatus ||
            hb.companyId !== existingState.companyId ||
            hb.tallyCompanyName !== existingState.tallyCompanyName)
        ) {
          existingState.setupStatus = hb.setupStatus as any;
          if (hb.companyId) existingState.companyId = hb.companyId;
          if (hb.tallyCompanyName) existingState.tallyCompanyName = hb.tallyCompanyName;
          await saveConnectorState(existingState);
          logger.info(
            `Connector status: ${existingState.setupStatus}. Linked company: "${existingState.tallyCompanyName}" (${existingState.companyId})`
          );
        }
      } catch (err) {
        logger.error(
          `Failed to send heartbeat: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }, intervalMs);

    return {
      connectorId: existingState.connectorId,
      state: existingState,
      stopHeartbeat: () => clearInterval(timer),
    };
  }

  // 2. First-time registration
  logger.info("First-time setup: registering new connector with FinLayer API...");

  const cleanHost =
    os
      .hostname()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/^-+|-+$/g, "") || "machine";
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const deviceId =
    process.env.DEVICE_ID || `finlayer-${cleanHost}-${randomSuffix}`;
  const deviceName =
    config.connectorName || os.hostname() || "FinLayer Connector";
  const operatingSystem = `${os.type()} ${os.release()} (${os.arch()})`;

  logger.info(
    `deviceId="${deviceId}" deviceName="${deviceName}" operatingSystem="${operatingSystem}"`
  );

  const { connectorId } = await registerConnectorWithApi({
    deviceId,
    deviceName,
    operatingSystem,
    company: config.companyName || undefined,
  });

  logger.info(`Connector registered successfully. ID: ${connectorId}`);

  const state: ConnectorState = {
    deviceId,
    connectorId,
    registeredAt: new Date().toISOString(),
    deviceName,
    operatingSystem,
    company: config.companyName || undefined,
    setupStatus: "REGISTERED",
  };

  // Run onboarding discovery if company not pre-configured
  if (!config.companyName) {
    await performOnboardingCompanyDiscovery(connectorId, state);
  } else {
    state.setupStatus = "ACTIVE";
    state.tallyCompanyName = config.companyName;
  }

  await saveConnectorState(state);
  logger.info("Connector state saved locally.");

  // Send initial heartbeat
  try {
    const hb = await sendHeartbeatToApi(connectorId);
    logger.info("Initial heartbeat sent successfully.");
    if (
      hb.setupStatus &&
      (hb.setupStatus !== state.setupStatus ||
        hb.companyId !== state.companyId ||
        hb.tallyCompanyName !== state.tallyCompanyName)
    ) {
      state.setupStatus = hb.setupStatus as any;
      if (hb.companyId) state.companyId = hb.companyId;
      if (hb.tallyCompanyName) state.tallyCompanyName = hb.tallyCompanyName;
      await saveConnectorState(state);
    }
  } catch (err) {
    logger.error(
      `Failed to send initial heartbeat: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Periodic heartbeat every 30 seconds
  const intervalMs = config.heartbeatIntervalSeconds * 1000;
  logger.info(`Starting heartbeat loop (every ${config.heartbeatIntervalSeconds}s)...`);

  const timer = setInterval(async () => {
    try {
      const hb = await sendHeartbeatToApi(connectorId);
      logger.info("Heartbeat sent.");
      if (
        hb.setupStatus &&
        (hb.setupStatus !== state.setupStatus ||
          hb.companyId !== state.companyId ||
          hb.tallyCompanyName !== state.tallyCompanyName)
      ) {
        state.setupStatus = hb.setupStatus as any;
        if (hb.companyId) state.companyId = hb.companyId;
        if (hb.tallyCompanyName) state.tallyCompanyName = hb.tallyCompanyName;
        await saveConnectorState(state);
        logger.info(
          `Connector status: ${state.setupStatus}. Linked company: "${state.tallyCompanyName}" (${state.companyId})`
        );
      }
    } catch (err) {
      logger.error(
        `Failed to send heartbeat: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, intervalMs);

  return {
    connectorId,
    state,
    stopHeartbeat: () => clearInterval(timer),
  };
}
