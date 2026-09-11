import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";

// ─── Temporary In-Memory Onboarding Cache ─────────────────────────────────────
// Discovered companies are held in memory during the onboarding session and are
// NOT permanently stored in the database per architecture requirements.
const onboardingTallyCompanies = new Map<string, Array<{ name: string }>>();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegisterConnectorBody {
  deviceId: string;
  deviceName?: string;
  name?: string;
  operatingSystem?: string;
  company?: string;
}

export interface RegisterConnectorResponse {
  success: true;
  connectorId: string;
  setupStatus: string;
}

export interface HeartbeatParams {
  id: string;
}

export interface HeartbeatResponse {
  success: true;
  status: string;
  setupStatus: string;
  companyId: string | null;
  tallyCompanyName: string | null;
}

export interface TallyStatusBody {
  status: "TALLY_CONNECTED";
}

export interface TallyCompaniesBody {
  companies: Array<{ name: string }>;
}

export interface SelectCompanyBody {
  companyName: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerConnectorSchema = {
  body: {
    type: "object",
    required: ["deviceId"],
    properties: {
      deviceId: { type: "string" },
      deviceName: { type: "string" },
      name: { type: "string" },
      operatingSystem: { type: "string" },
      company: { type: "string" },
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

const connectorIdParamSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
} as const;

const selectCompanySchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
  body: {
    type: "object",
    required: ["companyName"],
    properties: {
      companyName: { type: "string" },
    },
  },
} as const;

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleRegisterConnector(
  request: FastifyRequest<{ Body: RegisterConnectorBody }>,
  reply: FastifyReply
): Promise<RegisterConnectorResponse> {
  const { deviceId, deviceName, name, operatingSystem, company: tallyCompanyName } = request.body;
  const connectorName = (deviceName ?? name ?? "FinLayer Connector").trim();

  request.log.info(
    { deviceId, deviceName: connectorName, operatingSystem, company: tallyCompanyName },
    "Received connector registration request"
  );

  // 1. Optional company resolution (for backward compatibility)
  let companyId: string | null = null;
  let setupStatus = "REGISTERED";
  if (tallyCompanyName && tallyCompanyName.trim().length > 0) {
    const company = await prisma.company.findUnique({
      where: { tallyCompanyName: tallyCompanyName.trim() },
    });
    if (company) {
      companyId = company.id;
      setupStatus = "ACTIVE";
    }
  }

  // 2. Upsert connector by deviceId
  const now = new Date();
  const connector = await prisma.connector.upsert({
    where: { deviceId },
    update: {
      name: connectorName,
      ...(operatingSystem ? { operatingSystem } : {}),
      ...(companyId ? { companyId, setupStatus: "ACTIVE", tallyCompanyName: tallyCompanyName?.trim() } : {}),
      status: "ONLINE",
      lastHeartbeat: now,
    },
    create: {
      deviceId,
      name: connectorName,
      operatingSystem: operatingSystem ?? null,
      companyId,
      tallyCompanyName: tallyCompanyName?.trim() ?? null,
      setupStatus,
      status: "ONLINE",
      lastHeartbeat: now,
    },
  });

  request.log.info(
    { connectorId: connector.id, deviceId, status: connector.status, setupStatus: connector.setupStatus },
    "Connector registered"
  );

  return reply.status(200).send({
    success: true,
    connectorId: connector.id,
    setupStatus: connector.setupStatus,
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
    setupStatus: updated.setupStatus,
    companyId: updated.companyId,
    tallyCompanyName: updated.tallyCompanyName,
  });
}

// ─── Onboarding Endpoints ─────────────────────────────────────────────────────

async function handleReportTallyStatus(
  request: FastifyRequest<{ Params: { id: string }; Body: TallyStatusBody }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const existing = await prisma.connector.findUnique({ where: { id } });

  if (!existing) {
    return reply.status(404).send({ success: false, error: `Connector "${id}" not found.` });
  }

  // Only update if not already ACTIVE
  let setupStatus = existing.setupStatus;
  if (setupStatus !== "ACTIVE") {
    setupStatus = "TALLY_CONNECTED";
    await prisma.connector.update({
      where: { id },
      data: { setupStatus },
    });
  }

  return reply.status(200).send({ success: true, setupStatus });
}

async function handleReportTallyCompanies(
  request: FastifyRequest<{ Params: { id: string }; Body: TallyCompaniesBody }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const { companies } = request.body;

  const existing = await prisma.connector.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ success: false, error: `Connector "${id}" not found.` });
  }

  // Store temporarily in memory during onboarding session (NOT permanently in DB)
  onboardingTallyCompanies.set(id, companies ?? []);

  let setupStatus = existing.setupStatus;
  if (setupStatus !== "ACTIVE") {
    setupStatus = "WAITING_FOR_COMPANY";
    await prisma.connector.update({
      where: { id },
      data: { setupStatus },
    });
  }

  return reply.status(200).send({
    success: true,
    count: (companies ?? []).length,
    setupStatus,
  });
}

