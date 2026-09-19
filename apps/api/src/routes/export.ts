import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import {
  authenticateUserOrConnector,
  requireTenantCompanyAccess,
} from "../auth/tenant-auth.js";
import {
  validateDateRange,
  sanitizeFilenameComponent,
  buildContentDispositionHeader,
  streamVouchersCsv,
  streamVouchersXml,
  streamLedgersCsv,
  streamLedgersXml,
  streamTrialBalanceCsv,
  streamTrialBalanceXml,
} from "../services/canonical-export-service.js";

interface ExportParams {
  companyId: string;
}

interface ExportQuery {
  format?: string;
  type?: string;
  fromDate?: string;
  toDate?: string;
}

async function handleExport(
  request: FastifyRequest<{ Params: ExportParams; Querystring: ExportQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { companyId } = request.params;
  const { format: rawFormat, type: rawType, fromDate, toDate } = request.query;

  // 1. Validate format
  const format = (rawFormat || "").trim().toLowerCase();
  if (format !== "csv" && format !== "xml") {
    return reply.status(400).send({
      success: false,
      error: `Invalid format "${rawFormat}". Supported formats: csv, xml.`,
    });
  }

  // 2. Validate type
  const type = (rawType || "").trim().toLowerCase();
  if (type !== "vouchers" && type !== "ledgers" && type !== "trial-balance") {
    return reply.status(400).send({
      success: false,
      error: `Invalid type "${rawType}". Supported types: vouchers, ledgers, trial-balance.`,
    });
  }

  // 3. Validate date range (only applies to vouchers, but validate parameters for all)
  const dateValidation = validateDateRange(fromDate, toDate);
  if (!dateValidation.valid) {
    return reply.status(400).send({
      success: false,
      error: dateValidation.error,
    });
  }

  // 4. Verify company existence
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });

  if (!company) {
    return reply.status(404).send({
      success: false,
      error: `Company "${companyId}" not found.`,
    });
  }

  // 5. Build sanitized filename and headers
  const companyName = company.name || company.tallyCompanyName || "company";
  const safeCompany = sanitizeFilenameComponent(companyName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safeCompany}_${type}_${timestamp}.${format}`;
  const contentType = format === "csv" ? "text/csv; charset=utf-8" : "application/xml; charset=utf-8";

  // 6. Hijack reply for chunked streaming
  reply.hijack();
  reply.raw.setHeader("Content-Type", contentType);
  reply.raw.setHeader("Content-Disposition", buildContentDispositionHeader(filename));
  reply.raw.writeHead(200);

  const abortController = new AbortController();
  const { signal: abortSignal } = abortController;

  const onClientDisconnect = () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  };

  request.raw.once("close", onClientDisconnect);
  reply.raw.once("close", onClientDisconnect);

  if (request.raw.destroyed || reply.raw.destroyed) {
    abortController.abort();
  }

  const writeChunk = async (chunk: string): Promise<boolean> => {
    if (abortSignal.aborted || reply.raw.destroyed) {
      return false;
    }

    const canContinue = reply.raw.write(chunk, "utf-8");
    if (!canContinue && !reply.raw.destroyed && !abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onAbortOrClose = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          reply.raw.off("drain", onDrain);
          reply.raw.off("close", onAbortOrClose);
          abortSignal.removeEventListener("abort", onAbortOrClose);
        };

        reply.raw.once("drain", onDrain);
        reply.raw.once("close", onAbortOrClose);
        abortSignal.addEventListener("abort", onAbortOrClose, { once: true });
      });
    }

    return !reply.raw.destroyed && !abortSignal.aborted;
  };

  try {
    if (type === "vouchers") {
      if (format === "csv") {
        await streamVouchersCsv(company.id, companyName, writeChunk, dateValidation.range, abortSignal);
      } else {
        await streamVouchersXml(company.id, companyName, company.tallyCompanyName, writeChunk, dateValidation.range, abortSignal);
      }
    } else if (type === "ledgers") {
      if (format === "csv") {
        await streamLedgersCsv(company.id, companyName, writeChunk, abortSignal);
      } else {
        await streamLedgersXml(company.id, companyName, company.tallyCompanyName, writeChunk, abortSignal);
      }
    } else if (type === "trial-balance") {
      if (format === "csv") {
        await streamTrialBalanceCsv(company.id, companyName, writeChunk, abortSignal);
      } else {
        await streamTrialBalanceXml(company.id, companyName, company.tallyCompanyName, writeChunk, abortSignal);
      }
    }
  } catch (streamErr) {
    if (!abortSignal.aborted) {
      request.log.error(streamErr, "Error streaming canonical export data");
    }
  } finally {
    request.raw.off("close", onClientDisconnect);
    reply.raw.off("close", onClientDisconnect);
    if (!reply.raw.writableEnded && !reply.raw.destroyed) {
      reply.raw.end();
    }
  }
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: ExportParams; Querystring: ExportQuery }>(
    "/dashboard/export/:companyId",
    {
      preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()],
    },
    handleExport
  );
}
