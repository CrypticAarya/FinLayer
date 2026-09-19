import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import { AccountingValidationService } from "../services/accounting-validation-service.js";
import { SyncAuditService } from "../services/sync-audit-service.js";
import { authenticateConnector } from "../auth/connector-auth.js";
import { requireCompanyOwnership } from "../auth/tenant-auth.js";


// ─── Types ────────────────────────────────────────────────────────────────────

export interface Ledger {
  name: string;
  parent: string;
  masterId: number;
  alterId: number;
}

export interface SyncLedgersBody {
  company: string;
  ledgers: Ledger[];
}

export interface SyncLedgersResponse {
  success: true;
  company: string;
  received: number;
  created: number;
  updated: number;
}

// ─── Voucher Types ────────────────────────────────────────────────────────────

export interface VoucherEntryInput {
  ledgerName: string;
  amount: number;
  type: string;
}

export interface VoucherInput {
  masterId: number;
  alterId: number;
  guid?: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyName?: string;
  amount: number;
  entries: VoucherEntryInput[];
}

export interface SyncVouchersBody {
  company: string;
  syncRunId?: string;
  vouchers: VoucherInput[];
}

export interface SyncVouchersResponse {
  success: true;
  company: string;
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  validationFailed: number;
  syncRunId?: string;
}

// ─── Trial Balance Types ──────────────────────────────────────────────────────

export interface TrialBalanceItemInput {
  ledgerName: string;
  groupName: string;
  debitAmount: number;
  creditAmount: number;
}

export interface SyncTrialBalanceBody {
  company: string;
  trialBalance: TrialBalanceItemInput[];
}

export interface SyncTrialBalanceResponse {
  success: true;
  company: string;
  received: number;
  created: number;
  updated: number;
}

// ─── Schema (Fastify JSON Schema for validation) ──────────────────────────────

const syncTrialBalanceSchema = {
  body: {
    type: "object",
    required: ["company", "trialBalance"],
    properties: {
      company: { type: "string" },
      trialBalance: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["ledgerName", "groupName", "debitAmount", "creditAmount"],
          properties: {
            ledgerName: { type: "string", minLength: 1 },
            groupName: { type: "string" },
            debitAmount: { type: "number", minimum: 0 },
            creditAmount: { type: "number", minimum: 0 },
          },
        },
      },
    },
  },
} as const;

const syncLedgersSchema = {
  body: {
    type: "object",
    required: ["company", "ledgers"],
    properties: {
      company: { type: "string" },
      ledgers: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "parent", "masterId", "alterId"],
          properties: {
            name: { type: "string" },
            parent: { type: "string" },
            masterId: { type: "number" },
            alterId: { type: "number" },
          },
        },
      },
    },
  },
} as const;

