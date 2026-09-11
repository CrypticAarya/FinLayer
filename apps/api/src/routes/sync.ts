import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";


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
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyName?: string;
  amount: number;
  entries: VoucherEntryInput[];
}

export interface SyncVouchersBody {
  company: string;
  vouchers: VoucherInput[];
}

export interface SyncVouchersResponse {
  success: true;
  company: string;
  received: number;
  created: number;
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
        items: {
          type: "object",
          required: ["ledgerName", "groupName", "debitAmount", "creditAmount"],
          properties: {
            ledgerName: { type: "string" },
            groupName: { type: "string" },
            debitAmount: { type: "number" },
            creditAmount: { type: "number" },
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
      vouchers: {
        type: "array",
        items: {
          type: "object",
          required: ["voucherNumber", "voucherType", "date", "amount", "entries"],
          properties: {
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

  request.log.info(
    { company: tallyCompanyName, count: ledgers.length },
    "Received ledger sync payload"
  );

  // ── 1. Find or create Company ─────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { tallyCompanyName },
    update: { updatedAt: new Date() },
    create: {
      name: tallyCompanyName,
      tallyCompanyName,
    },
  });

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
  const { company: tallyCompanyName, vouchers } = request.body;

  request.log.info(
    { company: tallyCompanyName, count: vouchers.length },
    "Received voucher sync payload"
  );

  // ── 1. Resolve Company ────────────────────────────────────────────────────
  const company = await prisma.company.findUnique({
    where: { tallyCompanyName },
  });

  if (!company) {
    return reply.status(404).send({
      success: false,
      error: `Company "${tallyCompanyName}" not found. Sync ledgers first.`,
    } as never);
  }

  // ── 2. Create Vouchers + VoucherEntries ───────────────────────────────────
  let created = 0;

  for (const v of vouchers) {
    // Resolve all ledger names up-front so we can fail fast per voucher
    const resolvedEntries: { ledgerId: string; amount: number; type: string }[] = [];

    for (const entry of v.entries) {
      const ledger = await prisma.ledger.findFirst({
        where: { companyId: company.id, name: entry.ledgerName },
      });

      if (!ledger) {
        return reply.status(422).send({
          success: false,
          error: `Ledger "${entry.ledgerName}" not found for company "${tallyCompanyName}". Sync ledgers first.`,
          voucher: v.voucherNumber,
        } as never);
      }

      resolvedEntries.push({
        ledgerId: ledger.id,
        amount: entry.amount,
        type: entry.type,
      });
    }

    // Persist Voucher + its entries atomically
    await prisma.$transaction(async (tx) => {
      const voucher = await tx.voucher.create({
        data: {
          companyId: company.id,
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
    });

    created++;
  }

  request.log.info(
    { company: tallyCompanyName, received: vouchers.length, created },
    "Voucher sync persisted"
  );

  return reply.status(200).send({
    success: true,
    company: tallyCompanyName,
    received: vouchers.length,
    created,
  });
}

// ─── Route Handler: /sync/trial-balance ──────────────────────────────────────

async function handleSyncTrialBalance(
  request: FastifyRequest<{ Body: SyncTrialBalanceBody }>,
  reply: FastifyReply
): Promise<SyncTrialBalanceResponse> {
  const { company: tallyCompanyName, trialBalance } = request.body;

  request.log.info(
    { company: tallyCompanyName, count: trialBalance.length },
    "Received trial balance sync payload"
  );

  // 1. Find or create Company
  const company = await prisma.company.upsert({
    where: { tallyCompanyName },
    update: { updatedAt: new Date() },
    create: {
      name: tallyCompanyName,
      tallyCompanyName,
    },
  });

  // 2. Upsert trial balance entries (keyed by companyId + ledgerName)
  let created = 0;
  let updated = 0;

  for (const item of trialBalance) {
    const existing = await prisma.trialBalanceEntry.findUnique({
      where: {
        companyId_ledgerName: {
          companyId: company.id,
          ledgerName: item.ledgerName,
        },
      },
    });

    if (!existing) {
      await prisma.trialBalanceEntry.create({
        data: {
          companyId: company.id,
          ledgerName: item.ledgerName,
          groupName: item.groupName,
          debitAmount: item.debitAmount,
          creditAmount: item.creditAmount,
        },
      });
      created++;
    } else {
      await prisma.trialBalanceEntry.update({
        where: { id: existing.id },
        data: {
          groupName: item.groupName,
          debitAmount: item.debitAmount,
          creditAmount: item.creditAmount,
        },
      });
      updated++;
    }
  }

  request.log.info(
    { company: tallyCompanyName, received: trialBalance.length, created, updated },
    "Trial balance sync persisted"
  );

  console.log(
    `[API POST /sync/trial-balance] Company: "${tallyCompanyName}" | Received: ${trialBalance.length} | Created: ${created} | Updated: ${updated}`
  );

  return reply.status(200).send({
    success: true,
    company: tallyCompanyName,
    received: trialBalance.length,
    created,
    updated,
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SyncLedgersBody }>(
    "/sync/ledgers",
    { schema: syncLedgersSchema },
    handleSyncLedgers
  );

  app.post<{ Body: SyncVouchersBody }>(
    "/sync/vouchers",
    { schema: syncVouchersSchema },
    handleSyncVouchers
  );

  app.post<{ Body: SyncTrialBalanceBody }>(
    "/sync/trial-balance",
    { schema: syncTrialBalanceSchema },
    handleSyncTrialBalance
  );
}
