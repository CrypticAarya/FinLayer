import type { FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import prisma from "../db/prisma.js";
import { hashUserToken } from "./user-auth.js";

export interface CompanyOwnershipOptions {
  /**
   * Custom extractor function to retrieve the requested company identifier (ID or name)
   * from the FastifyRequest.
   */
  extractCompanyTarget?: (request: FastifyRequest) => string | undefined;
}

/**
 * Fastify preHandler hook ensuring the authenticated connector is bound to a company
 * and matches the company resource being accessed or written.
 *
 * Connector A (bound to Company A) cannot access, read, or write data for Company B.
 */
export function requireCompanyOwnership(options?: CompanyOwnershipOptions) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const connector = request.connector;

    if (!connector) {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: Missing or invalid connector authentication.",
      });
    }

    if (!connector.companyId) {
      return reply.status(403).send({
        success: false,
        error: "Forbidden: Connector is not linked to any company.",
      });
    }

    // 1. Determine target company identifier from custom extractor, params, query, or body
    let target: string | undefined;

    if (options?.extractCompanyTarget) {
      target = options.extractCompanyTarget(request);
    } else {
      const params = (request.params ?? {}) as Record<string, string | undefined>;
      const query = (request.query ?? {}) as Record<string, string | undefined>;
      const body = (request.body ?? {}) as Record<string, any>;

      target =
        params.companyId ||
        query.companyId ||
        body.companyId ||
        (typeof body.company === "string" ? body.company : undefined);
    }

    // If no target company was specified in the request, continue:
    // the route handler MUST use request.connector.companyId as the authoritative tenant ID.
    if (!target) {
      return;
    }

    const cleanTarget = target.trim();
    if (!cleanTarget) {
      return;
    }

    // 2. Direct match on company ID
    if (cleanTarget === connector.companyId) {
      return;
    }

    // 3. Match against company tallyCompanyName or name
    if (connector.company) {
      const tallyName = connector.company.tallyCompanyName?.trim().toLowerCase();
      const companyName = connector.company.name.trim().toLowerCase();
      const targetLower = cleanTarget.toLowerCase();

      if (tallyName === targetLower || companyName === targetLower) {
        return;
      }
    }

    // If the target does not match connector's company, reject with 403
    return reply.status(403).send({
      success: false,
      error: "Forbidden: You cannot access, read, or sync data belonging to another company.",
    });
  };
}

/**
 * Strict authentication preHandler hook for shared financial and dashboard endpoints.
 * Accepts either:
 * 1. An authenticated human User session token (fl_usr_* or valid UserSession), OR
 * 2. An authenticated Connector token (fl_conn_* or valid Connector tokenHash)
 *
 * Strictly rejects missing, malformed, or invalid tokens with HTTP 401 Unauthorized.
 * NEVER FAILS OPEN.
 */
export async function authenticateUserOrConnector(
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
      error: "Unauthorized: Missing authentication credentials.",
    });
  }

  // 1. If token starts with "fl_conn_", check Connector table
  if (rawToken.startsWith("fl_conn_")) {
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const connector = await prisma.connector.findUnique({
      where: { tokenHash },
      include: { company: true },
    });

    if (!connector || connector.status === "REVOKED") {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: Invalid or revoked connector token.",
      });
    }

    request.connector = connector;
    return;
  }

  // 2. If token starts with "fl_usr_", check UserSession table
  if (rawToken.startsWith("fl_usr_")) {
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
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: Invalid or expired user session.",
      });
    }

    request.user = session.user;
    request.userMemberships = session.user.memberships;
    return;
  }

  // 3. Fallback: try UserSession then Connector for legacy/unprefixed tokens
  const genericHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const userSession = await prisma.userSession.findUnique({
    where: { tokenHash: genericHash },
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

  if (userSession && userSession.expiresAt.getTime() > Date.now()) {
    request.user = userSession.user;
    request.userMemberships = userSession.user.memberships;
    return;
  }

  const connector = await prisma.connector.findUnique({
    where: { tokenHash: genericHash },
    include: { company: true },
  });

  if (connector && connector.status !== "REVOKED") {
    request.connector = connector;
    return;
  }

  return reply.status(401).send({
    success: false,
    error: "Unauthorized: Invalid authentication credentials.",
  });
}

/**
 * Fastify preHandler hook enforcing tenant access for either an authenticated User
 * or an authenticated Connector.
 *
 * Rejects cross-tenant access with HTTP 403 Forbidden.
 */
export function requireTenantCompanyAccess(options?: CompanyOwnershipOptions) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const connector = request.connector;
    const user = request.user;
    const memberships = request.userMemberships ?? [];

    if (!connector && !user) {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: Authentication required.",
      });
    }

    // Determine target company identifier
    let target: string | undefined;

    if (options?.extractCompanyTarget) {
      target = options.extractCompanyTarget(request);
    } else {
      const params = (request.params ?? {}) as Record<string, string | undefined>;
      const query = (request.query ?? {}) as Record<string, string | undefined>;
      const body = (request.body ?? {}) as Record<string, any>;

      target =
        params.companyId ||
        query.companyId ||
        body.companyId ||
        (typeof body.company === "string" ? body.company : undefined);
    }

    if (!target) {
      return; // Route handler will derive authoritative company from actor
    }

    const cleanTarget = target.trim();
    if (!cleanTarget) {
      return;
    }

    // A. If acting as Connector:
    if (connector) {
      if (!connector.companyId) {
        return reply.status(403).send({
          success: false,
          error: "Forbidden: Connector is not linked to any company.",
        });
      }

      if (cleanTarget === connector.companyId) {
        return;
      }

      if (connector.company) {
        const tallyName = connector.company.tallyCompanyName?.trim().toLowerCase();
        const compName = connector.company.name.trim().toLowerCase();
        const targetLower = cleanTarget.toLowerCase();

        if (tallyName === targetLower || compName === targetLower) {
          return;
        }
      }

      return reply.status(403).send({
        success: false,
        error: "Forbidden: You cannot access financial data belonging to another company.",
      });
    }

    // B. If acting as User:
    if (user) {
      if (user.role === "SUPER_ADMIN") {
        return;
      }

      const hasAccess = memberships.some((m) => {
        if (m.companyId === cleanTarget) return true;
        if (m.company?.name && m.company.name.toLowerCase() === cleanTarget.toLowerCase()) return true;
        if (m.company?.tallyCompanyName && m.company.tallyCompanyName.toLowerCase() === cleanTarget.toLowerCase()) return true;
        return false;
      });

      if (hasAccess) {
        return;
      }

      return reply.status(403).send({
        success: false,
        error: "Forbidden: You do not have access to this company's financial data.",
      });
    }
  };
}

/**
 * Backward compatibility alias: enforces strict authentication and company ownership
 * on endpoints that formerly used optionalConnectorCompanyOwnership.
 */
export function optionalConnectorCompanyOwnership() {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticateUserOrConnector(request, reply);
    if (reply.sent) return;
    await requireTenantCompanyAccess()(request, reply);
  };
}
