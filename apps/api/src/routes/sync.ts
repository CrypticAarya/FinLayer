import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

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
}

// ─── Schema (Fastify JSON Schema for validation) ──────────────────────────────

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

// ─── Route Handler ────────────────────────────────────────────────────────────

async function handleSyncLedgers(
  request: FastifyRequest<{ Body: SyncLedgersBody }>,
  reply: FastifyReply
): Promise<SyncLedgersResponse> {
  const { company, ledgers } = request.body;

  request.log.info(
    { company, count: ledgers.length },
    "Received ledger sync payload"
  );

  return reply.status(200).send({
    success: true,
    company,
    received: ledgers.length,
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SyncLedgersBody }>(
    "/sync/ledgers",
    { schema: syncLedgersSchema },
    handleSyncLedgers
  );
}
