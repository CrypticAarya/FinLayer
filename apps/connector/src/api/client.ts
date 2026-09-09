import type { Ledger, Voucher } from "../sync/types.ts";
import { config } from "../config.ts";

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
  const response = await fetch(`${config.apiUrl}/sync/ledgers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const response = await fetch(`${config.apiUrl}/sync/vouchers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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


export async function registerConnectorWithApi(
  company: string,
  name: string,
  deviceId: string
): Promise<{ connectorId: string }> {
  const response = await fetch(`${config.apiUrl}/connectors/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company, name, deviceId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to register connector: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as { success: boolean; connectorId: string };
  return { connectorId: data.connectorId };
}

export async function sendHeartbeatToApi(
  connectorId: string
): Promise<{ status: string }> {
  const response = await fetch(`${config.apiUrl}/connectors/${connectorId}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to send heartbeat: ${response.status} ${response.statusText} — ${text}`
    );
  }

  const data = (await response.json()) as { success: boolean; status: string };
  return { status: data.status };
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
  const response = await fetch(`${config.apiUrl}/sync/jobs/${connectorId}/pending`);

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
  const response = await fetch(`${config.apiUrl}/sync/jobs/${jobId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Failed to complete sync job: ${response.status} ${response.statusText} — ${text}`
    );
  }
}


