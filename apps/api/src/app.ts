import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import rateLimit, { type RateLimitOptions } from "@fastify/rate-limit";
import { syncRoutes } from "./routes/sync.js";
import { connectorRoutes } from "./routes/connectors.js";
import { jobRoutes } from "./routes/jobs.js";
import { v1Routes } from "./routes/v1/index.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { googleRoutes } from "./routes/google.js";
import { exportRoutes } from "./routes/export.js";

export const SENSITIVE_LOG_REDACT_PATHS = [
  "pairingCode",
  "token",
  "apiKey",
  "userSessionToken",
  "sessionToken",
  "refreshToken",
  "accessToken",
  "req.headers.authorization",
  "req.headers['x-user-token']",
  "req.headers['x-admin-key']",
  "req.headers['x-api-key']",
  "*.pairingCode",
  "*.token",
  "*.apiKey",
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
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
    ...rateLimitOptions,
  });

  await app.register(syncRoutes);
  await app.register(connectorRoutes);
  await app.register(jobRoutes);
  await app.register(v1Routes, { prefix: "/v1" });
  await app.register(dashboardRoutes);
  await app.register(googleRoutes);
  await app.register(exportRoutes);

  return app;
}
