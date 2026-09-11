import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import { encrypt } from "../utils/crypto.js";
import {
  isGoogleOAuthConfigured,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  createFinancialSpreadsheet,
  createMockFinancialSpreadsheet,
} from "../services/google-sheets-service.js";
import { getMockGoogleSheetTab } from "../services/google-sheet-sync-service.js";

interface CompanyIdParam {
  companyId: string;
}

interface CallbackQuery {
  code?: string;
  state?: string;
  mock?: string;
  error?: string;
}

interface MockConnectBody {
  googleEmail?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
}

export async function googleRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /google/connect/:companyId ─────────────────────────────────────────
  app.get<{ Params: CompanyIdParam }>(
    "/google/connect/:companyId",
    async (request: FastifyRequest<{ Params: CompanyIdParam }>, reply: FastifyReply) => {
      const { companyId } = request.params;

      const company = await prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
      }

      if (isGoogleOAuthConfigured()) {
        const authUrl = getGoogleAuthUrl(companyId);
        return reply.redirect(authUrl);
      }

      // In development when credentials are not yet added, fallback to demo/mock flow
      return reply.redirect(`/google/callback?state=${companyId}&mock=true`);
    }
  );

  // ─── GET /google/callback ───────────────────────────────────────────────────
  app.get<{ Querystring: CallbackQuery }>(
    "/google/callback",
    async (request: FastifyRequest<{ Querystring: CallbackQuery }>, reply: FastifyReply) => {
      const { code, state: companyId, mock, error } = request.query;

      if (error) {
        return reply.redirect(`/setup/google?companyId=${companyId || ""}&error=${encodeURIComponent(error)}`);
      }

      if (!companyId) {
        return reply.status(400).send({ success: false, error: "Missing state (companyId) in callback." });
      }

      const company = await prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
      }

      try {
        let googleEmail = "finance@company.com";
        let rawRefreshToken = "mock_refresh_token_" + Date.now();
        let spreadsheetId = "";
        let spreadsheetUrl = "";

        if (code && !mock) {
          // Live Google OAuth flow
          const tokens = await exchangeCodeForTokens(code);
          googleEmail = tokens.email;
          rawRefreshToken = tokens.refreshToken || "access_token_holder";

          // Create spreadsheet with Dashboard, Trial Balance, Ledgers, Transactions tabs
          const sheet = await createFinancialSpreadsheet(tokens.accessToken, company.name);
          spreadsheetId = sheet.spreadsheetId;
          spreadsheetUrl = sheet.spreadsheetUrl;
        } else {
          // Mock / development flow
          const mockSheet = createMockFinancialSpreadsheet(company.name);
          spreadsheetId = mockSheet.spreadsheetId;
          spreadsheetUrl = mockSheet.spreadsheetUrl;
          googleEmail = `finance@${company.name.toLowerCase().replace(/[^a-z0-9]/g, "") || "company"}.com`;
        }

        const encryptedRefreshToken = encrypt(rawRefreshToken);

        // 1. Save or update Google connection
        await prisma.googleConnection.upsert({
          where: { companyId },
          update: {
            googleEmail,
            refreshToken: encryptedRefreshToken,
            spreadsheetId,
            spreadsheetUrl,
          },
          create: {
            companyId,
            googleEmail,
            refreshToken: encryptedRefreshToken,
            spreadsheetId,
            spreadsheetUrl,
          },
        });

        // 2. Advance linked connectors to ACTIVE
        await prisma.connector.updateMany({
          where: {
            companyId,
            setupStatus: { in: ["WAITING_FOR_GOOGLE", "WAITING_FOR_COMPANY", "REGISTERED"] },
          },
          data: {
            setupStatus: "ACTIVE",
          },
        });

        request.log.info({ companyId, googleEmail, spreadsheetId }, "Google Connection established and spreadsheet created");

        return reply.redirect(`/setup/google?companyId=${companyId}&success=true`);
      } catch (err) {
        request.log.error(err, "Failed to complete Google OAuth connection");
        const msg = err instanceof Error ? err.message : String(err);
        return reply.redirect(`/setup/google?companyId=${companyId}&error=${encodeURIComponent(msg)}`);
      }
    }
  );

  // ─── GET /google/status/:companyId ──────────────────────────────────────────
  app.get<{ Params: CompanyIdParam }>(
    "/google/status/:companyId",
    async (request: FastifyRequest<{ Params: CompanyIdParam }>, reply: FastifyReply) => {
      const { companyId } = request.params;

      const connection = await prisma.googleConnection.findUnique({
        where: { companyId },
      });

      return reply.status(200).send({
        success: true,
        oauthConfigured: isGoogleOAuthConfigured(),
        connected: Boolean(connection),
        connection: connection
          ? {
              googleEmail: connection.googleEmail,
              spreadsheetId: connection.spreadsheetId,
              spreadsheetUrl: connection.spreadsheetUrl,
              createdAt: connection.createdAt.toISOString(),
            }
          : null,
      });
    }
  );

  // ─── POST /google/mock-connect/:companyId ────────────────────────────────────
  app.post<{ Params: CompanyIdParam; Body: MockConnectBody }>(
    "/google/mock-connect/:companyId",
    async (request: FastifyRequest<{ Params: CompanyIdParam; Body: MockConnectBody }>, reply: FastifyReply) => {
      const { companyId } = request.params;
      const { googleEmail: reqEmail, spreadsheetId: reqSheetId, spreadsheetUrl: reqSheetUrl } = request.body || {};

      const company = await prisma.company.findUnique({ where: { id: companyId } });
      if (!company) {
        return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
      }

      const mockSheet = createMockFinancialSpreadsheet(company.name);
      const spreadsheetId = reqSheetId || mockSheet.spreadsheetId;
      const spreadsheetUrl = reqSheetUrl || mockSheet.spreadsheetUrl;
      const googleEmail = reqEmail || `finance@${company.name.toLowerCase().replace(/[^a-z0-9]/g, "") || "company"}.com`;
      const encryptedRefreshToken = encrypt(`mock_refresh_${Date.now()}`);

      const connection = await prisma.googleConnection.upsert({
        where: { companyId },
        update: {
          googleEmail,
          refreshToken: encryptedRefreshToken,
          spreadsheetId,
          spreadsheetUrl,
        },
        create: {
          companyId,
          googleEmail,
          refreshToken: encryptedRefreshToken,
          spreadsheetId,
          spreadsheetUrl,
        },
      });

      // Advance linked connectors to ACTIVE
      await prisma.connector.updateMany({
        where: {
          companyId,
          setupStatus: { in: ["WAITING_FOR_GOOGLE", "WAITING_FOR_COMPANY", "REGISTERED"] },
        },
        data: {
          setupStatus: "ACTIVE",
        },
      });

      return reply.status(200).send({
        success: true,
        connection: {
          id: connection.id,
          companyId: connection.companyId,
          googleEmail: connection.googleEmail,
          spreadsheetId: connection.spreadsheetId,
          spreadsheetUrl: connection.spreadsheetUrl,
        },
      });
    }
  );

  // ─── GET /google/mock-sheet/:spreadsheetId ──────────────────────────────────
  app.get<{ Params: { spreadsheetId: string }; Querystring: { tab?: string } }>(
    "/google/mock-sheet/:spreadsheetId",
    async (request: FastifyRequest<{ Params: { spreadsheetId: string }; Querystring: { tab?: string } }>, reply: FastifyReply) => {
      const { spreadsheetId } = request.params;
      const { tab } = request.query;
      if (tab) {
        const rows = getMockGoogleSheetTab(spreadsheetId, tab);
        return reply.status(200).send({ success: true, tab, rows: rows ?? null });
      }
      return reply.status(200).send({
        success: true,
        trialBalance: getMockGoogleSheetTab(spreadsheetId, "Trial Balance") ?? null,
        ledgers: getMockGoogleSheetTab(spreadsheetId, "Ledgers") ?? null,
        transactions: getMockGoogleSheetTab(spreadsheetId, "Transactions") ?? null,
      });
    }
  );
}
