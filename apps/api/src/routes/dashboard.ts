import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateFinancialSummary } from "../services/financial-summary-service.js";
import {
  authenticateUserOrConnector,
  requireTenantCompanyAccess,
} from "../auth/tenant-auth.js";
import { generateUserToken, hashUserToken, optionalAuthenticateUser } from "../auth/user-auth.js";

// ─── GET /dashboard ───────────────────────────────────────────────────────────
// Serves the dashboard HTML shell (redirect to static file below).

// ─── GET /dashboard/data ──────────────────────────────────────────────────────
// Returns scoped live data needed by the dashboard for the authenticated entity.
// Rejects unauthenticated callers with 401.

async function handleDashboardData(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = request.user;
  const connector = request.connector;

  // Determine authorized company scope
  let allowedCompanyIds: string[] | undefined;

  if (user) {
    if (user.role !== "SUPER_ADMIN") {
      allowedCompanyIds = (request.userMemberships ?? []).map((m) => m.companyId);
    }
  } else if (connector) {
    allowedCompanyIds = connector.companyId ? [connector.companyId] : [];
  } else {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized: Missing authentication credentials.",
    });
  }

  const companyWhere = allowedCompanyIds ? { id: { in: allowedCompanyIds } } : {};
  const jobWhere = allowedCompanyIds ? { connector: { companyId: { in: allowedCompanyIds } } } : {};

  // 1. Authorized companies with their latest connector
  const companies = await prisma.company.findMany({
    where: companyWhere,
    include: {
      connectors: {
        orderBy: { lastHeartbeat: "desc" },
      },
      syncLogs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      syncHistories: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      _count: {
        select: { ledgers: true, vouchers: true, trialBalanceEntries: true },
      },
      googleConnection: {
        select: { googleEmail: true, spreadsheetId: true, spreadsheetUrl: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // 2. Recent sync jobs for authorized companies (last 20)
  const recentJobs = await prisma.syncJob.findMany({
    where: jobWhere,
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      connector: {
        select: { name: true, companyId: true },
      },
    },
  });

  const companiesDto = companies.map((c) => {
    const connector = c.connectors[0] ?? null;
    const lastLog = c.syncLogs[0] ?? null;
    const allConnectors = c.connectors.map((conn) => ({
      id: conn.id,
      name: conn.name,
      operatingSystem: conn.operatingSystem || "Windows / PC",
      status: conn.status,
      setupStatus: conn.setupStatus,
      tallyCompanyName: conn.tallyCompanyName,
      deviceId: conn.deviceId,
      lastHeartbeat: conn.lastHeartbeat?.toISOString() ?? null,
    }));

    return {
      id: c.id,
      name: c.name,
      tallyCompanyName: c.tallyCompanyName,
      ledgerCount: c._count.ledgers,
      voucherCount: c._count.vouchers,
      trialBalanceCount: c._count.trialBalanceEntries,
      connector: allConnectors[0] ?? null,
      connectors: allConnectors,
      lastSync: lastLog
        ? {
            created: lastLog.created,
            updated: lastLog.updated,
            unchanged: lastLog.unchanged,
            at: lastLog.createdAt.toISOString(),
          }
        : null,
      syncHistory: c.syncHistories[0]
        ? {
            id: c.syncHistories[0].id,
            syncType: c.syncHistories[0].syncType,
            status: c.syncHistories[0].status,
            startedAt: c.syncHistories[0].startedAt.toISOString(),
            completedAt: c.syncHistories[0].completedAt?.toISOString() ?? null,
            recordsUpdated: c.syncHistories[0].recordsUpdated,
            googleStatus: c.syncHistories[0].googleStatus,
            googleError: c.syncHistories[0].googleError,
          }
        : null,
      totalRecords: c._count.ledgers + c._count.vouchers + c._count.trialBalanceEntries,
      googleConnection: c.googleConnection
        ? {
            googleEmail: c.googleConnection.googleEmail,
            spreadsheetId: c.googleConnection.spreadsheetId,
            spreadsheetUrl: c.googleConnection.spreadsheetUrl,
          }
        : null,
    };
  });

  const jobsDto = recentJobs.map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status,
    connectorName: j.connector.name,
    companyId: j.connector.companyId ?? null,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  }));

  return reply.status(200).send({ companies: companiesDto, recentJobs: jobsDto });
}

// ─── GET /dashboard/data/ledgers ──────────────────────────────────────────────

