import type { FastifyReply, FastifyRequest } from "fastify";
import type { SaasApplication } from "@prisma/client";
import prisma from "../db/prisma.js";

declare module "fastify" {
  interface FastifyRequest {
    saasApplication: SaasApplication;
  }
}

export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({
      success: false,
      error: "Missing Authorization header. Expected 'Bearer <apiKey>'.",
    });
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return reply.status(401).send({
      success: false,
      error: "Invalid Authorization header format. Expected 'Bearer <apiKey>'.",
    });
  }

  const apiKey = parts[1].trim();
  if (!apiKey) {
    return reply.status(401).send({
      success: false,
      error: "API key is required.",
    });
  }

  // Look up SaasApplication by apiKey without logging the raw key
  const saasApp = await prisma.saasApplication.findUnique({
    where: { apiKey },
  });

  if (!saasApp || saasApp.status !== "ACTIVE") {
    return reply.status(401).send({
      success: false,
      error: "Invalid or inactive API key.",
    });
  }

  request.saasApplication = saasApp;
}
