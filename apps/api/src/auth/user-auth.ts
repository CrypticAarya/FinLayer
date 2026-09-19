import type { FastifyReply, FastifyRequest } from "fastify";
import type { User, CompanyMember, Company } from "@prisma/client";
import crypto from "node:crypto";
import prisma from "../db/prisma.js";

export type AuthenticatedUser = User & {
  memberships: Array<CompanyMember & { company: Company }>;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    userMemberships?: Array<CompanyMember & { company: Company }>;
  }
}

/**
 * Computes SHA-256 hash of a human user session token.
 */
export function hashUserToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a new cryptographically secure human user session token.
 * Format: fl_usr_<64 hex characters>
 */
export function generateUserToken(): string {
  const randomHex = crypto.randomBytes(32).toString("hex");
  return `fl_usr_${randomHex}`;
}

/**
 * Fastify preHandler hook to verify human user session token.
 * Strictly rejects missing, malformed, invalid, or expired sessions.
 */
export async function authenticateUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const userTokenHeader = request.headers["x-user-token"];

  let rawToken: string | undefined;

  if (typeof userTokenHeader === "string" && userTokenHeader.trim()) {
    rawToken = userTokenHeader.trim();
  } else if (authHeader) {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0] === "Bearer") {
      rawToken = parts[1].trim();
    }
  }

  if (!rawToken) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized: Missing user authentication token.",
    });
  }

  const tokenHash = hashUserToken(rawToken);

  const session = await prisma.userSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: {
            include: { company: true },
          },
        },
      },
    },
  });

  if (!session) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized: Invalid or expired session.",
    });
  }

  // Verify session expiration
  if (session.expiresAt.getTime() <= Date.now()) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized: Session expired.",
    });
  }

  // Update lastUsedAt asynchronously without blocking
  prisma.userSession
    .update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => {
      request.log.warn({ err, sessionId: session.id }, "Failed to update session lastUsedAt");
    });

  request.user = session.user;
  request.userMemberships = session.user.memberships;
}

/**
 * Fastify preHandler hook to optionally authenticate a human user if credentials are provided.
 * If credentials are not provided, request proceeds unauthenticated without returning an error.
 */
export async function optionalAuthenticateUser(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const userTokenHeader = request.headers["x-user-token"];

  let rawToken: string | undefined;

  if (typeof userTokenHeader === "string" && userTokenHeader.trim()) {
    rawToken = userTokenHeader.trim();
  } else if (authHeader) {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0] === "Bearer") {
      rawToken = parts[1].trim();
    }
  }

  if (!rawToken) return;

  const tokenHash = hashUserToken(rawToken);

  const session = await prisma.userSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          memberships: {
            include: { company: true },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return;
  }

  request.user = session.user;
  request.userMemberships = session.user.memberships;
}
