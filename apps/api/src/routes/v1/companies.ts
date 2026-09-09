import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../../db/prisma.js";
import { authenticateApiKey } from "../../auth/api-key.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompanyDto {
  id: string;
  externalCustomerId?: string;
  name: string;
  connectorStatus: string | null;
  lastHeartbeat: string | null;
}

export interface GetCompaniesResponse {
  companies: CompanyDto[];
}

export interface CompanyParams {
  companyId: string;
}

export interface LedgerDto {
  id: string;
  name: string;
  parent: string;
  masterId: number;
  alterId: number;
  updatedAt: string;
}

export interface GetCompanyLedgersResponse {
  companyId: string;
  ledgers: LedgerDto[];
}

export interface VoucherEntryDto {
  ledgerId: string;
  ledgerName: string;
  amount: number;
  type: string;
}

export interface VoucherDto {
  id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyName?: string;
  amount: number;
  entries: VoucherEntryDto[];
}

export interface GetCompanyVouchersResponse {
  companyId: string;
  vouchers: VoucherDto[];
}

export interface TriggerSyncBody {
  type: string;
}

export interface TriggerSyncResponse {
  success: true;
  jobId: string;
  status: string;
}

export interface SyncJobDto {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface GetSyncStatusResponse {
  success: true;
  companyId: string;
  jobId: string | null;
  type: string | null;
  status: string | null;
  createdAt: string | null;
  completedAt: string | null;
  job: SyncJobDto | null;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const triggerSyncSchema = {
  params: {
    type: "object",
    required: ["companyId"],
    properties: {
      companyId: { type: "string" },
    },
  },
  body: {
    type: "object",
    required: ["type"],
    properties: {
      type: { type: "string" },
    },
  },
} as const;

const syncStatusSchema = {
  params: {
    type: "object",
    required: ["companyId"],
    properties: {
      companyId: { type: "string" },
    },
  },
} as const;

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * GET /v1/companies
 * Return only companies mapped to the authenticated SaaS application.
 */
async function handleGetCompanies(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<GetCompaniesResponse> {
  const saasApp = request.saasApplication;

  const mappings = await prisma.saasCompanyMapping.findMany({
    where: { saasApplicationId: saasApp.id },
    include: {
      company: {
        include: {
          connectors: {
            orderBy: { lastHeartbeat: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const companies: CompanyDto[] = mappings.map((m) => {
    const latestConnector = m.company.connectors[0] ?? null;

    const companyDto: CompanyDto = {
      id: m.company.id,
      name: m.company.name,
      connectorStatus: latestConnector ? latestConnector.status : null,
      lastHeartbeat: latestConnector?.lastHeartbeat
        ? latestConnector.lastHeartbeat.toISOString()
        : null,
    };

    if (m.externalCustomerId) {
      companyDto.externalCustomerId = m.externalCustomerId;
    }

    return companyDto;
  });

  return reply.status(200).send({ companies });
}

/**
 * GET /v1/companies/:companyId/ledgers
 * Return ledgers for a mapped company with deterministic ordering (name, then masterId).
 */
async function handleGetCompanyLedgers(
  request: FastifyRequest<{ Params: CompanyParams }>,
  reply: FastifyReply
): Promise<GetCompanyLedgersResponse> {
  const saasApp = request.saasApplication;
  const { companyId } = request.params;

  // Verify company is mapped to this SaaS application without leaking company existence
  const mapping = await prisma.saasCompanyMapping.findUnique({
    where: {
      saasApplicationId_companyId: {
        saasApplicationId: saasApp.id,
        companyId,
      },
    },
  });

  if (!mapping) {
    return reply.status(404).send({
      success: false,
      error: `Company "${companyId}" not found.`,
    } as never);
  }

  const ledgers = await prisma.ledger.findMany({
    where: { companyId },
    orderBy: [
      { name: "asc" },
      { masterId: "asc" },
    ],
  });

  const ledgerDtos: LedgerDto[] = ledgers.map((l) => ({
    id: l.id,
    name: l.name,
    parent: l.parent,
    masterId: l.masterId,
    alterId: l.alterId,
    updatedAt: l.updatedAt.toISOString(),
  }));

  return reply.status(200).send({
    companyId,
    ledgers: ledgerDtos,
  });
}

/**
 * GET /v1/companies/:companyId/vouchers
 * Return vouchers for a mapped company ordered by date descending, then id.
 */
async function handleGetCompanyVouchers(
  request: FastifyRequest<{ Params: CompanyParams }>,
  reply: FastifyReply
): Promise<GetCompanyVouchersResponse> {
  const saasApp = request.saasApplication;
  const { companyId } = request.params;

  // Verify company is mapped to this SaaS application without leaking company existence
  const mapping = await prisma.saasCompanyMapping.findUnique({
    where: {
      saasApplicationId_companyId: {
        saasApplicationId: saasApp.id,
        companyId,
      },
    },
  });

  if (!mapping) {
    return reply.status(404).send({
      success: false,
      error: `Company "${companyId}" not found.`,
    } as never);
  }

  const vouchers = await prisma.voucher.findMany({
    where: { companyId },
    include: {
      voucherEntries: {
        include: {
          ledger: true,
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [
      { date: "desc" },
      { id: "asc" },
    ],
  });

  const voucherDtos: VoucherDto[] = vouchers.map((v) => {
    const voucherDto: VoucherDto = {
      id: v.id,
      voucherNumber: v.voucherNumber,
      voucherType: v.voucherType,
      date: v.date.toISOString(),
      amount: v.amount,
      entries: v.voucherEntries.map((e) => ({
        ledgerId: e.ledgerId,
        ledgerName: e.ledger.name,
        amount: e.amount,
        type: e.type,
      })),
    };

    if (v.partyName) {
      voucherDto.partyName = v.partyName;
    }

    return voucherDto;
  });

  return reply.status(200).send({
    companyId,
    vouchers: voucherDtos,
  });
}

/**
 * POST /v1/companies/:companyId/sync
 * Trigger a sync job for an active connector belonging to the mapped company.
 */
async function handleTriggerSync(
  request: FastifyRequest<{ Params: CompanyParams; Body: TriggerSyncBody }>,
  reply: FastifyReply
): Promise<TriggerSyncResponse> {
  const saasApp = request.saasApplication;
  const { companyId } = request.params;
  const { type } = request.body;

  // 1. Verify company is mapped to this SaaS application
  const mapping = await prisma.saasCompanyMapping.findUnique({
    where: {
      saasApplicationId_companyId: {
        saasApplicationId: saasApp.id,
        companyId,
      },
    },
  });

  if (!mapping) {
    return reply.status(404).send({
      success: false,
      error: `Company "${companyId}" not found.`,
    } as never);
  }

  // 2. Validate sync type
  const normalizedType = (type ?? "").trim().toUpperCase();
  if (!["LEDGERS", "VOUCHERS", "BOTH"].includes(normalizedType)) {
    return reply.status(400).send({
      success: false,
      error: `Invalid sync type "${type}". Supported types: LEDGERS, VOUCHERS, BOTH.`,
    } as never);
  }

  // 3. Find an active connector for that company
  const connector = await prisma.connector.findFirst({
    where: {
      companyId,
      status: "ONLINE",
    },
    orderBy: {
      lastHeartbeat: "desc",
    },
  });

  if (!connector) {
    return reply.status(404).send({
      success: false,
      error: "No active connector found for this company.",
    } as never);
  }

  // 4. Create SyncJob
  const job = await prisma.syncJob.create({
    data: {
      connectorId: connector.id,
      type: normalizedType,
      status: "PENDING",
    },
  });

  request.log.info(
    { jobId: job.id, connectorId: connector.id, type: normalizedType, companyId },
    "SaaS triggered sync job created"
  );

  return reply.status(200).send({
    success: true,
    jobId: job.id,
    status: job.status,
  });
}

/**
 * GET /v1/companies/:companyId/sync/status
 * Return the latest sync job status for connectors belonging to the mapped company.
 */
async function handleGetSyncStatus(
  request: FastifyRequest<{ Params: CompanyParams }>,
  reply: FastifyReply
): Promise<GetSyncStatusResponse> {
  const saasApp = request.saasApplication;
  const { companyId } = request.params;

  // 1. Verify company is mapped to this SaaS application
  const mapping = await prisma.saasCompanyMapping.findUnique({
    where: {
      saasApplicationId_companyId: {
        saasApplicationId: saasApp.id,
        companyId,
      },
    },
  });

  if (!mapping) {
    return reply.status(404).send({
      success: false,
      error: `Company "${companyId}" not found.`,
    } as never);
  }

  // 2. Find latest sync job for connectors belonging to this company
  const latestJob = await prisma.syncJob.findFirst({
    where: {
      connector: {
        companyId,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!latestJob) {
    return reply.status(200).send({
      success: true,
      companyId,
      jobId: null,
      type: null,
      status: null,
      createdAt: null,
      completedAt: null,
      job: null,
    });
  }

  const jobDto: SyncJobDto = {
    id: latestJob.id,
    type: latestJob.type,
    status: latestJob.status,
    createdAt: latestJob.createdAt.toISOString(),
    completedAt: latestJob.completedAt ? latestJob.completedAt.toISOString() : null,
  };

  return reply.status(200).send({
    success: true,
    companyId,
    jobId: latestJob.id,
    type: latestJob.type,
    status: latestJob.status,
    createdAt: latestJob.createdAt.toISOString(),
    completedAt: latestJob.completedAt ? latestJob.completedAt.toISOString() : null,
    job: jobDto,
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function v1Routes(app: FastifyInstance): Promise<void> {
  // Enforce API key authentication on all /v1 routes
  app.addHook("preHandler", authenticateApiKey);

  app.get("/companies", handleGetCompanies);
  app.get<{ Params: CompanyParams }>("/companies/:companyId/ledgers", handleGetCompanyLedgers);
  app.get<{ Params: CompanyParams }>("/companies/:companyId/vouchers", handleGetCompanyVouchers);
  app.post<{ Params: CompanyParams; Body: TriggerSyncBody }>(
    "/companies/:companyId/sync",
    { schema: triggerSyncSchema },
    handleTriggerSync
  );
  app.get<{ Params: CompanyParams }>(
    "/companies/:companyId/sync/status",
    { schema: syncStatusSchema },
    handleGetSyncStatus
  );
}

