import {
  type FinLayerConfig,
  loadFinLayerConfig,
  validateConfig,
  maskApiKey,
} from "../config.js";
import {
  FinLayerClient,
  type CompanyMetadata,
  type TrialBalanceResponse,
  type TestConnectionResult,
  type LedgerDto,
  type VoucherDto,
} from "../client/finlayer-client.js";

export interface SyncAuditStep {
  step: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  details?: any;
  error?: string;
}

export interface ConnectivitySyncResult {
  success: boolean;
  syncStatus: "SUCCESS" | "FAILED";
  lastSyncTime: string;
  message: string;
  totalDurationMs: number;
  recordsFetched: {
    ledgers: number;
    vouchers: number;
    trialBalanceEntries: number;
  };
  config: {
    apiUrl: string;
    companyId: string;
    maskedApiKey: string;
  };
  connection: TestConnectionResult;
  company?: CompanyMetadata;
  trialBalance?: TrialBalanceResponse;
  ledgers?: LedgerDto[];
  vouchers?: VoucherDto[];
  sampleVoucher?: VoucherDto;
  validation: {
    accountingEquationSatisfied: boolean;
    debitTotal: number;
    creditTotal: number;
    difference: number;
  };
  auditTrail: SyncAuditStep[];
  errorSummary?: string;
}

export class ConnectivityService {
  private readonly config: FinLayerConfig;
  private readonly client: FinLayerClient;

  constructor(customConfig?: Partial<FinLayerConfig>) {
    this.config = { ...loadFinLayerConfig(), ...customConfig };
    this.client = new FinLayerClient(this.config);
  }

  /**
   * Fast probe to verify network and credentials.
   */
  async testConnection(): Promise<TestConnectionResult> {
    const configCheck = validateConfig(this.config);
    if (!configCheck.valid) {
      return {
        success: false,
        statusCode: 0,
        latencyMs: 0,
        error: `Configuration Error: ${configCheck.errors.join("; ")}`,
      };
    }

    return this.client.testConnection();
  }

  /**
   * Executes a full ProfitNiti connectivity sync:
   * 1. Validate configuration
   * 2. Test connection & authenticate
   * 3. Fetch company metadata
   * 4. Fetch canonical ledgers
   * 5. Fetch canonical trial balance & verify Total Debit === Total Credit
   * 6. Fetch canonical vouchers
   * 7. Generate comprehensive testing & reconciliation sync report
   */
  async runFullConnectivitySync(): Promise<ConnectivitySyncResult> {
    const startedAt = Date.now();
    const auditTrail: SyncAuditStep[] = [];

    const result: ConnectivitySyncResult = {
      success: false,
      syncStatus: "FAILED",
      lastSyncTime: new Date().toISOString(),
      message: "Sync in progress...",
      totalDurationMs: 0,
      recordsFetched: {
        ledgers: 0,
        vouchers: 0,
        trialBalanceEntries: 0,
      },
      config: {
        apiUrl: this.config.apiUrl,
        companyId: this.config.companyId,
        maskedApiKey: maskApiKey(this.config.apiKey),
      },
      connection: {
        success: false,
        statusCode: 0,
        latencyMs: 0,
      },
      validation: {
        accountingEquationSatisfied: false,
        debitTotal: 0,
        creditTotal: 0,
        difference: 0,
      },
      auditTrail,
    };

    // ── Step 1: Validate Configuration ─────────────────────────────────────────
    const tConfig0 = Date.now();
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      const errMsg = validation.errors.join("; ");
      auditTrail.push({
        step: "Configuration Validation",
        status: "FAILED",
        durationMs: Date.now() - tConfig0,
        error: errMsg,
      });
      result.errorSummary = errMsg;
      result.message = `Configuration Error: ${errMsg}`;
      result.totalDurationMs = Date.now() - startedAt;
      return result;
    }

    auditTrail.push({
      step: "Configuration Validation",
      status: "SUCCESS",
      durationMs: Date.now() - tConfig0,
      details: {
        apiUrl: this.config.apiUrl,
        companyId: this.config.companyId,
        maskedKey: maskApiKey(this.config.apiKey),
      },
    });

    // ── Step 2: Test Connection & Authentication ──────────────────────────────
    const conn = await this.client.testConnection();
    result.connection = conn;

    if (!conn.success) {
      auditTrail.push({
        step: "FinLayer API Handshake & Auth",
        status: "FAILED",
        durationMs: conn.latencyMs,
        error: conn.error || `HTTP ${conn.statusCode}`,
      });
      result.errorSummary = conn.error || `Authentication failed with status ${conn.statusCode}`;
      result.message = `Handshake Failed: ${result.errorSummary}`;
      result.totalDurationMs = Date.now() - startedAt;
      return result;
    }

