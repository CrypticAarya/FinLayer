import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiKey } from "@prisma/client";
import crypto from "node:crypto";
import prisma from "../db/prisma.js";

declare module "fastify" {
  interface FastifyRequest {
    saasApiKey: ApiKey;
    authorizedCompanyId: string;
  }
}

/**
 * Computes SHA-256 hash of an API key.
 * Only the hash is stored in the database.
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Generates a cryptographically secure random API key, computes its SHA-256
 * digest, and stores the hashed record in PostgreSQL with company-level scoping.
 * The raw plaintext key is returned once upon creation and is NEVER stored.
 */
export async function generateSaasApiKey(params: {
  companyId: string;
  name: string;
}): Promise<{ apiKey: string; keyRecord: ApiKey }> {
  const randomHex = crypto.randomBytes(24).toString("hex");
  const rawKey = `fl_live_${randomHex}`;
  const keyPrefix = rawKey.slice(0, 12);
  const keyHash = hashApiKey(rawKey);

  const keyRecord = await prisma.apiKey.create({
    data: {
      name: params.name,
      keyPrefix,
      keyHash,
      companyId: params.companyId,
      status: "ACTIVE",
    },
  });

  return { apiKey: rawKey, keyRecord };
}

/**
 * Revokes an existing API key.
 */
export async function revokeSaasApiKey(keyId: string): Promise<ApiKey> {
  return prisma.apiKey.update({
    where: { id: keyId },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
    },
  });
}

/**
 * Fastify preHandler hook to authenticate SaaS API requests.
 * Accepts API key via 'Authorization: Bearer <key>' or 'x-api-key: <key>'.
 * Enforces:
 * - 401 on missing key
 * - 401 on invalid key
 * - 401 on revoked or inactive key
 */
export async function authenticateSaasApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  let rawKey: string | undefined;

  const authHeader = request.headers.authorization;
  const xApiKey = request.headers["x-api-key"];

  if (authHeader) {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: Invalid Authorization header format. Expected 'Bearer <apiKey>'.",
      });
    }
    rawKey = parts[1].trim();
  } else if (typeof xApiKey === "string" && xApiKey.trim()) {
    rawKey = xApiKey.trim();
  }

  if (!rawKey) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized: Missing API key. Provide Authorization: Bearer <apiKey> or x-api-key header.",
    });
  }

  const keyHash = hashApiKey(rawKey);

  const keyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!keyRecord) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized: Invalid API key.",
    });
  }

  if (keyRecord.status === "REVOKED" || keyRecord.revokedAt !== null) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized: API key has been revoked.",
    });
  }

  if (keyRecord.status !== "ACTIVE") {
    return reply.status(401).send({
      success: false,
      error: `Unauthorized: API key is inactive (status: ${keyRecord.status}).`,
    });
  }

  // Update tokenLastUsedAt asynchronously without blocking request
  prisma.apiKey
    .update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  request.saasApiKey = keyRecord;
  request.authorizedCompanyId = keyRecord.companyId;
}

/**
 * Fastify preHandler hook to enforce company-level permissions and isolation.
 * Validates that the authenticated key is scoped to the requested :companyId.
 * Enforces:
 * - 403 on cross-company access (Company A key requesting Company B data)
 * - 404 on company not found
 */
export async function requireSaasCompanyAccess(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const params = request.params as { companyId?: string };
  const requestedCompanyId = params.companyId;

  if (!requestedCompanyId) {
    return;
  }

  if (!request.saasApiKey || request.saasApiKey.companyId !== requestedCompanyId) {
    return reply.status(403).send({
      success: false,
      error: "Forbidden: API key does not have access to this company.",
    });
  }

  // Verify company exists in database
  const company = await prisma.company.findUnique({
    where: { id: requestedCompanyId },
    select: { id: true },
  });

  if (!company) {
    return reply.status(404).send({
      success: false,
      error: `Company "${requestedCompanyId}" not found.`,
    });
  }
}
