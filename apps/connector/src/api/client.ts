import type { Ledger, Voucher, TrialBalanceItem } from "../sync/types.js";
import { config } from "../config.js";
import { TokenStorageManager } from "../state/token-storage.js";

let activeConnectorToken: string | null = null;

export function setConnectorToken(token: string | null): void {
  activeConnectorToken = token;
}

export function getConnectorToken(): string | null {
  return activeConnectorToken;
}

/**
 * Builds request headers including Authorization: Bearer <token> if available.
 */
export async function getAuthHeaders(
  customHeaders: Record<string, string> = {}
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...customHeaders };

  if (!activeConnectorToken) {
    activeConnectorToken = await TokenStorageManager.getToken();
  }

  if (activeConnectorToken) {
    headers["Authorization"] = `Bearer ${activeConnectorToken}`;
  }

  return headers;
}

export interface SendLedgersResponse {
  success: boolean;
  company: string;
  received: number;
  created: number;
  updated: number;
}

export async function sendLedgersToApi(
  company: string,
  ledgers: Ledger[]
): Promise<SendLedgersResponse> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/sync/ledgers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ company, ledgers }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `FinLayer API error: ${response.status} ${response.statusText} — ${text}`
    );
  }

  return (await response.json()) as SendLedgersResponse;
}

export interface SendVouchersResponse {
  success: boolean;
  company: string;
  received: number;
  created: number;
}

export async function sendVouchersToApi(
  company: string,
  vouchers: Voucher[]
): Promise<SendVouchersResponse> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/sync/vouchers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ company, vouchers }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `FinLayer API error: ${response.status} ${response.statusText} — ${text}`
    );
  }

  return (await response.json()) as SendVouchersResponse;
}

export interface SendTrialBalanceResponse {
  success: boolean;
  company: string;
  received: number;
  created: number;
  updated: number;
}

export async function sendTrialBalanceToApi(
  company: string,
  trialBalance: TrialBalanceItem[]
): Promise<SendTrialBalanceResponse> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/sync/trial-balance`, {
    method: "POST",
    headers,
    body: JSON.stringify({ company, trialBalance }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `FinLayer API error: ${response.status} ${response.statusText} — ${text}`
    );
  }

  return (await response.json()) as SendTrialBalanceResponse;
}

export interface RegisterConnectorParams {
  deviceId: string;
  deviceName: string;
  operatingSystem: string;
  company?: string;
}

export async function registerConnectorWithApi(
  params: RegisterConnectorParams | { company: string; name: string; deviceId: string }
): Promise<{ connectorId: string; setupStatus?: string; token?: string }> {
  const payload = "deviceName" in params
    ? {
        deviceId: params.deviceId,
        deviceName: params.deviceName,
        operatingSystem: params.operatingSystem,
        ...(params.company ? { company: params.company } : {}),
      }
    : {
        company: params.company,
        name: params.name,
        deviceId: params.deviceId,
      };

  const response = await fetch(`${config.apiUrl}/connectors/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to register connector: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as {
    success: boolean;
    connectorId: string;
    setupStatus?: string;
    token?: string;
  };

  if (data.token) {
    setConnectorToken(data.token);
    await TokenStorageManager.setToken(data.token);
  }

  return { connectorId: data.connectorId, setupStatus: data.setupStatus, token: data.token };
}

export async function upgradeV1ConnectorToken(
  connectorId: string,
  deviceId: string
): Promise<{ connectorId: string; token: string }> {
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/upgrade-v1-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to upgrade V1 connector token: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as {
    success: boolean;
    connectorId: string;
    token: string;
  };

  if (data.token) {
    setConnectorToken(data.token);
    await TokenStorageManager.setToken(data.token);
  }

  return { connectorId: data.connectorId, token: data.token };
}


export interface HeartbeatApiResponse {
  status: string;
  setupStatus?: string;
  companyId?: string | null;
  tallyCompanyName?: string | null;
}

export const CONNECTOR_VERSION = "1.0.0";

export async function sendHeartbeatToApi(
  connectorId: string,
  extra?: { version?: string }
): Promise<HeartbeatApiResponse> {
  const version = extra?.version ?? CONNECTOR_VERSION;
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ version }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to send heartbeat: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as {
    success: boolean;
    status: string;
    setupStatus?: string;
    companyId?: string | null;
    tallyCompanyName?: string | null;
  };
  return {
    status: data.status,
    setupStatus: data.setupStatus,
    companyId: data.companyId,
    tallyCompanyName: data.tallyCompanyName,
  };
}

export async function reportTallyConnected(connectorId: string): Promise<void> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/tally-status`, {
    method: "POST",
    headers,
    body: JSON.stringify({ status: "TALLY_CONNECTED" }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to report Tally status: ${response.status} ${response.statusText} — ${text}`
    );
  }
}

export async function reportTallyCompanies(
  connectorId: string,
  companies: Array<{ name: string }>
): Promise<{ success: boolean }> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/tally-companies`, {
    method: "POST",
    headers,
    body: JSON.stringify({ companies }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to report Tally companies: ${response.status} ${response.statusText} — ${text}`
    );
  }

  return (await response.json()) as { success: boolean };
}

export async function selectCompanyForConnector(
  connectorId: string,
  companyName: string
): Promise<{ success: boolean; companyId: string; setupStatus: string }> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/company`, {
    method: "POST",
    headers,
    body: JSON.stringify({ companyName }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to select company for connector: ${response.status} ${response.statusText} — ${text}`
    );
  }

  return (await response.json()) as {
    success: boolean;
    companyId: string;
    setupStatus: string;
  };
}

export async function fetchTallyCompaniesFromApi(
  connectorId: string
): Promise<{ success: boolean; setupStatus: string; companies: Array<{ name: string }> }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/tally-companies`, {
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to fetch Tally companies: ${response.status} ${response.statusText} — ${text}`
    );
  }

  return (await response.json()) as {
    success: boolean;
    setupStatus: string;
    companies: Array<{ name: string }>;
  };
}

export async function rotateConnectorToken(
  connectorId: string
): Promise<{ success: boolean; connectorId: string; token: string }> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/rotate-token`, {
    method: "POST",
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to rotate connector token: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as { success: boolean; connectorId: string; token: string };
  setConnectorToken(data.token);
  await TokenStorageManager.setToken(data.token);
  return data;
}

export async function verifyConnectorTokenWithApi(): Promise<unknown> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${config.apiUrl}/connectors/verify-token`, {
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to verify connector token: ${response.status} ${response.statusText} — ${text}`
    );
  }

  return await response.json();
}

export interface SyncJob {
  id: string;
  connectorId: string;
  type: string;
  status: string;
  createdAt: string;
}

export async function fetchPendingJob(
  connectorId: string
): Promise<SyncJob | null> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${config.apiUrl}/sync/jobs/${connectorId}/pending`, {
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to fetch pending job: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as { success: boolean; job: SyncJob | null };
  return data.job;
}

export async function completeSyncJob(jobId: string): Promise<void> {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${config.apiUrl}/sync/jobs/${jobId}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to complete sync job: ${response.status} ${response.statusText} — ${text}`
    );
  }
}
