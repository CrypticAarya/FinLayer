/**
 * FinLayer V2.4 — OpenAPI 3.0.3 Specification
 * 
 * Formal API documentation for all FinLayer SaaS endpoints under /api/v1, system health, and data freshness.
 * Designed for external SaaS developers, SDK generation, and Swagger UI.
 */

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "FinLayer SaaS API",
    version: "2.4.0",
    description: `
**FinLayer SaaS API** provides external SaaS applications with high-throughput, company-isolated access to verified accounting data extracted from TallyPrime.

### Key Capabilities
- **Strict Tenant Isolation**: All endpoints require an API key scoped directly to the target company. Cross-tenant access is rejected with \`403 Forbidden\`.
- **Memory-Bounded Pagination**: Ledger and voucher listings support keyset cursor pagination with bounded limits.
- **NDJSON Streaming**: High-volume voucher synchronization via chunked \`application/x-ndjson\` streaming.
- **Canonical Double-Entry Accounting**: Real-time balanced Trial Balance aggregation satisfying \`Debit Total === Credit Total\`.
- **Production Reliability Foundation**: Rate limiting per API key, standardized error envelopes, and automated database health probes.
- **Data Freshness Visibility**: Real-time connector heartbeats, synchronization audit runs, and company freshness status.

### Authentication
Every request requires an active FinLayer SaaS API key passed via:
- \`Authorization: Bearer fl_live_<token>\` **(Recommended)**
- \`x-api-key: fl_live_<token>\`
    `.trim(),
    contact: {
      name: "FinLayer Developer Platform",
      url: "https://github.com/CrypticAarya/FinLayer",
    },
    license: {
      name: "Proprietary",
    },
  },
  servers: [
    {
      url: "/api/v1",
      description: "FinLayer SaaS Gateway (v1)",
    },
    {
      url: "/",
      description: "FinLayer Root Server",
    },
  ],
  tags: [
    {
      name: "Health",
      description: "API system status, semantic versioning, and database connectivity probe.",
    },
    {
      name: "Companies",
      description: "Company metadata, sync status, and Tally pairing details.",
    },
    {
      name: "Ledgers",
      description: "Chart of accounts, account groups, and closing balances.",
    },
    {
      name: "Trial Balance",
      description: "Canonical double-entry trial balance aggregation.",
    },
    {
      name: "Vouchers",
      description: "Multi-leg financial transactions with cursor pagination and NDJSON streaming.",
    },
  ],
  security: [
    { BearerAuth: [] },
    { ApiKeyAuth: [] },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "API Health & Database Connectivity Check",
        description: "Returns API runtime status, semantic version, process uptime, and live PostgreSQL database connectivity status.",
        operationId: "getHealth",
        security: [],
        responses: {
          "200": {
            description: "System is healthy and database is connected.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/HealthResponse",
                },
              },
            },
          },
          "503": {
            description: "System is unhealthy or database is unreachable.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/HealthResponse",
                },
              },
            },
          },
        },
      },
    },
    "/companies/{companyId}": {
      get: {
        tags: ["Companies"],
        summary: "Get Company Metadata",
        description: "Retrieves canonical company details, financial year bounds, currency, Tally connector status, and last synchronization timestamp.",
        operationId: "getCompany",
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            description: "FinLayer Company unique identifier (CUID)",
            schema: {
              type: "string",
              example: "cmu84468l00001s3tnvjagcrz",
            },
          },
        ],
        responses: {
          "200": {
            description: "Company details retrieved successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CompanyResponse",
                },
              },
            },
          },
          "401": {
            $ref: "#/components/responses/UnauthorizedError",
          },
          "403": {
            $ref: "#/components/responses/ForbiddenError",
          },
          "404": {
            $ref: "#/components/responses/NotFoundError",
          },
        },
      },
    },
    "/companies/{companyId}/sync-status": {
      get: {
        tags: ["Companies"],
        summary: "Get Company Data Freshness & Sync Status",
        description: "Returns Tally connector status, latest heartbeat, last sync run outcome, duration, and total records processed.",
        operationId: "getCompanySyncStatus",
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            description: "FinLayer Company unique identifier (CUID)",
            schema: {
              type: "string",
              example: "cmu84468l00001s3tnvjagcrz",
            },
          },
        ],
        responses: {
          "200": {
            description: "Company sync status retrieved successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SyncStatusResponse",
                },
              },
            },
          },
          "401": {
            $ref: "#/components/responses/UnauthorizedError",
          },
          "403": {
            $ref: "#/components/responses/ForbiddenError",
          },
          "404": {
            $ref: "#/components/responses/NotFoundError",
          },
          "429": {
            $ref: "#/components/responses/TooManyRequestsError",
          },
        },
      },
    },
    "/companies/{companyId}/ledgers": {
      get: {
        tags: ["Ledgers"],
        summary: "List Company Ledgers",
        description: "Returns a cursor-paginated list of ledger accounts for the specified company, ordered deterministically by ID.",
        operationId: "listLedgers",
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            description: "FinLayer Company unique identifier (CUID)",
            schema: {
              type: "string",
              example: "cmu84468l00001s3tnvjagcrz",
            },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Maximum number of records to return (default: 50, maximum: 250).",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 250,
              default: 50,
              example: 50,
            },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Opaque cursor for keyset pagination (record ID). Pass the `nextCursor` from the previous response.",
            schema: {
              type: "string",
              example: "cmu84468l00004s3tnvjagcrz",
            },
          },
        ],
        responses: {
          "200": {
            description: "Ledger list retrieved successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LedgersResponse",
                },
              },
            },
          },
          "401": {
            $ref: "#/components/responses/UnauthorizedError",
          },
          "403": {
            $ref: "#/components/responses/ForbiddenError",
          },
          "404": {
            $ref: "#/components/responses/NotFoundError",
          },
        },
      },
    },
    "/companies/{companyId}/trial-balance": {
      get: {
        tags: ["Trial Balance"],
        summary: "Get Canonical Trial Balance",
        description: "Aggregates opening balances and voucher debit/credit legs across the specified date range. Enforces strict double-entry verification.",
        operationId: "getTrialBalance",
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            description: "FinLayer Company unique identifier (CUID)",
            schema: {
              type: "string",
              example: "cmu84468l00001s3tnvjagcrz",
            },
          },
          {
            name: "startDate",
            in: "query",
            required: false,
            description: "Start of date range (ISO 8601 YYYY-MM-DD). Aliased as `fromDate`.",
            schema: {
              type: "string",
              format: "date",
              example: "2026-04-01",
            },
          },
          {
            name: "endDate",
            in: "query",
            required: false,
            description: "End of date range (ISO 8601 YYYY-MM-DD). Aliased as `toDate`.",
            schema: {
              type: "string",
              format: "date",
              example: "2027-03-31",
            },
          },
          {
            name: "asOfDate",
            in: "query",
            required: false,
            description: "Calculate trial balance as of a specific point in time (ISO 8601 YYYY-MM-DD).",
            schema: {
              type: "string",
              format: "date",
              example: "2026-09-22",
            },
          },
        ],
        responses: {
          "200": {
            description: "Trial Balance aggregated successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TrialBalanceResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/UnauthorizedError",
          },
          "403": {
            $ref: "#/components/responses/ForbiddenError",
          },
          "404": {
            $ref: "#/components/responses/NotFoundError",
          },
        },
      },
    },
    "/companies/{companyId}/vouchers": {
      get: {
        tags: ["Vouchers"],
        summary: "List or Stream Vouchers",
        description: `
Retrieves multi-leg financial vouchers with full ledger breakdown.
- Standard requests return JSON with keyset pagination metadata.
- Setting \`stream=true\` switches to high-speed chunked **NDJSON streaming** (\`application/x-ndjson\`), emitting one JSON voucher object per line with bounded memory footprint.
        `.trim(),
        operationId: "listVouchers",
        parameters: [
          {
            name: "companyId",
            in: "path",
            required: true,
            description: "FinLayer Company unique identifier (CUID)",
            schema: {
              type: "string",
              example: "cmu84468l00001s3tnvjagcrz",
            },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Maximum vouchers per page (default: 50, maximum: 250). Ignored when stream=true.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 250,
              default: 50,
              example: 50,
            },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Pagination cursor (voucher ID) from previous response.",
            schema: {
              type: "string",
              example: "cmu84468l00009s3tnvjagcrz",
            },
          },
          {
            name: "startDate",
            in: "query",
            required: false,
            description: "Filter vouchers on or after this date (ISO 8601 YYYY-MM-DD).",
            schema: {
              type: "string",
              format: "date",
              example: "2026-04-01",
            },
          },
          {
            name: "endDate",
            in: "query",
            required: false,
            description: "Filter vouchers on or before this date (ISO 8601 YYYY-MM-DD).",
            schema: {
              type: "string",
              format: "date",
              example: "2026-09-30",
            },
          },
          {
            name: "stream",
            in: "query",
            required: false,
            description: "Set to 'true' to receive vouchers as an NDJSON stream (application/x-ndjson).",
            schema: {
              type: "boolean",
              default: false,
              example: false,
            },
          },
        ],
        responses: {
          "200": {
            description: "Vouchers retrieved successfully (JSON or NDJSON stream).",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/VouchersResponse",
                },
              },
              "application/x-ndjson": {
                schema: {
                  type: "string",
                  description: "Stream of newline-delimited JSON voucher objects.",
                  example: '{"id":"vch_01","voucherNumber":"PAY-001","amount":2500,"entries":[...]}\n{"id":"vch_02","voucherNumber":"REC-002","amount":1500,"entries":[...]}',
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ValidationError",
          },
          "401": {
            $ref: "#/components/responses/UnauthorizedError",
          },
          "403": {
            $ref: "#/components/responses/ForbiddenError",
          },
          "404": {
            $ref: "#/components/responses/NotFoundError",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "ApiKey",
        description: "API key issued by FinLayer (e.g. `fl_live_your_api_key_here`). Set as header: `Authorization: Bearer <key>`",
      },
      ApiKeyAuth: {
        type: "apiKey",
        name: "x-api-key",
        in: "header",
        description: "Direct API key header alternative: `x-api-key: <key>`",
      },
    },
    responses: {
      UnauthorizedError: {
        description: "Authentication failed. Missing, invalid, or revoked API key.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              success: false,
              error: "Unauthorized: Missing API key. Provide Authorization: Bearer <apiKey> or x-api-key header.",
            },
          },
        },
      },
      ForbiddenError: {
        description: "Cross-tenant access forbidden. The API key is not authorized for the requested company.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              success: false,
              error: "Forbidden: API key does not have access to this company.",
            },
          },
        },
      },
      NotFoundError: {
        description: "Target company does not exist.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              success: false,
              error: 'Company "cmu84468l00001s3tnvjagcrz" not found.',
            },
          },
        },
      },
      ValidationError: {
        description: "Invalid query parameters or malformed date range.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              success: false,
              statusCode: 400,
              error: "Invalid date range: startDate (2026-10-01) must be before or equal to endDate (2026-04-01)",
              message: "Invalid date range: startDate (2026-10-01) must be before or equal to endDate (2026-04-01)",
              code: "VALIDATION_ERROR",
            },
          },
        },
      },
      TooManyRequestsError: {
        description: "API key or IP rate limit exceeded.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
            example: {
              success: false,
              statusCode: 429,
              error: "Rate limit exceeded. Try again in 60 seconds.",
              message: "Rate limit exceeded. Try again in 60 seconds.",
              code: "RATE_LIMIT_EXCEEDED",
            },
          },
        },
      },
    },
    schemas: {
      HealthResponse: {
        type: "object",
        required: ["status", "version", "uptimeSeconds", "timestamp", "database"],
        properties: {
          status: {
            type: "string",
            enum: ["healthy", "unhealthy"],
            example: "healthy",
          },
          version: {
            type: "string",
            example: "2.3.0",
          },
          uptimeSeconds: {
            type: "integer",
            example: 124,
          },
          timestamp: {
            type: "string",
            format: "date-time",
            example: "2026-09-22T16:30:00.000Z",
          },
          database: {
            type: "object",
            required: ["status", "latencyMs"],
            properties: {
              status: {
                type: "string",
                enum: ["connected", "disconnected"],
                example: "connected",
              },
              latencyMs: {
                type: "number",
                example: 3.2,
              },
              error: {
                type: "string",
                nullable: true,
                example: null,
              },
            },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["success", "error"],
        properties: {
          success: {
            type: "boolean",
            example: false,
          },
          statusCode: {
            type: "integer",
            example: 400,
          },
          error: {
            type: "string",
            example: "Detailed human-readable error description.",
          },
          message: {
            type: "string",
            example: "Detailed human-readable error description.",
          },
          code: {
            type: "string",
            example: "BAD_REQUEST",
          },
        },
      },
      PaginationMeta: {
        type: "object",
        required: ["hasMore", "limit"],
        properties: {
          hasMore: {
            type: "boolean",
            example: true,
          },
          nextCursor: {
            type: "string",
            nullable: true,
            example: "cmu84468l00004s3tnvjagcrz",
          },
          totalCount: {
            type: "integer",
            example: 10,
          },
          limit: {
            type: "integer",
            example: 50,
          },
        },
      },
      CompanyDto: {
        type: "object",
        required: ["id", "name", "createdAt", "updatedAt"],
        properties: {
          id: {
            type: "string",
            example: "cmu84468l00001s3tnvjagcrz",
          },
          name: {
            type: "string",
            example: "Acme Enterprises Private Limited",
          },
          tallyCompanyName: {
            type: "string",
            nullable: true,
            example: "Acme Enterprises (Tally)",
          },
          connectorStatus: {
            type: "string",
            nullable: true,
            example: "ONLINE",
            enum: ["ONLINE", "OFFLINE", "REVOKED", null],
          },
          lastHeartbeat: {
            type: "string",
            format: "date-time",
            nullable: true,
            example: "2026-09-22T13:15:00.000Z",
          },
          lastSyncAt: {
            type: "string",
            format: "date-time",
            nullable: true,
            example: "2026-09-22T13:17:28.452Z",
          },
          createdAt: {
            type: "string",
            format: "date-time",
            example: "2026-09-18T10:00:00.000Z",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            example: "2026-09-22T12:00:00.000Z",
          },
        },
      },
      CompanyResponse: {
        type: "object",
        required: ["success", "data"],
        properties: {
          success: {
            type: "boolean",
            example: true,
          },
          data: {
            $ref: "#/components/schemas/CompanyDto",
          },
        },
      },
      SyncStatusResponse: {
        type: "object",
        required: ["success", "data"],
        properties: {
          success: {
            type: "boolean",
            example: true,
          },
          data: {
            type: "object",
            required: ["companyId", "connectorStatus", "recordsProcessed"],
            properties: {
              companyId: {
                type: "string",
                example: "cmu84468l00001s3tnvjagcrz",
              },
              connectorStatus: {
                type: "string",
                example: "ONLINE",
              },
              lastSyncTime: {
                type: "string",
                format: "date-time",
                nullable: true,
                example: "2026-09-22T16:30:02.150Z",
              },
              lastSyncResult: {
                type: "string",
                nullable: true,
                example: "SYNC_COMPLETED",
              },
              recordsProcessed: {
                type: "integer",
                example: 45,
              },
              connector: {
                type: "object",
                nullable: true,
                properties: {
                  id: { type: "string", example: "cmu84468l00005s3tnvjagcrz" },
                  status: { type: "string", example: "ONLINE" },
                  version: { type: "string", nullable: true, example: "2.4.0" },
                  lastSeenAt: { type: "string", format: "date-time", example: "2026-09-22T16:35:16.272Z" },
                  lastHeartbeat: { type: "string", format: "date-time", example: "2026-09-22T16:35:16.272Z" },
                },
              },
              lastSync: {
                type: "object",
                nullable: true,
                properties: {
                  syncRunId: { type: "string", example: "cmu84468l00006s3tnvjagcrz" },
                  syncType: { type: "string", example: "VOUCHERS" },
                  status: { type: "string", example: "SYNC_COMPLETED" },
                  startedAt: { type: "string", format: "date-time", example: "2026-09-22T16:30:00.000Z" },
                  completedAt: { type: "string", format: "date-time", nullable: true, example: "2026-09-22T16:30:02.150Z" },
                  durationMs: { type: "integer", nullable: true, example: 2150 },
                  recordsProcessed: { type: "integer", example: 45 },
                  recordsCreated: { type: "integer", example: 40 },
                  recordsUpdated: { type: "integer", example: 5 },
                  recordsFailed: { type: "integer", example: 0 },
                  recordsFetched: { type: "integer", example: 45 },
                  errorSummary: { type: "string", nullable: true, example: null },
                },
              },
            },
          },
        },
      },
      LedgerDto: {
        type: "object",
        required: ["id", "name", "groupName", "closingBalance"],
        properties: {
          id: {
            type: "string",
            example: "cmu84468l00002s3tnvjagcrz",
          },
          name: {
            type: "string",
            example: "HDFC Bank Ltd",
          },
          groupName: {
            type: "string",
            example: "Bank Accounts",
          },
          parentType: {
            type: "string",
            example: "Asset",
          },
          openingBalance: {
            type: "number",
            example: 10000.0,
          },
          closingBalance: {
            type: "number",
            example: 15400.5,
          },
          currency: {
            type: "string",
            example: "INR",
          },
        },
      },
      LedgersResponse: {
        type: "object",
        required: ["success", "data", "pagination"],
        properties: {
          success: {
            type: "boolean",
            example: true,
          },
          data: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LedgerDto",
            },
          },
          pagination: {
            $ref: "#/components/schemas/PaginationMeta",
          },
        },
      },
      TrialBalanceItem: {
        type: "object",
        required: ["ledgerId", "ledgerName", "groupName", "debitAmount", "creditAmount"],
        properties: {
          ledgerId: {
            type: "string",
            example: "cmu84468l00002s3tnvjagcrz",
          },
          ledgerName: {
            type: "string",
            example: "Sales Account",
          },
          groupName: {
            type: "string",
            example: "Sales Accounts",
          },
          parentType: {
            type: "string",
            example: "Income",
          },
          debitAmount: {
            type: "number",
            example: 0.0,
          },
          creditAmount: {
            type: "number",
            example: 36000.5,
          },
        },
      },
      TrialBalanceResponse: {
        type: "object",
        required: ["success", "companyId", "data", "totals"],
        properties: {
          success: {
            type: "boolean",
            example: true,
          },
          companyId: {
            type: "string",
            example: "cmu84468l00001s3tnvjagcrz",
          },
          filters: {
            type: "object",
            properties: {
              startDate: {
                type: "string",
                nullable: true,
                example: "2026-04-01T00:00:00.000Z",
              },
              endDate: {
                type: "string",
                nullable: true,
                example: "2027-03-31T00:00:00.000Z",
              },
            },
          },
          data: {
            type: "array",
            items: {
              $ref: "#/components/schemas/TrialBalanceItem",
            },
          },
          totals: {
            type: "object",
            required: ["debitTotal", "creditTotal", "isBalanced"],
            properties: {
              debitTotal: {
                type: "number",
                example: 36000.5,
              },
              creditTotal: {
                type: "number",
                example: 36000.5,
              },
              isBalanced: {
                type: "boolean",
                example: true,
              },
            },
          },
        },
      },
      VoucherEntryDto: {
        type: "object",
        required: ["id", "ledgerId", "ledgerName", "amount", "type"],
        properties: {
          id: {
            type: "string",
            example: "cmu84468l00010s3tnvjagcrz",
          },
          ledgerId: {
            type: "string",
            example: "cmu84468l00002s3tnvjagcrz",
          },
          ledgerName: {
            type: "string",
            example: "Cash in Hand",
          },
          groupName: {
            type: "string",
            example: "Cash-in-hand",
          },
          amount: {
            type: "number",
            example: 2500.0,
          },
          type: {
            type: "string",
            enum: ["debit", "credit"],
            example: "debit",
          },
        },
      },
      VoucherDto: {
        type: "object",
        required: ["id", "voucherNumber", "voucherType", "date", "amount", "entries"],
        properties: {
          id: {
            type: "string",
            example: "cmu84468l00008s3tnvjagcrz",
          },
          voucherNumber: {
            type: "string",
            example: "VCH-007",
          },
          voucherType: {
            type: "string",
            example: "Receipt",
          },
          date: {
            type: "string",
            format: "date-time",
            example: "2026-04-07T00:00:00.000Z",
          },
          partyName: {
            type: "string",
            nullable: true,
            example: "Acme Customer",
          },
          amount: {
            type: "number",
            example: 2500.0,
          },
          entries: {
            type: "array",
            items: {
              $ref: "#/components/schemas/VoucherEntryDto",
            },
          },
        },
      },
      VouchersResponse: {
        type: "object",
        required: ["success", "data", "pagination"],
        properties: {
          success: {
            type: "boolean",
            example: true,
          },
          data: {
            type: "array",
            items: {
              $ref: "#/components/schemas/VoucherDto",
            },
          },
          pagination: {
            $ref: "#/components/schemas/PaginationMeta",
          },
        },
      },
    },
  },
};
