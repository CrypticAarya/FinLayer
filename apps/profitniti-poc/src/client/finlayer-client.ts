import type { FinLayerConfig } from "../config.js";

export interface CompanyMetadata {
  id: string;
  name: string;
  tallyCompanyName: string;
  createdAt: string;
  updatedAt: string;
  connectorStatus: string | null;
  lastHeartbeat: string | null;
  lastSyncAt: string | null;
}

export interface TrialBalanceEntry {
  id?: string;
  ledgerId?: string;
  ledgerName: string;
  groupName: string;
  debitAmount: number;
  creditAmount: number;
  netBalance: number;
}

export interface TrialBalanceResponse {
  success: boolean;
  companyId: string;
  filters: {
    startDate: string | null;
    endDate: string | null;
  };
  data: TrialBalanceEntry[];
  totals: {
    debitTotal: number;
    creditTotal: number;
    isBalanced: boolean;
  };
}

export interface LedgerDto {
  id: string;
  name: string;
  parent: string;
  masterId: number;
  alterId: number;
  createdAt: string;
  updatedAt: string;
}

export interface LedgersResponse {
  success: boolean;
  companyId: string;
  data: LedgerDto[];
  pagination: {
    limit: number;
    cursor: string | null;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface TestConnectionResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  company?: CompanyMetadata;
  error?: string;
}

export class FinLayerClient {
  private readonly config: FinLayerConfig;

  constructor(config: FinLayerConfig) {
    this.config = config;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<{ status: number; body: T }> {
    const url = `${this.config.apiUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "User-Agent": "ProfitNiti-Integration/1.0",
          ...options.headers,
        },
      });

      const body = (await res.json()) as T;
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Probes FinLayer API connectivity, authenticates the key, and measures round-trip latency.
   */
  async testConnection(): Promise<TestConnectionResult> {
    const t0 = Date.now();
    try {
      const { status, body } = await this.request<{ success: boolean; data?: CompanyMetadata; error?: string }>(
        `/companies/${this.config.companyId}`
      );
      const latencyMs = Date.now() - t0;

      if (status === 200 && body.success && body.data) {
        return {
          success: true,
          statusCode: status,
          latencyMs,
          company: body.data,
        };
      }

      return {
        success: false,
        statusCode: status,
        latencyMs,
        error: body.error || `HTTP ${status} received from FinLayer API`,
      };
    } catch (err: any) {
      return {
        success: false,
        statusCode: 0,
        latencyMs: Date.now() - t0,
        error: err?.message || "Network error connecting to FinLayer API",
      };
    }
  }

  /**
   * Fetches company metadata from FinLayer.
   */
  async fetchCompany(): Promise<CompanyMetadata> {
    const { status, body } = await this.request<{ success: boolean; data: CompanyMetadata; error?: string }>(
      `/companies/${this.config.companyId}`
    );
    if (status !== 200 || !body.success) {
      throw new Error(body.error || `Failed to fetch company (HTTP ${status})`);
    }
    return body.data;
  }

  /**
   * Fetches canonical trial balance from FinLayer.
   */
  async fetchTrialBalance(filters?: { startDate?: string; endDate?: string }): Promise<TrialBalanceResponse> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.set("startDate", filters.startDate);
    if (filters?.endDate) params.set("endDate", filters.endDate);

    const qs = params.toString() ? `?${params.toString()}` : "";
    const { status, body } = await this.request<TrialBalanceResponse>(
      `/companies/${this.config.companyId}/trial-balance${qs}`
    );
    if (status !== 200 || !body.success) {
      throw new Error((body as any)?.error || `Failed to fetch trial balance (HTTP ${status})`);
    }
    return body;
  }

  /**
   * Fetches canonical ledgers from FinLayer.
   */
  async fetchLedgers(limit = 50, cursor?: string): Promise<LedgersResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);

    const { status, body } = await this.request<LedgersResponse>(
      `/companies/${this.config.companyId}/ledgers?${params.toString()}`
    );
    if (status !== 200 || !body.success) {
      throw new Error((body as any)?.error || `Failed to fetch ledgers (HTTP ${status})`);
    }
    return body;
  }

  /**
   * Fetches canonical vouchers from FinLayer.
   */
  async fetchVouchers(limit = 50, cursor?: string, startDate?: string, endDate?: string): Promise<VouchersResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    const { status, body } = await this.request<VouchersResponse>(
      `/companies/${this.config.companyId}/vouchers?${params.toString()}`
    );
    if (status !== 200 || !body.success) {
      throw new Error((body as any)?.error || `Failed to fetch vouchers (HTTP ${status})`);
    }
    return body;
  }
}

export interface VoucherEntryDto {
  id: string;
  ledgerId: string;
  ledgerName: string;
  groupName: string;
  amount: number;
  type: string;
}

export interface VoucherDto {
  id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyName: string | null;
  amount: number;
  entries: VoucherEntryDto[];
}

export interface VouchersResponse {
  success: boolean;
  companyId: string;
  data: VoucherDto[];
  pagination: {
    limit: number;
    cursor: string | null;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