async function handleLedgersData(
  request: FastifyRequest<{ Querystring: { companyId?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.query as { companyId?: string };
  const user = request.user;
  const connector = request.connector;

  let allowedCompanyIds: string[] | undefined;
  if (user && user.role !== "SUPER_ADMIN") {
    allowedCompanyIds = (request.userMemberships ?? []).map((m) => m.companyId);
  } else if (connector) {
    allowedCompanyIds = connector.companyId ? [connector.companyId] : [];
  }

  const companies = await prisma.company.findMany({
    where: allowedCompanyIds ? { id: { in: allowedCompanyIds } } : {},
    select: { id: true, name: true, tallyCompanyName: true },
    orderBy: { createdAt: "asc" },
  });

  if (!companyId && companies.length === 0) {
    return reply.status(200).send({ companies, ledgers: [] });
  }

  const targetId = companyId ?? companies[0]?.id;
  const ledgers = targetId
    ? await prisma.ledger.findMany({
        where: { companyId: targetId },
        orderBy: [{ name: "asc" }, { masterId: "asc" }],
      })
    : [];

  return reply.status(200).send({
    companies,
    selectedCompanyId: targetId ?? null,
    ledgers: ledgers.map((l) => ({
      id: l.id,
      name: l.name,
      parent: l.parent,
      masterId: l.masterId,
      alterId: l.alterId,
      updatedAt: l.updatedAt.toISOString(),
    })),
  });
}

// ─── GET /dashboard/data/vouchers ─────────────────────────────────────────────

async function handleVouchersData(
  request: FastifyRequest<{ Querystring: { companyId?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.query as { companyId?: string };
  const user = request.user;
  const connector = request.connector;

  let allowedCompanyIds: string[] | undefined;
  if (user && user.role !== "SUPER_ADMIN") {
    allowedCompanyIds = (request.userMemberships ?? []).map((m) => m.companyId);
  } else if (connector) {
    allowedCompanyIds = connector.companyId ? [connector.companyId] : [];
  }

  const companies = await prisma.company.findMany({
    where: allowedCompanyIds ? { id: { in: allowedCompanyIds } } : {},
    select: { id: true, name: true, tallyCompanyName: true },
    orderBy: { createdAt: "asc" },
  });

  const targetId = companyId ?? companies[0]?.id;
  const vouchers = targetId
    ? await prisma.voucher.findMany({
        where: { companyId: targetId },
        include: {
          voucherEntries: {
            include: { ledger: { select: { name: true } } },
            orderBy: { id: "asc" },
          },
        },
        orderBy: [{ date: "desc" }, { id: "asc" }],
        take: 200,
      })
    : [];

  return reply.status(200).send({
    companies,
    selectedCompanyId: targetId ?? null,
    vouchers: vouchers.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      voucherType: v.voucherType,
      date: v.date.toISOString(),
      partyName: v.partyName ?? null,
      amount: Number(v.amount),
      entryCount: v.voucherEntries.length,
      entries: v.voucherEntries.map((e) => ({
        ledgerName: e.ledger.name,
        amount: Number(e.amount),
        type: e.type,
      })),
    })),
  });
}

// ─── GET /dashboard/data/trial-balance ───────────────────────────────────────

async function handleTrialBalanceData(
  request: FastifyRequest<{ Querystring: { companyId?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.query as { companyId?: string };
  const user = request.user;
  const connector = request.connector;

  let allowedCompanyIds: string[] | undefined;
  if (user && user.role !== "SUPER_ADMIN") {
    allowedCompanyIds = (request.userMemberships ?? []).map((m) => m.companyId);
  } else if (connector) {
    allowedCompanyIds = connector.companyId ? [connector.companyId] : [];
  }

  const companies = await prisma.company.findMany({
    where: allowedCompanyIds ? { id: { in: allowedCompanyIds } } : {},
    select: { id: true, name: true, tallyCompanyName: true },
    orderBy: { createdAt: "asc" },
  });

  if (!companyId && companies.length === 0) {
    return reply.status(200).send({
      companies,
      selectedCompanyId: null,
      trialBalance: [],
      totals: { debitTotal: 0, creditTotal: 0 },
    });
  }

  const targetId = companyId ?? companies[0]?.id;
  const entries = targetId
    ? await prisma.trialBalanceEntry.findMany({
        where: { companyId: targetId },
        orderBy: [{ groupName: "asc" }, { ledgerName: "asc" }],
      })
    : [];

  const debitTotal = entries.reduce((acc, e) => acc + e.debitAmount, 0);
  const creditTotal = entries.reduce((acc, e) => acc + e.creditAmount, 0);

  return reply.status(200).send({
    companies,
    selectedCompanyId: targetId ?? null,
    trialBalance: entries.map((e) => ({
      id: e.id,
      ledgerName: e.ledgerName,
      groupName: e.groupName,
      debitAmount: e.debitAmount,
      creditAmount: e.creditAmount,
      updatedAt: e.updatedAt.toISOString(),
    })),
    totals: {
      debitTotal,
      creditTotal,
    },
  });
}

// ─── POST /setup/provision ────────────────────────────────────────────────────
// Creates the Company in the DB and returns a ready-to-use connector config.

interface ProvisionBody {
  companyName: string;
  tallyUrl: string;
  apiUrl: string;
  connectorName?: string;
}

async function handleProvision(
  request: FastifyRequest<{ Body: ProvisionBody }>,
  reply: FastifyReply
): Promise<void> {
  const { companyName, tallyUrl, apiUrl, connectorName } = request.body;

  if (!companyName?.trim() || !tallyUrl?.trim() || !apiUrl?.trim()) {
    return reply.status(400).send({ success: false, error: "companyName, tallyUrl, and apiUrl are required." });
  }

  const cleanName = companyName.trim();

  // 1. Anti-Hijacking Security Check: Never allow provisioning an existing company
  const existingCompany = await prisma.company.findFirst({
    where: {
      OR: [
        { tallyCompanyName: cleanName },
        { name: cleanName },
      ],
    },
  });

  if (existingCompany) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: Company already exists. Cannot provision an existing company.",
    });
  }

  // 2. Safe creation flow (atomic create)
  const company = await prisma.company.create({
    data: {
      name: cleanName,
      tallyCompanyName: cleanName,
    },
  });

  // 3. If request is made by an authenticated user, bind the user as OWNER
  if (request.user) {
    await prisma.companyMember.create({
      data: {
        userId: request.user.id,
        companyId: company.id,
        role: "OWNER",
      },
    });
  }

  const connectorConfig = {
    apiUrl: apiUrl.trim(),
    tallyUrl: tallyUrl.trim(),
    companyName: cleanName,
    connectorName: connectorName?.trim() || "FinLayer Connector",
  };

  return reply.status(200).send({
    success: true,
    companyId: company.id,
    companyName: company.name,
    connectorConfig,
  });
}

