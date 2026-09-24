import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import {
  authenticateConnector,
  generateConnectorToken,
  hashConnectorToken,
  requireConnectorOwnership,
} from "../auth/connector-auth.js";
import { authenticateSaasApiKey, requireSaasCompanyAccess } from "../auth/saas-auth.js";
import { PairingStoreManager, type PairingEntry } from "../services/pairing-store.js";

// Re-export PairingEntry for any consumers
export type { PairingEntry };

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
  pairingCode?: string;
}

export interface RegisterConnectorResponse {
  success: true;
  connectorId: string;
  setupStatus: string;
  token: string;
}

export interface HeartbeatParams {
  id: string;
}

export interface HeartbeatBody {
  version?: string;
  connectorVersion?: string;
  status?: string;
}

export interface HeartbeatResponse {
  success: true;
  status: string;
  setupStatus: string;
  companyId: string | null;
  tallyCompanyName: string | null;
  connectorId?: string;
  connectorVersion?: string | null;
  lastSeenAt?: string;
}

export interface TallyStatusBody {
  status: "TALLY_CONNECTED";
}

export interface TallyCompaniesBody {
  companies: Array<{ name: string }>;
}

export interface SelectCompanyBody {
  companyName?: string;
  pairingCode?: string;
}

export interface PairConnectorBody {
  pairingCode: string;
  tallyCompanyName?: string;
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
      pairingCode: { type: "string" },
    },
  },
} as const;

const upgradeV1TokenSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
  body: {
    type: "object",
    required: ["deviceId"],
    properties: {
      deviceId: { type: "string" },
    },
  },
} as const;