async function handleGetTallyCompanies(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const existing = await prisma.connector.findUnique({ where: { id } });

  if (!existing) {
    return reply.status(404).send({ success: false, error: `Connector "${id}" not found.` });
  }

  const companies = onboardingTallyCompanies.get(id) ?? [];
  return reply.status(200).send({
    success: true,
    setupStatus: existing.setupStatus,
    companies,
  });
}

async function handleSelectCompany(
  request: FastifyRequest<{ Params: { id: string }; Body: SelectCompanyBody }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const { companyName } = request.body;

  if (!companyName?.trim()) {
    return reply.status(400).send({ success: false, error: "companyName is required." });
  }

  const cleanName = companyName.trim();
  const connector = await prisma.connector.findUnique({ where: { id } });

  if (!connector) {
    return reply.status(404).send({ success: false, error: `Connector "${id}" not found.` });
  }

  // 1. Find or create company
  let company = await prisma.company.findFirst({
    where: {
      OR: [
        { tallyCompanyName: cleanName },
        { name: cleanName },
      ],
    },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        name: cleanName,
        tallyCompanyName: cleanName,
      },
    });
  }

  // Check if company already has Google connected
  const googleConn = await prisma.googleConnection.findUnique({
    where: { companyId: company.id },
  });
  const targetSetupStatus = googleConn ? "ACTIVE" : "WAITING_FOR_GOOGLE";

  // 2. Link connector, save tallyCompanyName, set setupStatus
  await prisma.connector.update({
    where: { id },
    data: {
      companyId: company.id,
      tallyCompanyName: cleanName,
      setupStatus: targetSetupStatus,
    },
  });

  // 3. Clear temporary discovery cache for this connector
  onboardingTallyCompanies.delete(id);

  return reply.status(200).send({
    success: true,
    companyId: company.id,
    setupStatus: targetSetupStatus,
  });
}

async function handleListConnectors(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const connectors = await prisma.connector.findMany({
    orderBy: { lastHeartbeat: "desc" },
    include: { company: true },
  });

  return reply.status(200).send({
    success: true,
    connectors: connectors.map((c) => ({
      id: c.id,
      name: c.name,
      deviceId: c.deviceId,
      operatingSystem: c.operatingSystem,
      status: c.status,
      setupStatus: c.setupStatus,
      tallyCompanyName: c.tallyCompanyName,
      companyId: c.companyId,
      companyName: c.company?.name ?? null,
      lastHeartbeat: c.lastHeartbeat.toISOString(),
    })),
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function connectorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/connectors", handleListConnectors);

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

  app.post<{ Params: { id: string }; Body: TallyStatusBody }>(
    "/connectors/:id/tally-status",
    { schema: connectorIdParamSchema },
    handleReportTallyStatus
  );

  app.post<{ Params: { id: string }; Body: TallyCompaniesBody }>(
    "/connectors/:id/tally-companies",
    { schema: connectorIdParamSchema },
    handleReportTallyCompanies
  );

  app.get<{ Params: { id: string } }>(
    "/connectors/:id/tally-companies",
    { schema: connectorIdParamSchema },
    handleGetTallyCompanies
  );

  app.post<{ Params: { id: string }; Body: SelectCompanyBody }>(
    "/connectors/:id/company",
    { schema: selectCompanySchema },
    handleSelectCompany
  );
}