// ─── POST /dashboard/sync ─────────────────────────────────────────────────────
// Trigger a sync job directly by companyId — requires tenant company access.

interface TriggerSyncBody {
  companyId: string;
  type: "LEDGERS" | "VOUCHERS" | "BOTH" | "TRIAL_BALANCE" | "FINANCIAL_DATA";
}

async function handleDashboardSync(
  request: FastifyRequest<{ Body: TriggerSyncBody }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId, type } = request.body;

  const connector = await prisma.connector.findFirst({
    where: { companyId, status: "ONLINE" },
    orderBy: { lastHeartbeat: "desc" },
  });

  if (!connector) {
    return reply.status(404).send({ success: false, error: "No active connector found for this company." });
  }

  const job = await prisma.syncJob.create({
    data: { connectorId: connector.id, type, status: "PENDING" },
  });

  await prisma.syncHistory.create({
    data: {
      companyId,
      syncType: type,
      status: "IN_PROGRESS",
    },
  });

  return reply.status(200).send({ success: true, jobId: job.id, status: job.status });
}

// ─── GET /dashboard/financial-summary/:companyId ──────────────────────────────
async function handleFinancialSummary(
  request: FastifyRequest<{ Params: { companyId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
  }

  const summary = await calculateFinancialSummary(companyId);
  return reply.status(200).send(summary);
}

// ─── GET /dashboard/sync-history/:companyId ───────────────────────────────────
async function handleSyncHistory(
  request: FastifyRequest<{ Params: { companyId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
  }

  const history = await prisma.syncHistory.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return reply.status(200).send({
    success: true,
    companyId,
    history: history.map((h) => ({
      id: h.id,
      syncType: h.syncType,
      status: h.status,
      startedAt: h.startedAt.toISOString(),
      completedAt: h.completedAt?.toISOString() ?? null,
      recordsUpdated: h.recordsUpdated,
      googleStatus: h.googleStatus,
      googleError: h.googleError,
      formattedDate: h.completedAt
        ? new Date(h.completedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : new Date(h.startedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      formattedTime: h.completedAt
        ? new Date(h.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
        : new Date(h.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    })),
  });
}

// ─── POST /auth/session ───────────────────────────────────────────────────────
// Internal testing & dev session bootstrap endpoint (NOT final production SaaS user authentication).
// In production, strictly restricted by x-admin-key to prevent unauthorized session generation.
interface CreateSessionBody {
  email: string;
  name?: string;
  companyId?: string;
  role?: string;
}

async function handleCreateSession(
  request: FastifyRequest<{ Body: CreateSessionBody }>,
  reply: FastifyReply
): Promise<void> {
  // Enforce admin-key in production for this internal testing bootstrap endpoint
  if (process.env.NODE_ENV === "production") {
    const adminKey = request.headers["x-admin-key"];
    const expectedKey = process.env.ADMIN_API_KEY;
    if (!expectedKey || adminKey !== expectedKey) {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: Internal test session endpoint requires valid x-admin-key in production.",
      });
    }
  }

  const { email, name, companyId, role } = request.body || {};

  if (!email || !email.trim()) {
    return reply.status(400).send({ success: false, error: "email is required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const userName = name?.trim() || cleanEmail.split("@")[0] || "User";

  // Upsert user
  const user = await prisma.user.upsert({
    where: { email: cleanEmail },
    update: { name: userName },
    create: {
      email: cleanEmail,
      name: userName,
      role: role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER",
    },
  });

  // If companyId is provided, grant membership
  if (companyId) {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (company) {
      await prisma.companyMember.upsert({
        where: {
          userId_companyId: {
            userId: user.id,
            companyId: company.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          companyId: company.id,
          role: "OWNER",
        },
      });
    }
  }

  // Generate session token
  const token = generateUserToken();
  const tokenHash = hashUserToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  return reply.status(200).send({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

function serveHtml(name: string) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    const htmlPath = resolve(dirname(fileURLToPath(import.meta.url)), `../../public/${name}`);
    const html = readFileSync(htmlPath, "utf-8");
    return reply.type("text/html").send(html);
  };
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // ── HTML pages ──
  app.get("/dashboard",               serveHtml("dashboard.html"));
  app.get("/dashboard/ledgers",       serveHtml("ledgers.html"));
  app.get("/dashboard/vouchers",      serveHtml("vouchers.html"));
  app.get("/dashboard/trial-balance", serveHtml("trial-balance.html"));
  app.get("/dashboard/sync-history",  serveHtml("sync-history.html"));
  app.get("/setup",                   serveHtml("setup.html"));
  app.get("/setup/tally",             serveHtml("setup-tally.html"));
  app.get("/setup/google",            serveHtml("setup-google.html"));

  // ── Session Auth Endpoint ──
  app.post<{ Body: CreateSessionBody }>(
    "/auth/session",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string" },
            name: { type: "string" },
            companyId: { type: "string" },
            role: { type: "string" },
          },
        },
      },
    },
    handleCreateSession
  );

  // ── Data endpoints (Secured with Zero Fail-Open Authentication) ──
  app.get(
    "/dashboard/data",
    { preHandler: [authenticateUserOrConnector] },
    handleDashboardData
  );

  app.get<{ Querystring: { companyId?: string } }>(
    "/dashboard/data/ledgers",
    { preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()] },
    handleLedgersData
  );

  app.get<{ Querystring: { companyId?: string } }>(
    "/dashboard/data/vouchers",
    { preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()] },
    handleVouchersData
  );

  app.get<{ Querystring: { companyId?: string } }>(
    "/dashboard/data/trial-balance",
    { preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()] },
    handleTrialBalanceData
  );

  app.get<{ Params: { companyId: string } }>(
    "/dashboard/financial-summary/:companyId",
    { preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()] },
    handleFinancialSummary
  );

  app.get<{ Params: { companyId: string } }>(
    "/dashboard/sync-history/:companyId",
    { preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()] },
    handleSyncHistory
  );

  // ── Actions ──
  app.post<{ Body: TriggerSyncBody }>(
    "/dashboard/sync",
    {
      schema: {
        body: {
          type: "object",
          required: ["companyId", "type"],
          properties: {
            companyId: { type: "string" },
            type: { type: "string", enum: ["LEDGERS", "VOUCHERS", "BOTH", "TRIAL_BALANCE", "FINANCIAL_DATA"] },
          },
        },
      },
      preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()],
    },
    handleDashboardSync
  );

  app.post<{ Body: ProvisionBody }>(
    "/setup/provision",
    {
      schema: {
        body: {
          type: "object",
          required: ["companyName", "tallyUrl", "apiUrl"],
          properties: {
            companyName:   { type: "string" },
            tallyUrl:      { type: "string" },
            apiUrl:        { type: "string" },
            connectorName: { type: "string" },
          },
        },
      },
      preHandler: [optionalAuthenticateUser],
    },
    handleProvision
  );
}