const heartbeatSchema = {
  params: {
    type: "object",
    properties: {
      id: { type: "string" },
    },
  },
  body: {
    type: ["object", "null"],
    properties: {
      version: { type: "string" },
      connectorVersion: { type: "string" },
      status: { type: "string" },
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
    properties: {
      companyName: { type: "string" },
      pairingCode: { type: "string" },
    },
  },
} as const;

const pairConnectorSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
  body: {
    type: "object",
    required: ["pairingCode"],
    properties: {
      pairingCode: { type: "string" },
      tallyCompanyName: { type: "string" },
    },
  },
} as const;

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleRegisterConnector(
  request: FastifyRequest<{ Body: RegisterConnectorBody }>,
  reply: FastifyReply
): Promise<RegisterConnectorResponse> {
  const { deviceId, deviceName, name, operatingSystem, company: tallyCompanyName, pairingCode } = request.body;
  const connectorName = (deviceName ?? name ?? "FinLayer Connector").trim();

  request.log.info(
    { deviceId, deviceName: connectorName, operatingSystem, company: tallyCompanyName, hasPairingCode: Boolean(pairingCode) },
    "Received connector registration request"
  );

  // 1. Permanent Security Rule: Never allow re-registration of existing deviceId
  const existingConnector = await prisma.connector.findUnique({
    where: { deviceId },
  });

  if (existingConnector) {
    request.log.warn(
      { deviceId, connectorId: existingConnector.id, status: existingConnector.status },
      "Registration rejected: deviceId is already registered"
    );
    return reply.status(409).send({
      success: false,
      error: "Device already registered. Recovery required.",
    } as never);
  }

  // 2. Company binding resolution (Strict Pairing Architecture)
  let companyId: string | null = null;
  let setupStatus = "REGISTERED";

  if (pairingCode && pairingCode.trim().length > 0) {
    const entry = await PairingStoreManager.getStore().verifyAndConsumeCode(pairingCode);
    if (!entry) {
      return reply.status(400).send({
        success: false,
        error: "Invalid or expired pairing code.",
      } as never);
    }
    companyId = entry.companyId;
    setupStatus = "ACTIVE";
  } else if (tallyCompanyName && tallyCompanyName.trim().length > 0) {
    // In non-production/test mode only: maintain backward compatibility for existing test suites
    if (process.env.NODE_ENV !== "production") {
      const company = await prisma.company.findUnique({
        where: { tallyCompanyName: tallyCompanyName.trim() },
      });
      if (company) {
        companyId = company.id;
        setupStatus = "ACTIVE";
      }
    }
  }

  // 3. Generate secure connector token & hash
  const token = generateConnectorToken();
  const tokenHash = hashConnectorToken(token);
  const now = new Date();

  // 4. Create new connector (handle concurrent registration race conditions cleanly)
  try {
    const connector = await prisma.connector.create({
      data: {
        deviceId,
        name: connectorName,
        tokenHash,
        tokenCreatedAt: now,
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
      "Connector registered with secure token"
    );

    return reply.status(200).send({
      success: true,
      connectorId: connector.id,
      setupStatus: connector.setupStatus,
      token,
    });
  } catch (err: any) {
    // Catch P2002 unique constraint violation on deviceId if two concurrent requests race
    if (err?.code === "P2002") {
      request.log.warn(
        { deviceId },
        "Concurrent registration race condition caught: deviceId unique constraint"
      );
      return reply.status(409).send({
        success: false,
        error: "Device already registered. Recovery required.",
      } as never);
    }
    throw err;
  }
}

async function handleUpgradeV1Token(
  request: FastifyRequest<{ Params: { id: string }; Body: { deviceId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const { deviceId } = request.body;

  const connector = await prisma.connector.findUnique({
    where: { id },
  });

  if (!connector) {
    return reply.status(404).send({
      success: false,
      error: `Connector "${id}" not found.`,
    });
  }

  // 1. Strict deviceId verification (prevents impersonation / hijacking)
  if (connector.deviceId !== deviceId) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: Device ID mismatch.",
    });
  }

  // 2. Single-use invariant: Can ONLY upgrade legacy V1 connectors whose tokenHash IS NULL
  if (connector.tokenHash !== null) {
    return reply.status(409).send({
      success: false,
      error: "Conflict: Connector token has already been provisioned. Upgrade not allowed.",
    });
  }

  // 3. Strict revocation check
  if (connector.status === "REVOKED" || connector.tokenRevokedAt !== null) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: Revoked connector cannot be upgraded.",
    });
  }

  const token = generateConnectorToken();
  const tokenHash = hashConnectorToken(token);
  const now = new Date();

  await prisma.connector.update({
    where: { id: connector.id },
    data: {
      tokenHash,
      tokenCreatedAt: now,
      tokenLastUsedAt: now,
    },
  });

  request.log.info(
    { connectorId: connector.id, deviceId },
    "Legacy V1 connector upgraded with secure token"
  );

  return reply.status(200).send({
    success: true,
    connectorId: connector.id,
    token,
  });
}

async function handleRotateToken(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const connector = request.connector;
  const newToken = generateConnectorToken();
  const tokenHash = hashConnectorToken(newToken);
  const now = new Date();

  await prisma.connector.update({
    where: { id: connector.id },
    data: {
      tokenHash,
      tokenCreatedAt: now,
      tokenRevokedAt: null,
    },
  });

  request.log.info({ connectorId: connector.id }, "Connector token rotated successfully");

  return reply.status(200).send({
    success: true,
    connectorId: connector.id,
    token: newToken,
  });
}

async function handleRevokeToken(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const connector = request.connector;

  await prisma.connector.update({
    where: { id: connector.id },
    data: {
      tokenRevokedAt: new Date(),
      status: "REVOKED",
    },
  });

  request.log.info({ connectorId: connector.id }, "Connector token revoked successfully");

  return reply.status(200).send({
    success: true,
    message: "Connector token revoked successfully.",
  });
}

