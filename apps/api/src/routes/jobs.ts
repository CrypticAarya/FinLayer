import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import {
  authenticateConnector,
  requireConnectorOwnership,
} from "../auth/connector-auth.js";


// ─── Types ────────────────────────────────────────────────────────────────────

export interface StartSyncJobBody {
  connectorId: string;
  type: string;
}

export interface StartSyncJobResponse {
  success: true;
  jobId: string;
}

export interface GetPendingJobParams {
  connectorId: string;
}

export interface PendingJobDto {
  id: string;
  connectorId: string;
  type: string;
  status: string;
  createdAt: Date;
}

export interface GetPendingJobResponse {
  success: true;
  job: PendingJobDto | null;
}

export interface CompleteJobParams {
  id: string;
}

export interface CompleteJobResponse {
  success: true;
  jobId: string;
  status: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const startSyncJobSchema = {
  body: {
    type: "object",
    required: ["connectorId", "type"],
    properties: {
      connectorId: { type: "string" },
      type: { type: "string" },
    },
  },
} as const;

const getPendingJobSchema = {
  params: {
    type: "object",
    required: ["connectorId"],
    properties: {
      connectorId: { type: "string" },
    },
  },
} as const;

const completeJobSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
} as const;

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleStartSyncJob(
  request: FastifyRequest<{ Body: StartSyncJobBody }>,
  reply: FastifyReply
): Promise<StartSyncJobResponse> {
  const { connectorId, type } = request.body;

  // 1. Verify connector exists
  const connector = await prisma.connector.findUnique({
    where: { id: connectorId },
  });

  if (!connector) {
    return reply.status(404).send({
      success: false,
      error: `Connector "${connectorId}" not found.`,
    } as never);
  }

  // 2. Strict authorization validation: Connector identity
  if (request.connector && request.connector.id !== connectorId) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: You cannot trigger sync jobs for another connector.",
    } as never);
  }

  // 3. Create SyncJob with status PENDING
  const job = await prisma.syncJob.create({
    data: {
      connectorId,
      type,
      status: "PENDING",
    },
  });

  if (connector.companyId) {
    await prisma.syncHistory.create({
      data: {
        companyId: connector.companyId,
        syncType: type,
        status: "IN_PROGRESS",
      },
    });
  }

  request.log.info(
    { jobId: job.id, connectorId, type },
    "Created pending sync job"
  );

  return reply.status(200).send({
    success: true,
    jobId: job.id,
  });
}

async function handleGetPendingJob(
  request: FastifyRequest<{ Params: GetPendingJobParams }>,
  reply: FastifyReply
): Promise<GetPendingJobResponse> {
  const { connectorId } = request.params;

  // Verify connector exists
  const connector = await prisma.connector.findUnique({
    where: { id: connectorId },
  });

  if (!connector) {
    return reply.status(404).send({
      success: false,
      error: `Connector "${connectorId}" not found.`,
    } as never);
  }

  // Fetch latest pending job
  const job = await prisma.syncJob.findFirst({
    where: {
      connectorId,
      status: "PENDING",
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!job) {
    return reply.status(200).send({
      success: true,
      job: null,
    });
  }

  return reply.status(200).send({
    success: true,
    job: {
      id: job.id,
      connectorId: job.connectorId,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
    },
  });
}

async function handleCompleteJob(
  request: FastifyRequest<{ Params: CompleteJobParams }>,
  reply: FastifyReply
): Promise<CompleteJobResponse> {
  const { id } = request.params;

  const job = await prisma.syncJob.findUnique({
    where: { id },
    include: { connector: true },
  });

  if (!job) {
    return reply.status(404).send({
      success: false,
      error: `Sync job "${id}" not found.`,
    } as never);
  }

  // Verify that the authenticated connector owns this job
  if (request.connector && job.connectorId !== request.connector.id) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: You cannot complete a sync job belonging to another connector.",
    } as never);
  }

  const updated = await prisma.syncJob.update({
    where: { id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  request.log.info({ jobId: id }, "Sync job completed");

  // If connector is linked to a company, track SyncHistory
  const companyId = job.connector?.companyId;
  if (companyId) {
    // 1. Calculate total records updated in this sync
    const [tbCount, ledgerCount, voucherCount] = await Promise.all([
      prisma.trialBalanceEntry.count({ where: { companyId } }),
      prisma.ledger.count({ where: { companyId } }),
      prisma.voucher.count({ where: { companyId } }),
    ]);
    const totalRecords = tbCount + ledgerCount + voucherCount;

    // 2. Update pending SyncHistory or create a new completed one
    const history = await prisma.syncHistory.findFirst({
      where: {
        companyId,
        syncType: job.type,
        status: "IN_PROGRESS",
      },
      orderBy: { createdAt: "desc" },
    });

    if (history) {
      await prisma.syncHistory.update({
        where: { id: history.id },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          recordsUpdated: totalRecords,
        },
      });
    } else {
      await prisma.syncHistory.create({
        data: {
          companyId,
          syncType: job.type,
          status: "SUCCESS",
          completedAt: new Date(),
          recordsUpdated: totalRecords,
        },
      });
    }
  }

  return reply.status(200).send({
    success: true,
    jobId: updated.id,
    status: updated.status,
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: StartSyncJobBody }>(
    "/sync/start",
    {
      schema: startSyncJobSchema,
      preHandler: [authenticateConnector],
    },
    handleStartSyncJob
  );

  app.get<{ Params: GetPendingJobParams }>(
    "/sync/jobs/:connectorId/pending",
    {
      schema: getPendingJobSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("connectorId")],
    },
    handleGetPendingJob
  );

  app.post<{ Params: CompleteJobParams }>(
    "/sync/jobs/:id/complete",
    {
      schema: completeJobSchema,
      preHandler: [authenticateConnector],
    },
    handleCompleteJob
  );
}