const syncVouchersSchema = {
  body: {
    type: "object",
    required: ["company", "vouchers"],
    properties: {
      company: { type: "string" },
      syncRunId: { type: "string" },
      vouchers: {
        type: "array",
        items: {
          type: "object",
          required: ["masterId", "alterId", "voucherNumber", "voucherType", "date", "amount", "entries"],
          properties: {
            masterId: { type: "number" },
            alterId: { type: "number" },
            guid: { type: "string" },
            voucherNumber: { type: "string" },
            voucherType: { type: "string" },
            date: { type: "string" },
            partyName: { type: "string" },
            amount: { type: "number" },
            entries: {
              type: "array",
              items: {
                type: "object",
                required: ["ledgerName", "amount", "type"],
                properties: {
                  ledgerName: { type: "string" },
                  amount: { type: "number" },
                  type: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

// ─── Route Handler: /sync/ledgers ─────────────────────────────────────────────

async function handleSyncLedgers(
  request: FastifyRequest<{ Body: SyncLedgersBody }>,
  reply: FastifyReply
): Promise<SyncLedgersResponse> {
  const { company: tallyCompanyName, ledgers } = request.body;

  // ── 1. Derive Company Identity strictly from Authenticated Connector ─────
  const companyId = request.connector?.companyId;
  let company = request.connector?.company;
  if (!company && companyId) {
    company = await prisma.company.findUnique({ where: { id: companyId } });
  }

  if (!company) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: Connector is not associated with an active company.",
    } as never);
  }

  request.log.info(
    { companyId: company.id, company: company.tallyCompanyName ?? tallyCompanyName, count: ledgers.length },
    "Received ledger sync payload"
  );

  // ── 2. Upsert ledgers (keyed by companyId + masterId) ─────────────────────
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const ledger of ledgers) {
    const existing = await prisma.ledger.findUnique({
      where: {
        companyId_masterId: {
          companyId: company.id,
          masterId: ledger.masterId,
        },
      },
    });

    if (!existing) {
      await prisma.ledger.create({
        data: {
          companyId: company.id,
          name: ledger.name,
          parent: ledger.parent,
          masterId: ledger.masterId,
          alterId: ledger.alterId,
        },
      });
      created++;
    } else if (existing.alterId !== ledger.alterId) {
      await prisma.ledger.update({
        where: { id: existing.id },
        data: {
          name: ledger.name,
          parent: ledger.parent,
          alterId: ledger.alterId,
        },
      });
      updated++;
    } else {
      unchanged++;
    }
  }

  // ── 3. Write SyncLog ──────────────────────────────────────────────────────
  await prisma.syncLog.create({
    data: {
      companyId: company.id,
      created,
      updated,
      unchanged,
    },
  });

  request.log.info(
    { company: tallyCompanyName, received: ledgers.length, created, updated, unchanged },
    "Ledger sync persisted"
  );

  console.log(
    `[API POST /sync/ledgers] Company: "${tallyCompanyName}" | Received: ${ledgers.length} | Created: ${created} | Updated: ${updated} | Unchanged: ${unchanged}`
  );

  return reply.status(200).send({
    success: true,
    company: tallyCompanyName,
    received: ledgers.length,
    created,
    updated,
  });
}

// ─── Route Handler: /sync/vouchers ────────────────────────────────────────────

async function handleSyncVouchers(
  request: FastifyRequest<{ Body: SyncVouchersBody }>,
  reply: FastifyReply
): Promise<SyncVouchersResponse> {
  const { company: tallyCompanyName, vouchers, syncRunId } = request.body;

  // ── 1. Derive Company Identity strictly from Authenticated Connector ─────
  const companyId = request.connector?.companyId;
  let company = request.connector?.company;
  if (!company && companyId) {
    company = await prisma.company.findUnique({ where: { id: companyId } });
  }

  if (!company) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: Connector is not associated with an active company.",
    } as never);
  }

  request.log.info(
    { companyId: company.id, company: company.tallyCompanyName ?? tallyCompanyName, count: vouchers.length, syncRunId },
    "Received voucher sync payload"
  );

  // ── 0. Initialize SyncRun & Audit Trail (Stage: SYNC_STARTED) ─────────────
  const activeSyncRunId = await SyncAuditService.startSyncRun({
    companyId: company.id,
    syncRunId,
    recordsFetched: vouchers.length,
  });

  try {
    // ── 2. Ledger & Voucher Lookup Optimization (O(1) in-memory lookup) ─────
    const companyLedgers = await prisma.ledger.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true },
    });

    const ledgerMap = new Map<string, string>();
    for (const l of companyLedgers) {
      ledgerMap.set(l.name.toLowerCase().trim(), l.id);
    }

    // Pre-fetch existing vouchers for this batch by masterId to eliminate N queries
    const masterIds = vouchers.map((v) => v.masterId);
    const existingVouchers = await prisma.voucher.findMany({
      where: {
        companyId: company.id,
        masterId: { in: masterIds },
      },
    });
    const existingByMasterId = new Map<number, (typeof existingVouchers)[0]>();
    for (const ev of existingVouchers) {
      existingByMasterId.set(ev.masterId, ev);
    }

    // ── 3. Record Stages & Idempotent Processing ────────────────────────────
    await SyncAuditService.recordStage(
      activeSyncRunId,
      "SYNC_VALIDATING",
      `Validating double-entry balance and ledger mappings for ${vouchers.length} vouchers.`
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    let validationFailed = 0;

    await SyncAuditService.recordStage(
      activeSyncRunId,
      "SYNC_PROCESSING",
      `Executing idempotent transaction pipeline for company "${tallyCompanyName}".`
    );

    for (const v of vouchers) {
      try {
        // 1. Accounting & Financial Integrity Validation
        const validation = AccountingValidationService.validateVoucher(v, ledgerMap);

        if (!validation.isValid) {
          validationFailed++;
          failed++;

          console.log(
            `[ACCOUNTING VALIDATION]\nCompany: "${tallyCompanyName}"\nVoucher: "${v.voucherNumber}"\nDebit: ${validation.debitTotal.toFixed(2)}\nCredit: ${validation.creditTotal.toFixed(2)}\nStatus: REJECTED (${validation.error})`
          );

          request.log.warn(
            {
              company: tallyCompanyName,
              voucherNumber: v.voucherNumber,
              masterId: v.masterId,
              debit: validation.debitTotal,
              credit: validation.creditTotal,
              error: validation.error,
            },
            "Accounting validation rejected voucher"
          );
          continue;
        }

        console.log(
          `[ACCOUNTING VALIDATION]\nCompany: "${tallyCompanyName}"\nVoucher: "${v.voucherNumber}"\nDebit: ${validation.debitTotal.toFixed(2)}\nCredit: ${validation.creditTotal.toFixed(2)}\nStatus: PASSED`
        );

        const resolvedEntries = validation.resolvedEntries!;

        // Lookup existing voucher by Primary: (companyId, masterId), Secondary: guid
        let existing: (typeof existingVouchers)[0] | null = existingByMasterId.get(v.masterId) ?? null;

        if (!existing && v.guid) {
          existing = await prisma.voucher.findFirst({
            where: {
              companyId: company.id,
              guid: v.guid,
            },
          });
        }

        // Case 1: Voucher does not exist -> Create atomically
        if (!existing) {
          await prisma.$transaction(async (tx) => {
            const voucher = await tx.voucher.create({
              data: {
                companyId: company.id,
                masterId: v.masterId,
                alterId: v.alterId,
                guid: v.guid ?? null,
                syncRunId: activeSyncRunId,
                voucherNumber: v.voucherNumber,
                voucherType: v.voucherType,
                date: new Date(v.date),
                partyName: v.partyName ?? null,
                amount: v.amount,
              },
            });

            await tx.voucherEntry.createMany({
              data: resolvedEntries.map((e) => ({
                voucherId: voucher.id,
                ledgerId: e.ledgerId,
                amount: e.amount,
                type: e.type,
              })),
            });

            existingByMasterId.set(v.masterId, voucher);
          });
          created++;
        }
        // Case 2: Voucher exists and alterId is unchanged -> Skip processing (no-op)
        else if (existing.alterId === v.alterId) {
          unchanged++;
        }
        // Case 3: Voucher exists and alterId changed -> Atomic update and entry replacement
        else {
          await prisma.$transaction(async (tx) => {
            const updatedVoucher = await tx.voucher.update({
              where: { id: existing!.id },
              data: {
                alterId: v.alterId,
                guid: v.guid ?? existing!.guid,
                syncRunId: activeSyncRunId,
                voucherNumber: v.voucherNumber,
                voucherType: v.voucherType,
                date: new Date(v.date),
                partyName: v.partyName ?? null,
                amount: v.amount,
              },
            });

            await tx.voucherEntry.deleteMany({
              where: { voucherId: existing!.id },
            });

            await tx.voucherEntry.createMany({
              data: resolvedEntries.map((e) => ({
                voucherId: existing!.id,
                ledgerId: e.ledgerId,
                amount: e.amount,
                type: e.type,
              })),
            });

            existingByMasterId.set(v.masterId, updatedVoucher);
          });
          updated++;
        }
      } catch (err) {
        request.log.error(
          { err, voucherNumber: v.voucherNumber, masterId: v.masterId },
          "Error processing voucher in sync batch"
        );
        failed++;
      }
    }

    // ── 4. Complete SyncRun & Audit Trail (Stage: SYNC_COMPLETED) ───────────
    await SyncAuditService.completeSyncRun({
      syncRunId: activeSyncRunId,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsFailed: failed,
      errorSummary:
        validationFailed > 0 ? `${validationFailed} vouchers failed accounting validation.` : undefined,
    });

    // ── 5. Structured Logging ───────────────────────────────────────────────
    console.log(
      `[SYNC]\nCompany: "${tallyCompanyName}"\nSync Run: "${activeSyncRunId}"\nReceived: ${vouchers.length}\nCreated: ${created}\nUpdated: ${updated}\nSkipped: ${unchanged}\nFailed: ${failed}\nValidation Failed: ${validationFailed}`
    );

    request.log.info(
      {
        company: tallyCompanyName,
        received: vouchers.length,
        created,
        updated,
        unchanged,
        failed,
        validationFailed,
        syncRunId: activeSyncRunId,
      },
      "Voucher sync completed"
    );

    return reply.status(200).send({
      success: true,
      company: tallyCompanyName,
      received: vouchers.length,
      created,
      updated,
      unchanged,
      failed,
      validationFailed,
      syncRunId: activeSyncRunId,
    });
  } catch (err: any) {
    await SyncAuditService.failSyncRun(activeSyncRunId, err?.message || "Internal sync error");
    throw err;
  }
}

