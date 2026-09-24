import type { FastifyReply, FastifyRequest } from "fastify";

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
 * Tenant Isolation: Connector A (bound to Company A) cannot access, read, or write data for Company B.
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