async function handleVerifyToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const connector = request.connector;

  return reply.status(200).send({
    success: true,
    connector: {
      id: connector.id,
      name: connector.name,
      deviceId: connector.deviceId,
      companyId: connector.companyId,
      status: connector.status,
      setupStatus: connector.setupStatus,
      tokenCreatedAt: connector.tokenCreatedAt,
      tokenLastUsedAt: connector.tokenLastUsedAt,
    },
  });
}

async function handleHeartbeat(
  request: FastifyRequest<{ Params?: Partial<HeartbeatParams>; Body?: HeartbeatBody }>,
  reply: FastifyReply
): Promise<HeartbeatResponse> {
  const connectorId = request.params?.id || request.connector?.id;
  if (!connectorId) {
    return reply.status(400).send({
      success: false,
      error: "Missing connector identity.",
    } as never);
  }

  const connectorVersion = request.body?.connectorVersion || request.body?.version || null;
  const status = request.body?.status || "ONLINE";
  const now = new Date();

  const existing = await prisma.connector.findUnique({
    where: { id: connectorId },
  });

  if (!existing) {
    return reply.status(404).send({
      success: false,
      error: `Connector "${connectorId}" not found.`,
    } as never);
  }

  // Update Connector and record immutable ConnectorHeartbeat entry in transaction
  const [updated] = await prisma.$transaction([
    prisma.connector.update({
      where: { id: connectorId },
      data: {
        status,
        lastHeartbeat: now,
        lastSeenAt: now,
        ...(connectorVersion ? { connectorVersion } : {}),
      },
    }),
    prisma.connectorHeartbeat.create({
      data: {
        connectorId,
        companyId: existing.companyId,
        connectorVersion: connectorVersion || existing.connectorVersion,
        status,
        lastSeenAt: now,
      },
    }),
  ]);

  request.log.debug({ connectorId, connectorVersion, status }, "Heartbeat recorded successfully");

  return reply.status(200).send({
    success: true,
    status: updated.status,
    setupStatus: updated.setupStatus,
    companyId: updated.companyId,
    tallyCompanyName: updated.tallyCompanyName,
    connectorId: updated.id,
    connectorVersion: updated.connectorVersion,
    lastSeenAt: updated.lastSeenAt?.toISOString() || now.toISOString(),
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
  const { companyName, pairingCode } = request.body || {};

  const connector = await prisma.connector.findUnique({ where: { id } });
  if (!connector) {
    return reply.status(404).send({ success: false, error: `Connector "${id}" not found.` });
  }

  // 1. If pairing code is provided, verify and consume code
  if (pairingCode && pairingCode.trim().length > 0) {
    const entry = await PairingStoreManager.getStore().verifyAndConsumeCode(pairingCode);
    if (!entry) {
      return reply.status(400).send({
        success: false,
        error: "Invalid or expired pairing code.",
      });
    }

    const company = await prisma.company.findUnique({ where: { id: entry.companyId } });
    if (!company) {
      return reply.status(404).send({ success: false, error: "Paired company not found." });
    }

    const targetSetupStatus = "ACTIVE";

    await prisma.connector.update({
      where: { id },
      data: {
        companyId: company.id,
        tallyCompanyName: companyName?.trim() || connector.tallyCompanyName || company.tallyCompanyName || company.name,
        setupStatus: targetSetupStatus,
      },
    });

    onboardingTallyCompanies.delete(id);

    return reply.status(200).send({
      success: true,
      companyId: company.id,
      setupStatus: targetSetupStatus,
    });
  }

  // 2. If NO pairing code is provided, check if company already exists
  if (!companyName?.trim()) {
    return reply.status(400).send({
      success: false,
      error: "companyName or pairingCode is required.",
    });
  }

  const cleanName = companyName.trim();
  const existingCompany = await prisma.company.findFirst({
    where: {
      OR: [
        { tallyCompanyName: cleanName },
        { name: cleanName },
      ],
    },
  });

  if (existingCompany) {
    // Production Blocker Rule: Never auto-bind to an existing company without pairing authorization
    return reply.status(403).send({
      success: false,
      error: "Company already exists. Explicit pairing code required to bind this connector.",
    });
  }

  // 3. For a fresh, newly created company (first-time tenant registration)
  const newCompany = await prisma.company.create({
    data: {
      name: cleanName,
      tallyCompanyName: cleanName,
    },
  });

  await prisma.connector.update({
    where: { id },
    data: {
      companyId: newCompany.id,
      tallyCompanyName: cleanName,
      setupStatus: "ACTIVE",
    },
  });

  onboardingTallyCompanies.delete(id);

  return reply.status(200).send({
    success: true,
    companyId: newCompany.id,
    setupStatus: "ACTIVE",
  });
}

// ─── Dedicated Pairing Handlers ───────────────────────────────────────────────

async function handleGeneratePairingCode(
  request: FastifyRequest<{ Params: { companyId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
  }

  const pairingCode = await PairingStoreManager.getStore().createCode(
    company.id,
    request.saasApiKey?.name || "API"
  );

  request.log.info(
    { companyId: company.id, event: "pairing_code_generated" },
    "Pairing code generated"
  );

  return reply.status(200).send({
    success: true,
    companyId: company.id,
    companyName: company.name,
    pairingCode,
    expiresInSeconds: 900,
  });
}

async function handlePairConnector(
  request: FastifyRequest<{ Params: { id: string }; Body: PairConnectorBody }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = request.params;
  const { pairingCode, tallyCompanyName } = request.body;

  const connector = await prisma.connector.findUnique({ where: { id } });
  if (!connector) {
    return reply.status(404).send({ success: false, error: `Connector "${id}" not found.` });
  }

  const entry = await PairingStoreManager.getStore().verifyAndConsumeCode(pairingCode);
  if (!entry) {
    return reply.status(400).send({
      success: false,
      error: "Invalid or expired pairing code.",
    });
  }

  const company = await prisma.company.findUnique({ where: { id: entry.companyId } });
  if (!company) {
    return reply.status(404).send({ success: false, error: "Paired company not found." });
  }

  const targetSetupStatus = "ACTIVE";

  await prisma.connector.update({
    where: { id },
    data: {
      companyId: company.id,
      tallyCompanyName: tallyCompanyName?.trim() || connector.tallyCompanyName || company.tallyCompanyName || company.name,
      setupStatus: targetSetupStatus,
    },
  });

  onboardingTallyCompanies.delete(id);

  request.log.info(
    { connectorId: id, companyId: company.id, setupStatus: targetSetupStatus },
    "Connector successfully paired with company"
  );

  return reply.status(200).send({
    success: true,
    connectorId: id,
    companyId: company.id,
    companyName: company.name,
    setupStatus: targetSetupStatus,
  });
}

async function handleListConnectors(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const connector = request.connector;
  const saasApiKey = request.saasApiKey;

  let allowedCompanyIds: string[] | undefined;
  if (connector) {
    allowedCompanyIds = connector.companyId ? [connector.companyId] : [];
  } else if (saasApiKey) {
    allowedCompanyIds = [saasApiKey.companyId];
  }

  const connectors = await prisma.connector.findMany({
    where: allowedCompanyIds ? { companyId: { in: allowedCompanyIds } } : {},
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

/**
 * Fastify preHandler hook accepting either connector Bearer token or SaaS API key.
 */
async function authenticateConnectorOrSaas(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const xApiKey = request.headers["x-api-key"];

  if (
    authHeader &&
    (authHeader.startsWith("Bearer ct_") || authHeader.startsWith("Bearer fl_conn_"))
  ) {
    return authenticateConnector(request, reply);
  }

  if (
    (typeof xApiKey === "string" && xApiKey.trim()) ||
    (authHeader && authHeader.startsWith("Bearer fl_live_"))
  ) {
    return authenticateSaasApiKey(request, reply);
  }

  return reply.status(401).send({
    success: false,
    error: "Unauthorized: Missing or invalid authentication. Provide Bearer ct_<token> or x-api-key fl_live_<key>.",
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function connectorRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/connectors",
    { preHandler: [authenticateConnectorOrSaas] },
    handleListConnectors
  );

  app.post<{ Body: RegisterConnectorBody }>(
    "/connectors/register",
    { schema: registerConnectorSchema },
    handleRegisterConnector
  );

  app.post<{ Params: { id: string }; Body: { deviceId: string } }>(
    "/connectors/:id/upgrade-v1-token",
    { schema: upgradeV1TokenSchema },
    handleUpgradeV1Token
  );


  app.get(
    "/connectors/verify-token",
    { preHandler: [authenticateConnector] },
    handleVerifyToken
  );

  app.post<{ Params: { id: string } }>(
    "/connectors/:id/rotate-token",
    {
      schema: connectorIdParamSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handleRotateToken
  );

  app.post<{ Params: { id: string } }>(
    "/connectors/:id/revoke-token",
    {
      schema: connectorIdParamSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handleRevokeToken
  );

  app.post<{ Params: HeartbeatParams; Body?: HeartbeatBody }>(
    "/connectors/:id/heartbeat",
    {
      schema: heartbeatSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handleHeartbeat
  );

  app.post<{ Body?: HeartbeatBody }>(
    "/connectors/heartbeat",
    {
      schema: { body: heartbeatSchema.body },
      preHandler: [authenticateConnector],
    },
    handleHeartbeat
  );

  app.post<{ Params: { id: string }; Body: TallyStatusBody }>(
    "/connectors/:id/tally-status",
    {
      schema: connectorIdParamSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handleReportTallyStatus
  );

  app.post<{ Params: { id: string }; Body: TallyCompaniesBody }>(
    "/connectors/:id/tally-companies",
    {
      schema: connectorIdParamSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handleReportTallyCompanies
  );

  app.get<{ Params: { id: string } }>(
    "/connectors/:id/tally-companies",
    {
      schema: connectorIdParamSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handleGetTallyCompanies
  );

async function handleGetTallyStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const connector = request.connector;
  if (!connector) {
    return reply.status(401).send({ success: false, error: "Unauthorized: Connector authentication required." });
  }
  return reply.status(200).send({
    success: true,
    connectorId: connector.id,
    setupStatus: connector.setupStatus,
    status: connector.status,
    tallyCompanyName: connector.tallyCompanyName,
  });
}

  app.get(
    "/connectors/tally-status",
    { preHandler: [authenticateConnector] },
    handleGetTallyStatus
  );

  app.post<{ Params: { id: string }; Body: SelectCompanyBody }>(
    "/connectors/:id/company",
    {
      schema: selectCompanySchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handleSelectCompany
  );

  app.post<{ Body: SelectCompanyBody }>(
    "/connectors/select-company",
    {
      schema: { body: selectCompanySchema.body },
      preHandler: [authenticateConnector],
    },
    async (request, reply) => {
      const id = request.connector.id;
      return handleSelectCompany({ ...request, params: { id } } as any, reply);
    }
  );

  // ── Pairing Architecture Endpoints ──

  app.post<{ Params: { companyId: string } }>(
    "/companies/:companyId/pairing-code",
    {
      schema: {
        params: {
          type: "object",
          required: ["companyId"],
          properties: {
            companyId: { type: "string" },
          },
        },
      },
      preHandler: [authenticateSaasApiKey, requireSaasCompanyAccess],
    },
    handleGeneratePairingCode
  );

  app.post<{ Params: { id: string }; Body: PairConnectorBody }>(
    "/connectors/:id/pair",
    {
      schema: pairConnectorSchema,
      preHandler: [authenticateConnector, requireConnectorOwnership("id")],
    },
    handlePairConnector
  );
}