// ─── Route Handler: /sync/trial-balance ──────────────────────────────────────

async function handleSyncTrialBalance(
  request: FastifyRequest<{ Body: SyncTrialBalanceBody }>,
  reply: FastifyReply
): Promise<SyncTrialBalanceResponse> {
  const { company: tallyCompanyName, trialBalance } = request.body;

  // ── 1. Derive Company Identity strictly from Authenticated Connector ─────
  const companyId = request.connector?.companyId;
  let company = request.connector?.company;
  if (!company && companyId) {
    company = await prisma.company.findUnique({ where: { id: companyId } });
  }

  if (!company) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: Connector is not associated with an active company.",
    } as never);
  }

  request.log.info(
    { companyId: company.id, company: company.tallyCompanyName ?? tallyCompanyName, count: trialBalance.length },
    "Received trial balance sync payload"
  );

  // ── 2. Validate non-empty payload & duplicate ledger names ──────────────────
  if (!Array.isArray(trialBalance) || trialBalance.length === 0) {
    return reply.status(400).send({
      success: false,
      error: "Bad Request: trialBalance payload must be a non-empty array.",
    } as never);
  }

  const seenLedgers = new Set<string>();
  for (const item of trialBalance) {
    if (!item.ledgerName || typeof item.ledgerName !== "string" || item.ledgerName.trim().length === 0) {
      return reply.status(400).send({
        success: false,
        error: "Bad Request: Each trial balance entry must have a non-empty ledgerName.",
      } as never);
    }
    const normalizedName = item.ledgerName.trim();
    if (seenLedgers.has(normalizedName)) {
      return reply.status(400).send({
        success: false,
        error: `Bad Request: Duplicate ledgerName "${item.ledgerName}" in trial balance payload.`,
      } as never);
    }
    seenLedgers.add(normalizedName);

    if (typeof item.groupName !== "string") {
      return reply.status(400).send({
        success: false,
        error: `Bad Request: Invalid groupName for ledger "${item.ledgerName}".`,
      } as never);
    }

    if (typeof item.debitAmount !== "number" || isNaN(item.debitAmount) || !isFinite(item.debitAmount) || item.debitAmount < 0) {
      return reply.status(400).send({
        success: false,
        error: `Bad Request: Invalid debitAmount for ledger "${item.ledgerName}".`,
      } as never);
    }
    if (typeof item.creditAmount !== "number" || isNaN(item.creditAmount) || !isFinite(item.creditAmount) || item.creditAmount < 0) {
      return reply.status(400).send({
        success: false,
        error: `Bad Request: Invalid creditAmount for ledger "${item.ledgerName}".`,
      } as never);
    }
  }

  // ── 3. Atomically replace company's Trial Balance entries in a transaction ──
  await prisma.$transaction(async (tx) => {
    // a. Delete existing entries belonging strictly to this company
    await tx.trialBalanceEntry.deleteMany({
      where: { companyId: company.id },
    });

    // b. Insert complete incoming snapshot using tx
    await tx.trialBalanceEntry.createMany({
      data: trialBalance.map((item) => ({
        companyId: company.id,
        ledgerName: item.ledgerName.trim(),
        groupName: item.groupName.trim() || "Primary",
        debitAmount: item.debitAmount,
        creditAmount: item.creditAmount,
      })),
    });
  });

  request.log.info(
    { company: tallyCompanyName, received: trialBalance.length, created: trialBalance.length, updated: 0 },
    "Trial balance sync persisted"
  );

  console.log(
    `[API POST /sync/trial-balance] Company: "${tallyCompanyName}" | Received: ${trialBalance.length} | Created: ${trialBalance.length} | Updated: 0`
  );

  return reply.status(200).send({
    success: true,
    company: tallyCompanyName,
    received: trialBalance.length,
    created: trialBalance.length,
    updated: 0,
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SyncLedgersBody }>(
    "/sync/ledgers",
    {
      schema: syncLedgersSchema,
      preHandler: [authenticateConnector, requireCompanyOwnership()],
    },
    handleSyncLedgers
  );

  app.post<{ Body: SyncVouchersBody }>(
    "/sync/vouchers",
    {
      schema: syncVouchersSchema,
      preHandler: [authenticateConnector, requireCompanyOwnership()],
    },
    handleSyncVouchers
  );

  app.post<{ Body: SyncTrialBalanceBody }>(
    "/sync/trial-balance",
    {
      schema: syncTrialBalanceSchema,
      preHandler: [authenticateConnector, requireCompanyOwnership()],
    },
    handleSyncTrialBalance
  );
}
