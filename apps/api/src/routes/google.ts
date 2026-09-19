import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";
import { encrypt } from "../utils/crypto.js";
import {
  isGoogleOAuthConfigured,
  isDemoMode,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  createFinancialSpreadsheet,
  createMockFinancialSpreadsheet,
} from "../services/google-sheets-service.js";
import {
  syncCompanyFinancialDataToGoogleSheets,
  getMockGoogleSheetTab,
} from "../services/google-sheet-sync-service.js";
import { authenticateUserOrConnector, requireTenantCompanyAccess } from "../auth/tenant-auth.js";

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
    { preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()] },
    async (request: FastifyRequest<{ Params: CompanyIdParam }>, reply: FastifyReply) => {
      const { companyId } = request.params;

      let company = await prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        // Fallback: Check if companyId is tallyCompanyName or name
        company = await prisma.company.findFirst({
          where: {
            OR: [
              { tallyCompanyName: companyId },
              { name: companyId },
            ],
          },
        });
      }

      if (!company) {
        return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
      }

      console.log(`[GOOGLE] OAuth started for companyId: ${company.id} (${company.name})`);
      request.log.info({ companyId: company.id, companyName: company.name }, "[GOOGLE] OAuth started");

      const host = request.headers.host;
      const protocol = request.protocol || "http";
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || (host ? `${protocol}://${host}/google/callback` : undefined);

      if (!isDemoMode() && isGoogleOAuthConfigured()) {
        const authUrl = getGoogleAuthUrl(company.id, redirectUri);
        return reply.redirect(authUrl);
      }

      if (process.env.NODE_ENV === "production") {
        return reply.status(500).send({
          success: false,
          error: "Google OAuth is not configured for production.",
        });
      }

      // When DEMO_MODE=true or OAuth is not configured: bypass OAuth and use demo Google Sheet connector
      console.log(`[GOOGLE] DEMO_MODE active: Bypassing Google OAuth, auto-connecting demo Google Sheet for "${company.name}"`);
      return reply.redirect(`/google/callback?state=${company.id}&mock=true`);
    }
  );

  // ─── GET /google/callback ───────────────────────────────────────────────────
  app.get<{ Querystring: CallbackQuery }>(
    "/google/callback",
    async (request: FastifyRequest<{ Querystring: CallbackQuery }>, reply: FastifyReply) => {
      const { code, state: companyId, mock, error } = request.query;

      console.log(`[GOOGLE] Redirect received - state: ${companyId || "none"}, code: ${code ? "present" : "none"}, mock: ${Boolean(mock)}, error: ${error || "none"}`);
      request.log.info({ companyId, hasCode: Boolean(code), mock, error }, "[GOOGLE] Redirect received");

      if (error) {
        return reply.redirect(`/setup/google?companyId=${companyId || ""}&error=${encodeURIComponent(error)}`);
      }

      if (!companyId) {
        return reply.status(400).send({ success: false, error: "Missing state (companyId) in callback." });
      }

      if (mock && process.env.NODE_ENV === "production") {
        return reply.status(403).send({ success: false, error: "Mock OAuth callbacks are disabled in production." });
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

        const host = request.headers.host;
        const protocol = request.protocol || "http";
        const redirectUri = process.env.GOOGLE_REDIRECT_URI || (host ? `${protocol}://${host}/google/callback` : undefined);

        if (code && !mock) {
          // Live Google OAuth flow
          const tokens = await exchangeCodeForTokens(code, redirectUri);
          googleEmail = tokens.email;
          rawRefreshToken = tokens.refreshToken || "access_token_holder";

          console.log(`[GOOGLE] Token received - email: ${googleEmail}`);
          request.log.info({ googleEmail }, "[GOOGLE] Token received");

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

          console.log(`[GOOGLE] Token received (demo/mock) - email: ${googleEmail}`);
          request.log.info({ googleEmail }, "[GOOGLE] Token received");
        }

        const existingConn = await prisma.googleConnection.findUnique({
          where: { companyId },
        });
        const refreshTokenToSave = (rawRefreshToken === "access_token_holder" && existingConn?.refreshToken)
          ? existingConn.refreshToken
          : encrypt(rawRefreshToken);

        // 1. Save or update Google connection
        await prisma.googleConnection.upsert({
          where: { companyId },
          update: {
            googleEmail,
            refreshToken: refreshTokenToSave,
            spreadsheetId,
            spreadsheetUrl,
          },
          create: {
            companyId,
            googleEmail,
            refreshToken: refreshTokenToSave,
            spreadsheetId,
            spreadsheetUrl,
          },
        });

        console.log(`[GOOGLE] Token stored for company: ${companyId} (${company.name})`);
        request.log.info({ companyId, googleEmail }, "[GOOGLE] Token stored");

        console.log(`[GOOGLE] Sheet connection created: ${spreadsheetId} (${spreadsheetUrl})`);
        request.log.info({ companyId, spreadsheetId, spreadsheetUrl }, "[GOOGLE] Sheet connection created");

        // 2. Advance linked connectors to ACTIVE
        const linkedConnectors = await prisma.connector.findMany({
          where: { companyId },
        });

        await prisma.connector.updateMany({
          where: {
            companyId,
            setupStatus: { in: ["WAITING_FOR_GOOGLE", "WAITING_FOR_COMPANY", "REGISTERED"] },
          },
          data: {
            setupStatus: "ACTIVE",
          },
        });

        // 3. Queue an immediate FINANCIAL_DATA sync job for each linked connector
        for (const conn of linkedConnectors) {
          await prisma.syncJob.create({
            data: {
              connectorId: conn.id,
              type: "FINANCIAL_DATA",
              status: "PENDING",
            },
          });
          request.log.info({ connectorId: conn.id, companyId }, "Queued initial FINANCIAL_DATA sync job for connector");
        }

        // 4. Immediately push any existing financial data (Trial Balance, Ledgers, Transactions) to the sheet
        try {
          await syncCompanyFinancialDataToGoogleSheets(companyId);
        } catch (syncErr) {
          request.log.warn({ syncErr }, "Initial sheet population warning");
        }

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
    { preHandler: [authenticateUserOrConnector, requireTenantCompanyAccess()] },
    async (request: FastifyRequest<{ Params: CompanyIdParam }>, reply: FastifyReply) => {
      const { companyId } = request.params;

      let company = await prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        company = await prisma.company.findFirst({
          where: {
            OR: [
              { tallyCompanyName: companyId },
              { name: companyId },
            ],
          },
        });
      }

      const effectiveCompanyId = company ? company.id : companyId;

      const connection = await prisma.googleConnection.findUnique({
        where: { companyId: effectiveCompanyId },
      });

      const isConnected = Boolean(connection);

      return reply.status(200).send({
        connected: isConnected,
        companyId: effectiveCompanyId,
        email: connection ? connection.googleEmail : null,
        success: true,
        demoMode: isDemoMode(),
        oauthConfigured: isGoogleOAuthConfigured(),
        spreadsheetId: connection?.spreadsheetId || null,
        spreadsheetUrl: connection?.spreadsheetUrl || null,
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

  // ─── POST /google/demo-connect/:companyId & /google/mock-connect/:companyId ──
  const handleDemoConnect = async (request: FastifyRequest<{ Params: CompanyIdParam; Body: MockConnectBody }>, reply: FastifyReply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.status(403).send({
        success: false,
        error: "Forbidden: Demo and mock routes are disabled in production.",
      });
    }

    const { companyId } = request.params;
    const { googleEmail: reqEmail, spreadsheetId: reqSheetId, spreadsheetUrl: reqSheetUrl } = request.body || {};

    let company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      company = await prisma.company.findFirst({
        where: {
          OR: [
            { tallyCompanyName: companyId },
            { name: companyId },
          ],
        },
      });
    }

    if (!company) {
      return reply.status(404).send({ success: false, error: `Company "${companyId}" not found.` });
    }

    console.log(`[GOOGLE] DEMO_MODE active: Connecting demo sheet for company "${company.name}" (${company.id})`);

    const mockSheet = createMockFinancialSpreadsheet(company.name);
    const spreadsheetId = reqSheetId || mockSheet.spreadsheetId;
    const spreadsheetUrl = reqSheetUrl || mockSheet.spreadsheetUrl;
    const googleEmail = reqEmail || `demo.finance@${company.name.toLowerCase().replace(/[^a-z0-9]/g, "") || "company"}.com`;
    const encryptedRefreshToken = encrypt(`demo_refresh_${Date.now()}`);

    console.log(`[GOOGLE] Token received (demo sheet) - email: ${googleEmail}`);

    const connection = await prisma.googleConnection.upsert({
      where: { companyId: company.id },
      update: {
        googleEmail,
        refreshToken: encryptedRefreshToken,
        spreadsheetId,
        spreadsheetUrl,
      },
      create: {
        companyId: company.id,
        googleEmail,
        refreshToken: encryptedRefreshToken,
        spreadsheetId,
        spreadsheetUrl,
      },
    });

    console.log(`[GOOGLE] Token stored for company: ${company.id} (${company.name})`);
    console.log(`[GOOGLE] Sheet connection created: ${spreadsheetId} (${spreadsheetUrl})`);

    // Advance linked connectors to ACTIVE
    const linkedConnectors = await prisma.connector.findMany({
      where: { companyId: company.id },
    });

    await prisma.connector.updateMany({
      where: {
        companyId: company.id,
        setupStatus: { in: ["WAITING_FOR_GOOGLE", "WAITING_FOR_COMPANY", "REGISTERED"] },
      },
      data: {
        setupStatus: "ACTIVE",
      },
    });

    // Queue an immediate FINANCIAL_DATA sync job for each linked connector
    for (const conn of linkedConnectors) {
      await prisma.syncJob.create({
        data: {
          connectorId: conn.id,
          type: "FINANCIAL_DATA",
          status: "PENDING",
        },
      });
      request.log.info({ connectorId: conn.id, companyId: company.id }, "Queued initial FINANCIAL_DATA sync job for connector");
    }

    // Push initial financial data to sheet
    try {
      await syncCompanyFinancialDataToGoogleSheets(company.id);
    } catch (syncErr) {
      request.log.warn({ syncErr }, "Initial sheet population warning");
    }

    return reply.status(200).send({
      connected: true,
      companyId: company.id,
      email: connection.googleEmail,
      spreadsheetId: connection.spreadsheetId,
      spreadsheetUrl: connection.spreadsheetUrl,
      demoMode: true,
      success: true,
      connection: {
        id: connection.id,
        companyId: connection.companyId,
        googleEmail: connection.googleEmail,
        spreadsheetId: connection.spreadsheetId,
        spreadsheetUrl: connection.spreadsheetUrl,
      },
    });
  };

  app.post<{ Params: CompanyIdParam; Body: MockConnectBody }>("/google/demo-connect/:companyId", handleDemoConnect);
  app.post<{ Params: CompanyIdParam; Body: MockConnectBody }>("/google/mock-connect/:companyId", handleDemoConnect);

  // ─── GET /google/mock-sheet/:spreadsheetId ──────────────────────────────────
  app.get<{ Params: { spreadsheetId: string }; Querystring: { tab?: string } }>(
    "/google/mock-sheet/:spreadsheetId",
    async (request: FastifyRequest<{ Params: { spreadsheetId: string }; Querystring: { tab?: string } }>, reply: FastifyReply) => {
      if (process.env.NODE_ENV === "production") {
        return reply.status(403).send({
          success: false,
          error: "Forbidden: Mock sheet routes are disabled in production.",
        });
      }

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
