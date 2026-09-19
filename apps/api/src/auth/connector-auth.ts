import type { FastifyReply, FastifyRequest } from "fastify";
import type { Connector, Company } from "@prisma/client";
import crypto from "node:crypto";
import prisma from "../db/prisma.js";

export type AuthenticatedConnector = Connector & {
  company: Company | null;
};

declare module "fastify" {
  interface FastifyRequest {
    connector: AuthenticatedConnector;
  }
}

/**
 * Computes SHA-256 hash of a connector token.
 */
export function hashConnectorToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a new cryptographically secure connector token.
 */
export function generateConnectorToken(): string {
  const randomHex = crypto.randomBytes(32).toString("hex");
  return `fl_conn_${randomHex}`;
}

/**
 * Fastify preHandler hook to verify connector Bearer token.
 */
export async function authenticateConnector(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({
      success: false,
      error: "Missing Authorization header. Expected 'Bearer fl_conn_...'.",
    });
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return reply.status(401).send({
      success: false,
      error: "Invalid Authorization header format. Expected 'Bearer fl_conn_...'.",
    });
  }

  const token = parts[1].trim();
  if (!token || !token.startsWith("fl_conn_")) {
    return reply.status(401).send({
      success: false,
      error: "Invalid token format. Expected 'fl_conn_<hex>'.",
    });
  }

  const tokenHash = hashConnectorToken(token);

  const connector = await prisma.connector.findUnique({
    where: { tokenHash },
    include: { company: true },
  });

  if (!connector) {
    return reply.status(401).send({
      success: false,
      error: "Invalid connector token.",
    });
  }

  // Validate connector is not revoked
  if (connector.status === "REVOKED" || connector.tokenRevokedAt !== null) {
    return reply.status(401).send({
      success: false,
      error: "Connector token has been revoked.",
    });
  }

  // Validate connector is active
  if (connector.status !== "ONLINE" && connector.status !== "OFFLINE") {
    return reply.status(401).send({
      success: false,
      error: `Connector is not active (status: ${connector.status}).`,
    });
  }

  // Update tokenLastUsedAt asynchronously
  await prisma.connector.update({
    where: { id: connector.id },
    data: { tokenLastUsedAt: new Date() },
  });

  request.connector = connector;
}

/**
 * Fastify preHandler hook to verify that an authenticated connector owns the resource
 * identified by request.params[paramName] (defaults to 'id').
 * Prevents Connector A from accessing Connector B's resources.
 */
export function requireConnectorOwnership(paramName: string = "id") {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const params = request.params as Record<string, string | undefined>;
    const targetConnectorId = params[paramName];

    if (!targetConnectorId) {
      return;
    }

    if (!request.connector || request.connector.id !== targetConnectorId) {
      return reply.status(403).send({
        success: false,
        error: "Forbidden: You cannot access or modify resources belonging to another connector.",
      });
    }
  };
}