    auditTrail.push({
      step: "FinLayer API Handshake & Auth",
      status: "SUCCESS",
      durationMs: conn.latencyMs,
      details: {
        statusCode: conn.statusCode,
        companyId: conn.company?.id,
        companyName: conn.company?.name,
      },
    });
    result.company = conn.company;

    // ── Step 3: Fetch Ledgers ─────────────────────────────────────────────────
    const tLedgers0 = Date.now();
    try {
      const allLedgers: LedgerDto[] = [];
      let cursor: string | undefined = undefined;

      while (true) {
        const page = await this.client.fetchLedgers(100, cursor);
        allLedgers.push(...page.data);
        if (!page.pagination.hasMore || !page.pagination.nextCursor) break;
        cursor = page.pagination.nextCursor;
      }

      result.ledgers = allLedgers;
      result.recordsFetched.ledgers = allLedgers.length;

      auditTrail.push({
        step: "Ledgers Chart of Accounts Retrieval",
        status: "SUCCESS",
        durationMs: Date.now() - tLedgers0,
        details: { count: allLedgers.length },
      });
    } catch (err: any) {
      auditTrail.push({
        step: "Ledgers Chart of Accounts Retrieval",
        status: "FAILED",
        durationMs: Date.now() - tLedgers0,
        error: err?.message || "Failed to retrieve ledgers",
      });
    }

    // ── Step 4: Fetch Trial Balance ───────────────────────────────────────────
    const tTb0 = Date.now();
    try {
      const tb = await this.client.fetchTrialBalance();
      const tbDuration = Date.now() - tTb0;
      result.trialBalance = tb;
      result.recordsFetched.trialBalanceEntries = tb.data.length;

      const debit = tb.totals?.debitTotal ?? 0;
      const credit = tb.totals?.creditTotal ?? 0;
      const diff = Math.round(Math.abs(debit - credit) * 100) / 100;
      const isBalanced = diff === 0;

      result.validation = {
        accountingEquationSatisfied: isBalanced,
        debitTotal: debit,
        creditTotal: credit,
        difference: diff,
      };

      auditTrail.push({
        step: "Trial Balance Retrieval & Equation Check",
        status: isBalanced ? "SUCCESS" : "FAILED",
        durationMs: tbDuration,
        details: {
          entriesCount: tb.data.length,
          debitTotal: debit,
          creditTotal: credit,
          isBalanced,
        },
      });

      if (!isBalanced) {
        result.errorSummary = `Accounting equation unbalanced: Debit (${debit}) !== Credit (${credit})`;
      }
    } catch (err: any) {
      auditTrail.push({
        step: "Trial Balance Retrieval & Equation Check",
        status: "FAILED",
        durationMs: Date.now() - tTb0,
        error: err?.message || "Failed to retrieve trial balance",
      });
      result.errorSummary = err?.message || "Trial balance fetch error";
    }

    // ── Step 5: Fetch Vouchers ────────────────────────────────────────────────
    const tVch0 = Date.now();
    try {
      const vchResponse = await this.client.fetchVouchers(50);
      result.vouchers = vchResponse.data;
      result.recordsFetched.vouchers = vchResponse.data.length;
      result.sampleVoucher = vchResponse.data[0];

      auditTrail.push({
        step: "Vouchers & Double-Entry Ingestion",
        status: "SUCCESS",
        durationMs: Date.now() - tVch0,
        details: {
          count: vchResponse.data.length,
          hasMore: vchResponse.pagination.hasMore,
        },
      });
    } catch (err: any) {
      auditTrail.push({
        step: "Vouchers & Double-Entry Ingestion",
        status: "FAILED",
        durationMs: Date.now() - tVch0,
        error: err?.message || "Failed to retrieve vouchers",
      });
    }

    result.totalDurationMs = Date.now() - startedAt;
    const isAllOk =
      result.connection.success &&
      result.validation.accountingEquationSatisfied &&
      !result.errorSummary;

    result.success = isAllOk;
    result.syncStatus = isAllOk ? "SUCCESS" : "FAILED";
    result.message = isAllOk
      ? `Successfully synchronized ${result.recordsFetched.ledgers} ledgers, ${result.recordsFetched.vouchers} vouchers, and ${result.recordsFetched.trialBalanceEntries} trial balance entries with 100% balance integrity.`
      : `Sync completed with issues: ${result.errorSummary || "Validation failed"}`;

    return result;
  }
}
