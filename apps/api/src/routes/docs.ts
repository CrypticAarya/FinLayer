import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { openApiSpec } from "../docs/openapi.js";

/**
 * Fastify plugin for serving OpenAPI specification and Swagger UI.
 * 
 * Invariants:
 * - Read-only documentation: `supportedSubmitMethods: []` strictly disables "Try it out"
 * - Zero secret exposure: Static OpenAPI metadata only
 * - Optional protection in production if `DOCS_AUTH_REQUIRED="true"`
 */
export async function docsRoutes(app: FastifyInstance): Promise<void> {
  // ─── 1. Raw OpenAPI Specification ───────────────────────────────────────────
  app.get("/docs/openapi.json", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600")
      .send(openApiSpec);
  });

  // Also support canonical /api/v1/openapi.json for tools and SDK generators
  app.get("/api/v1/openapi.json", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600")
      .send(openApiSpec);
  });

  // ─── 2. Interactive Read-Only Swagger UI ────────────────────────────────────
  app.get("/docs", async (request: FastifyRequest, reply: FastifyReply) => {
    // Optional production protection guard
    if (process.env.DOCS_AUTH_REQUIRED === "true") {
      const authKey = request.headers["x-docs-key"] || (request.query as any)?.key;
      const expectedKey = process.env.DOCS_API_KEY;
      if (expectedKey && authKey !== expectedKey) {
        return reply.status(401).send({
          success: false,
          error: "Unauthorized: Documentation access requires a valid x-docs-key header or ?key= query parameter.",
        });
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FinLayer SaaS API Documentation (v2.4)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .top-bar {
      background: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .top-bar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .top-bar-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #38bdf8;
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 9999px;
      background: #0ea5e9;
      color: #ffffff;
    }
    .badge-readonly {
      background: #334155;
      color: #94a3b8;
      border: 1px solid #475569;
    }
    .top-bar-links a {
      color: #94a3b8;
      text-decoration: none;
      font-size: 0.85rem;
      margin-left: 16px;
      transition: color 0.15s ease;
    }
    .top-bar-links a:hover {
      color: #38bdf8;
    }
    /* Swagger UI Theme custom styling */
    .swagger-ui {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      background: #ffffff;
      border-radius: 8px;
      margin-top: 24px;
      margin-bottom: 40px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .swagger-ui .info {
      margin: 20px 0;
    }
    .swagger-ui .info .title {
      color: #0f172a;
    }
    /* Hide interactive Try-It-Out mutate buttons in Read-Only Mode */
    .swagger-ui .try-out {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="top-bar-left">
      <span class="top-bar-title">FinLayer SaaS API</span>
      <span class="badge">v2.4.0</span>
      <span class="badge badge-readonly">Read-Only Mode</span>
    </div>
    <div class="top-bar-links">
      <a href="/docs/openapi.json" target="_blank">Raw OpenAPI JSON</a>
      <a href="https://github.com/CrypticAarya/FinLayer" target="_blank">GitHub Repository</a>
    </div>
  </div>

  <div id="swagger-ui"></div>

  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "/docs/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        // Strict Read-Only Mode: Disables test execution and mutation buttons
        supportedSubmitMethods: [],
        validatorUrl: null,
        docExpansion: 'list',
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        showExtensions: true,
        showCommonExtensions: true,
        persistAuthorization: true
      });
    };
  </script>
</body>
</html>`;

    return reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(html);
  });
}
