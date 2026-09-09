import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegisterConnectorBody {
  company: string;
  name: string;
  deviceId: string;
}

export interface RegisterConnectorResponse {
  success: true;
  connectorId: string;
}

export interface HeartbeatParams {
  id: string;
}

export interface HeartbeatResponse {
  success: true;
  status: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerConnectorSchema = {
  body: {
    type: "object",
    required: ["company", "name", "deviceId"],
    properties: {
      company: { type: "string" },
      name: { type: "string" },
      deviceId: { type: "string" },
    },
  },
} as const;

const heartbeatSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
} as const;

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleRegisterConnector(
  request: FastifyRequest<{ Body: RegisterConnectorBody }>,
  reply: FastifyReply
): Promise<RegisterConnectorResponse> {
  const { company: tallyCompanyName, name, deviceId } = request.body;

  request.log.info(
    { company: tallyCompanyName, name, deviceId },
    "Received connector registration request"
  );

  // 1. Find company by tallyCompanyName
  const company = await prisma.company.findUnique({
    where: { tallyCompanyName },
  });

  if (!company) {
    return reply.status(404).send({
      success: false,
      error: `Company "${tallyCompanyName}" not found.`,
    } as never);
  }

  // 2. Upsert connector by deviceId
  const now = new Date();
  const connector = await prisma.connector.upsert({
    where: { deviceId },
    update: {
      companyId: company.id,
      name,
      status: "ONLINE",
      lastHeartbeat: now,
    },
    create: {
      companyId: company.id,
      name,
      deviceId,
      status: "ONLINE",
      lastHeartbeat: now,
    },
  });

  request.log.info(
    { connectorId: connector.id, deviceId, status: connector.status },
    "Connector registered"
  );

  return reply.status(200).send({
    success: true,
    connectorId: connector.id,
  });
}

async function handleHeartbeat(
  request: FastifyRequest<{ Params: HeartbeatParams }>,
  reply: FastifyReply
): Promise<HeartbeatResponse> {
  const { id } = request.params;

  const existing = await prisma.connector.findUnique({
    where: { id },
  });

  if (!existing) {
    return reply.status(404).send({
      success: false,
      error: `Connector "${id}" not found.`,
    } as never);
  }

  const updated = await prisma.connector.update({
    where: { id },
    data: {
      status: "ONLINE",
      lastHeartbeat: new Date(),
    },
  });

  request.log.debug({ connectorId: id }, "Heartbeat updated");

  return reply.status(200).send({
    success: true,
    status: updated.status,
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function connectorRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RegisterConnectorBody }>(
    "/connectors/register",
    { schema: registerConnectorSchema },
    handleRegisterConnector
  );

  app.post<{ Params: HeartbeatParams }>(
    "/connectors/:id/heartbeat",
    { schema: heartbeatSchema },
    handleHeartbeat
  );
}
