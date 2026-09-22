import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import {
  authenticateSaasApiKey,
  requireSaasCompanyAccess,
} from "../auth/saas-auth.js";
import { validateDateRange } from "../services/canonical-export-service.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface CompanyParams {
  companyId: string;
}

interface LedgersQuery {
  limit?: string;
  cursor?: string;
}

interface VouchersQuery {
  limit?: string;
  cursor?: string;
  startDate?: string;
  endDate?: string;
  fromDate?: string;
  toDate?: string;
  stream?: string;
}

interface TrialBalanceQuery {
  startDate?: string;
  endDate?: string;
  fromDate?: string;
  toDate?: string;
  asOfDate?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBoundedLimit(rawLimit?: string, defaultVal = 50, maxVal = 250): number {
  if (!rawLimit) return defaultVal;
  const num = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(num) || num < 1) return defaultVal;
  return Math.min(num, maxVal);
}

function formatVoucherDto(v: any) {
  return {
    id: v.id,
    voucherNumber: v.voucherNumber,
    voucherType: v.voucherType,
    date: v.date instanceof Date ? v.date.toISOString() : String(v.date),
    partyName: v.partyName ?? null,
    amount: Number(v.amount),
    entries: (v.voucherEntries || []).map((e: any) => ({
      id: e.id,
      ledgerId: e.ledgerId,
      ledgerName: e.ledger?.name ?? "Unknown",
      groupName: e.ledger?.parent ?? "Unknown",
      amount: Number(e.amount),
      type: e.type,
    })),
  };
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * 1. GET /api/v1/companies/:companyId
 * Return company metadata.
 */
async function handleGetCompany(
  request: FastifyRequest<{ Params: CompanyParams }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      connectors: {
        orderBy: { lastHeartbeat: "desc" },
        take: 1,
      },
      syncRuns: {
        where: { status: "SYNC_COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!company) {
    return reply.status(404).send({
      success: false,
      error: `Company "${companyId}" not found.`,
    });
  }

  const latestConnector = company.connectors[0] ?? null;
  const latestSync = company.syncRuns[0] ?? null;

  return reply.status(200).send({
    success: true,
    data: {
      id: company.id,
      name: company.name,
      tallyCompanyName: company.tallyCompanyName,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
      connectorStatus: latestConnector ? latestConnector.status : null,
      lastHeartbeat: latestConnector?.lastHeartbeat
        ? latestConnector.lastHeartbeat.toISOString()
        : null,
      lastSyncAt: latestSync?.completedAt ? latestSync.completedAt.toISOString() : null,
    },
  });
}

/**
 * 2. GET /api/v1/companies/:companyId/ledgers
 * Return canonical ledger data with database cursor pagination.
 */
async function handleGetLedgers(
  request: FastifyRequest<{ Params: CompanyParams; Querystring: LedgersQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;
  const limit = parseBoundedLimit(request.query.limit, 50, 250);
  const cursor = request.query.cursor ? String(request.query.cursor).trim() : undefined;

  // Use indexed database pagination on (companyId, id)
  const ledgers = await prisma.ledger.findMany({
    where: { companyId },
    take: limit + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const hasMore = ledgers.length > limit;
  const data = hasMore ? ledgers.slice(0, limit) : ledgers;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;

  return reply.status(200).send({
    success: true,
    companyId,
    data: data.map((l) => ({
      id: l.id,
      name: l.name,
      parent: l.parent,
      masterId: l.masterId,
      alterId: l.alterId,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
    pagination: {
      limit,
      cursor: cursor ?? null,
      nextCursor,
      hasMore,
    },
  });
}

/**
 * 3. GET /api/v1/companies/:companyId/trial-balance
 * Return canonical trial balance with date filtering and company isolation.
 */
async function handleGetTrialBalance(
  request: FastifyRequest<{ Params: CompanyParams; Querystring: TrialBalanceQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;
  const fromDateStr = request.query.fromDate || request.query.startDate;
  const toDateStr = request.query.toDate || request.query.endDate || request.query.asOfDate;

  // Validate date range if provided
  const dateValidation = validateDateRange(fromDateStr, toDateStr);
  if (!dateValidation.valid) {
    return reply.status(400).send({
      success: false,
      error: dateValidation.error,
    });
  }

  const { startDate, endDate } = dateValidation.range;

  // If a date range was supplied, aggregate ledger debit/credit totals from transaction vouchers
  if (startDate || endDate) {
    const vouchers = await prisma.voucher.findMany({
      where: {
        companyId,
        date: {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {}),
        },
      },
      select: {
        voucherEntries: {
          select: {
            ledgerId: true,
            amount: true,
            type: true,
            ledger: {
              select: { id: true, name: true, parent: true },
            },
          },
        },
      },
    });

    const ledgerMap = new Map<
      string,
      {
        ledgerId: string;
        ledgerName: string;
        groupName: string;
        debitAmount: number;
        creditAmount: number;
      }
    >();

    for (const v of vouchers) {
      for (const e of v.voucherEntries) {
        let item = ledgerMap.get(e.ledgerId);
        if (!item) {
          item = {
            ledgerId: e.ledgerId,
            ledgerName: e.ledger?.name ?? "Unknown",
            groupName: e.ledger?.parent ?? "Unknown",
            debitAmount: 0,
            creditAmount: 0,
          };
          ledgerMap.set(e.ledgerId, item);
        }
        const amt = Number(e.amount);
        if (e.type === "debit") {
          item.debitAmount += amt;
        } else {
          item.creditAmount += amt;
        }
      }
    }

    const tbEntries = Array.from(ledgerMap.values()).sort(
      (a, b) => a.groupName.localeCompare(b.groupName) || a.ledgerName.localeCompare(b.ledgerName)
    );

    const debitTotal = Math.round(tbEntries.reduce((sum, e) => sum + e.debitAmount, 0) * 100) / 100;
    const creditTotal = Math.round(tbEntries.reduce((sum, e) => sum + e.creditAmount, 0) * 100) / 100;

    return reply.status(200).send({
      success: true,
      companyId,
      filters: {
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
      },
      data: tbEntries.map((e) => ({
        ledgerId: e.ledgerId,
        ledgerName: e.ledgerName,
        groupName: e.groupName,
        debitAmount: Number(e.debitAmount.toFixed(2)),
        creditAmount: Number(e.creditAmount.toFixed(2)),
        netBalance: Number((e.debitAmount - e.creditAmount).toFixed(2)),
      })),
      totals: {
        debitTotal,
        creditTotal,
        isBalanced: Math.abs(debitTotal - creditTotal) < 0.01,
      },
    });
  }

  // If no date range filter was supplied, check canonical TrialBalanceEntry snapshot
  const tbRecords = await prisma.trialBalanceEntry.findMany({
    where: { companyId },
    orderBy: [{ groupName: "asc" }, { ledgerName: "asc" }],
  });

  if (tbRecords.length > 0) {
    const debitTotal = Math.round(tbRecords.reduce((sum, e) => sum + e.debitAmount, 0) * 100) / 100;
    const creditTotal = Math.round(tbRecords.reduce((sum, e) => sum + e.creditAmount, 0) * 100) / 100;

    return reply.status(200).send({
      success: true,
      companyId,
      filters: {
        startDate: null,
        endDate: null,
      },
      data: tbRecords.map((e) => ({
        id: e.id,
        ledgerName: e.ledgerName,
        groupName: e.groupName,
        debitAmount: Number(e.debitAmount.toFixed(2)),
        creditAmount: Number(e.creditAmount.toFixed(2)),
        netBalance: Number((e.debitAmount - e.creditAmount).toFixed(2)),
      })),
      totals: {
        debitTotal,
        creditTotal,
        isBalanced: Math.abs(debitTotal - creditTotal) < 0.01,
      },
    });
  }

  // Fallback: compute from all vouchers if no TrialBalanceEntry snapshot exists yet
  const vouchers = await prisma.voucher.findMany({
    where: { companyId },
    select: {
      voucherEntries: {
        select: {
          ledgerId: true,
          amount: true,
          type: true,
          ledger: {
            select: { id: true, name: true, parent: true },
          },
        },
      },
    },
  });

  const ledgerMap = new Map<
    string,
    {
      ledgerId: string;
      ledgerName: string;
      groupName: string;
      debitAmount: number;
      creditAmount: number;
    }
  >();

  for (const v of vouchers) {
    for (const e of v.voucherEntries) {
      let item = ledgerMap.get(e.ledgerId);
      if (!item) {
        item = {
          ledgerId: e.ledgerId,
          ledgerName: e.ledger?.name ?? "Unknown",
          groupName: e.ledger?.parent ?? "Unknown",
          debitAmount: 0,
          creditAmount: 0,
        };
        ledgerMap.set(e.ledgerId, item);
      }
      const amt = Number(e.amount);
      if (e.type === "debit") {
        item.debitAmount += amt;
      } else {
        item.creditAmount += amt;
      }
    }
  }

  const tbEntries = Array.from(ledgerMap.values()).sort(
    (a, b) => a.groupName.localeCompare(b.groupName) || a.ledgerName.localeCompare(b.ledgerName)
  );

  const debitTotal = Math.round(tbEntries.reduce((sum, e) => sum + e.debitAmount, 0) * 100) / 100;
  const creditTotal = Math.round(tbEntries.reduce((sum, e) => sum + e.creditAmount, 0) * 100) / 100;

  return reply.status(200).send({
    success: true,
    companyId,
    filters: {
      startDate: null,
      endDate: null,
    },
    data: tbEntries.map((e) => ({
      ledgerId: e.ledgerId,
      ledgerName: e.ledgerName,
      groupName: e.groupName,
      debitAmount: Number(e.debitAmount.toFixed(2)),
      creditAmount: Number(e.creditAmount.toFixed(2)),
      netBalance: Number((e.debitAmount - e.creditAmount).toFixed(2)),
    })),
    totals: {
      debitTotal,
      creditTotal,
      isBalanced: Math.abs(debitTotal - creditTotal) < 0.01,
    },
  });
}

/**
 * 4. GET /api/v1/companies/:companyId/vouchers
 * Return voucher data with database cursor pagination, date filtering, and streaming support.
 * Never loads full dataset into memory — strictly O(batch size) memory.
 */
async function handleGetVouchers(
  request: FastifyRequest<{ Params: CompanyParams; Querystring: VouchersQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;
  const fromDateStr = request.query.fromDate || request.query.startDate;
  const toDateStr = request.query.toDate || request.query.endDate;
  const isStream =
    request.query.stream === "true" ||
    request.headers.accept?.includes("application/x-ndjson");

  // Validate date range if provided
  const dateValidation = validateDateRange(fromDateStr, toDateStr);
  if (!dateValidation.valid) {
    return reply.status(400).send({
      success: false,
      error: dateValidation.error,
    });
  }

  const { startDate, endDate } = dateValidation.range;

  const whereClause: any = {
    companyId,
  };

  if (startDate || endDate) {
    whereClause.date = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    };
  }

  // ── Streaming Mode (NDJSON Chunked) ─────────────────────────────────────────
  if (isStream) {
    reply.hijack();
    reply.raw.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("Transfer-Encoding", "chunked");
    reply.raw.writeHead(200);

    const abortController = new AbortController();
    const onDisconnect = () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    };
    request.raw.once("close", onDisconnect);
    reply.raw.once("close", onDisconnect);

    const BATCH_SIZE = 100;
    let streamCursor: string | undefined = request.query.cursor
      ? String(request.query.cursor).trim()
      : undefined;

    while (true) {
      if (abortController.signal.aborted) break;

      const batch = await prisma.voucher.findMany({
        where: whereClause,
        take: BATCH_SIZE,
        skip: streamCursor ? 1 : 0,
        cursor: streamCursor ? { id: streamCursor } : undefined,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        include: {
          voucherEntries: {
            include: {
              ledger: {
                select: { id: true, name: true, parent: true },
              },
            },
          },
        },
      });

      if (batch.length === 0 || abortController.signal.aborted) break;

      for (const v of batch) {
        if (abortController.signal.aborted) break;
        const line = JSON.stringify(formatVoucherDto(v)) + "\n";
        const canContinue = reply.raw.write(line);
        if (!canContinue) {
          await new Promise((resolve) => reply.raw.once("drain", resolve));
        }
      }

      if (batch.length < BATCH_SIZE || abortController.signal.aborted) break;
      streamCursor = batch[batch.length - 1].id;
    }

    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
    return;
  }

  // ── Standard JSON Cursor Pagination Mode ──────────────────────────────────
  const limit = parseBoundedLimit(request.query.limit, 50, 250);
  const cursor = request.query.cursor ? String(request.query.cursor).trim() : undefined;

  // Use composite index [companyId, date, id] for O(batch size) memory pagination
  const vouchers = await prisma.voucher.findMany({
    where: whereClause,
    take: limit + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    include: {
      voucherEntries: {
        include: {
          ledger: {
            select: { id: true, name: true, parent: true },
          },
        },
      },
    },
  });

  const hasMore = vouchers.length > limit;
  const data = hasMore ? vouchers.slice(0, limit) : vouchers;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;

  return reply.status(200).send({
    success: true,
    companyId,
    filters: {
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
    },
    data: data.map(formatVoucherDto),
    pagination: {
      limit,
      cursor: cursor ?? null,
      nextCursor,
      hasMore,
    },
  });
}

/**
 * 5. GET /api/v1/companies/:companyId/sync-status
 * Return data freshness and sync status for the company.
 */
async function handleGetSyncStatus(
  request: FastifyRequest<{ Params: CompanyParams }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      tallyCompanyName: true,
      connectors: {
        orderBy: { lastHeartbeat: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          connectorVersion: true,
          lastHeartbeat: true,
          lastSeenAt: true,
        },
      },
      syncRuns: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          syncType: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          recordsProcessed: true,
          recordsCreated: true,
          recordsUpdated: true,
          recordsFailed: true,
          recordsFetched: true,
          errorSummary: true,
        },
      },
    },
  });

  if (!company) {
    return reply.status(404).send({
      success: false,
      error: `Company "${companyId}" not found.`,
    });
  }

  const latestConnector = company.connectors[0] ?? null;
  const latestSync = company.syncRuns[0] ?? null;

  const connectorStatus = latestConnector ? latestConnector.status : "DISCONNECTED";
  const lastSyncTime = latestSync?.completedAt
    ? latestSync.completedAt.toISOString()
    : latestSync?.startedAt
    ? latestSync.startedAt.toISOString()
    : null;
  const lastSyncResult = latestSync ? latestSync.status : null;
  const recordsProcessed = latestSync
    ? latestSync.recordsProcessed || (latestSync.recordsCreated + latestSync.recordsUpdated)
    : 0;

  return reply.status(200).send({
    success: true,
    data: {
      companyId: company.id,
      connectorStatus,
      lastSyncTime,
      lastSyncResult,
      recordsProcessed,
      connector: latestConnector
        ? {
            id: latestConnector.id,
            status: latestConnector.status,
            version: latestConnector.connectorVersion ?? null,
            lastSeenAt: latestConnector.lastSeenAt
              ? latestConnector.lastSeenAt.toISOString()
              : latestConnector.lastHeartbeat.toISOString(),
            lastHeartbeat: latestConnector.lastHeartbeat.toISOString(),
          }
        : null,
      lastSync: latestSync
        ? {
            syncRunId: latestSync.id,
            syncType: latestSync.syncType,
            status: latestSync.status,
            startedAt: latestSync.startedAt.toISOString(),
            completedAt: latestSync.completedAt ? latestSync.completedAt.toISOString() : null,
            durationMs: latestSync.durationMs,
            recordsProcessed,
            recordsCreated: latestSync.recordsCreated,
            recordsUpdated: latestSync.recordsUpdated,
            recordsFailed: latestSync.recordsFailed,
            recordsFetched: latestSync.recordsFetched,
            errorSummary: latestSync.errorSummary,
          }
        : null,
    },
  });
}

// ─── SaaS API Plugin ──────────────────────────────────────────────────────────

export async function saasApiRoutes(app: FastifyInstance): Promise<void> {
  // Authenticate SaaS API key on all routes in this plugin
  app.addHook("preHandler", authenticateSaasApiKey);

  // 1. GET /api/v1/companies/:companyId
  app.get<{ Params: CompanyParams }>(
    "/companies/:companyId",
    { preHandler: [requireSaasCompanyAccess] },
    handleGetCompany
  );

  // 2. GET /api/v1/companies/:companyId/ledgers
  app.get<{ Params: CompanyParams; Querystring: LedgersQuery }>(
    "/companies/:companyId/ledgers",
    { preHandler: [requireSaasCompanyAccess] },
    handleGetLedgers
  );

  // 3. GET /api/v1/companies/:companyId/trial-balance
  app.get<{ Params: CompanyParams; Querystring: TrialBalanceQuery }>(
    "/companies/:companyId/trial-balance",
    { preHandler: [requireSaasCompanyAccess] },
    handleGetTrialBalance
  );

  // 4. GET /api/v1/companies/:companyId/vouchers
  app.get<{ Params: CompanyParams; Querystring: VouchersQuery }>(
    "/companies/:companyId/vouchers",
    { preHandler: [requireSaasCompanyAccess] },
    handleGetVouchers
  );

  // 5. GET /api/v1/companies/:companyId/sync-status
  app.get<{ Params: CompanyParams }>(
    "/companies/:companyId/sync-status",
    { preHandler: [requireSaasCompanyAccess] },
    handleGetSyncStatus
  );
}
