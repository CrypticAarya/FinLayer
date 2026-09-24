import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import rateLimit, { type RateLimitOptions } from "@fastify/rate-limit";
import { syncRoutes } from "./routes/sync.js";
import { connectorRoutes } from "./routes/connectors.js";
import { jobRoutes } from "./routes/jobs.js";
import { v1Routes } from "./routes/v1/index.js";
import { saasApiRoutes } from "./routes/saas-api.js";
import { docsRoutes } from "./routes/docs.js";
import { healthRoutes } from "./routes/health.js";
import crypto from "node:crypto";

export const SENSITIVE_LOG_REDACT_PATHS = [
  "pairingCode",
  "token",
  "apiKey",
  "refreshToken",
  "accessToken",
  "req.headers.authorization",
  "req.headers['x-api-key']",
  "*.pairingCode",
  "*.token",
  "*.apiKey",
  "keyHash",
  "*.keyHash",
];

export interface BuildAppOptions extends FastifyServerOptions {
  rateLimitOptions?: Partial<RateLimitOptions>;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { rateLimitOptions, ...serverOptions } = opts;

  // Enforce zero-leakage redaction on Fastify logger if logging is enabled
  if (serverOptions.logger === true) {
    serverOptions.logger = {
      redact: SENSITIVE_LOG_REDACT_PATHS,
    };
  } else if (typeof serverOptions.logger === "object" && serverOptions.logger !== null) {
    const loggerObj = serverOptions.logger as Record<string, any>;
    if (Array.isArray(loggerObj.redact)) {
      loggerObj.redact = Array.from(new Set([...loggerObj.redact, ...SENSITIVE_LOG_REDACT_PATHS]));
    } else if (!loggerObj.redact) {
      loggerObj.redact = SENSITIVE_LOG_REDACT_PATHS;
    }
  }

  const app = Fastify(serverOptions);

  await app.register(rateLimit, {
    max: process.env.NODE_ENV === "test" ? 10000 : 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      // 1. SaaS API Key (Bearer fl_live_... or x-api-key)
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
        const token = authHeader.slice(7).trim();
        if (token.startsWith("fl_live_")) {
          return `saas:${crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
        }
      }
      const xApiKey = req.headers["x-api-key"];
      if (typeof xApiKey === "string" && xApiKey.trim().startsWith("fl_live_")) {
        return `saas:${crypto.createHash("sha256").update(xApiKey.trim()).digest("hex").slice(0, 16)}`;
      }
      // 2. Hardware connector token
      if (authHeader && authHeader.toLowerCase().startsWith("bearer ct_")) {
        const token = authHeader.slice(7).trim();
        return `connector:${crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
      }
      // 3. Fallback to client IP
      return req.ip;
    },
    errorResponseBuilder: (_req, context) => ({
      success: false,
      statusCode: 429,
      error: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      code: "RATE_LIMIT_EXCEEDED",
    }),
    ...rateLimitOptions,
  });

  // ─── Standardized Global Error Handler ──────────────────────────────────────
  app.setErrorHandler((error: any, _request, reply) => {
    const statusCode = error?.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

    const isProd = process.env.NODE_ENV === "production";
    const errorMessage = statusCode === 500 && isProd
      ? "Internal server error occurred."
      : error?.message || "An unexpected error occurred.";

    return reply.status(statusCode).send({
      success: false,
      statusCode,
      error: errorMessage,
      message: errorMessage,
      code: error?.code || (statusCode === 429 ? "RATE_LIMIT_EXCEEDED" : statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "API_ERROR"),
    });
  });

  // ─── Standardized Global 404 Handler ────────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      statusCode: 404,
      error: `Route ${request.method}:${request.url} not found.`,
      message: `Route ${request.method}:${request.url} not found.`,
      code: "NOT_FOUND",
    });
  });

  await app.register(healthRoutes);
  await app.register(syncRoutes);
  await app.register(connectorRoutes);
  await app.register(jobRoutes);
  await app.register(v1Routes, { prefix: "/v1" });
  await app.register(saasApiRoutes, { prefix: "/api/v1" });
  await app.register(docsRoutes);

  return app;
}
