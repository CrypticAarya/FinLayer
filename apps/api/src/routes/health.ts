import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import prisma from "../db/prisma.js";

const API_VERSION = "2.4.0";

/**
 * Health check endpoint for infrastructure, load balancers, and monitoring.
 * 
 * Verifies:
 * - API runtime status
 * - Version metadata
 * - Live PostgreSQL database connectivity
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const checkHealth = async (_request: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    try {
      // Execute lightweight raw query against PostgreSQL pool
      await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;

      return reply.status(200).send({
        status: "healthy",
        version: API_VERSION,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        database: {
          status: "connected",
          latencyMs,
        },
      });
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return reply.status(503).send({
        status: "unhealthy",
        version: API_VERSION,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        database: {
          status: "disconnected",
          latencyMs,
          error: process.env.NODE_ENV === "production" ? "Database ping failed" : err.message,
        },
      });
    }
  };

  app.get("/health", checkHealth);
  app.get("/api/v1/health", checkHealth);
}
