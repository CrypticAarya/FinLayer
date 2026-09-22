import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConnectivityService } from "./services/connectivity-service.js";
import { loadFinLayerConfig, maskApiKey } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const PORT = Number(process.env.PROFITNITI_PORT || 5050);
const service = new ConnectivityService();
const config = loadFinLayerConfig();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── GET /api/config ────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        apiUrl: config.apiUrl,
        companyId: config.companyId,
        maskedApiKey: maskApiKey(config.apiKey),
      })
    );
    return;
  }

  // ── POST /api/test-connection ──────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/test-connection") {
    try {
      const result = await service.testConnection();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err?.message || "Internal error" }));
    }
    return;
  }

  // ── POST /api/sync ─────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/sync") {
    try {
      const result = await service.runFullConnectivitySync();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: err?.message || "Internal error" }));
    }
    return;
  }

  // ── GET / (Static HTML UI) ─────────────────────────────────────────────────
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const filePath = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`\n===================================================================`);
  console.log(`   PROFITNITI SAAS INTEGRATION BACKEND (POC)                       `);
  console.log(`===================================================================`);
  console.log(`  Portal URL:      http://localhost:${PORT}`);
  console.log(`  FinLayer URL:    ${config.apiUrl}`);
  console.log(`  Company ID:      ${config.companyId || "[NOT SET]"}`);
  console.log(`  API Key:         ${maskApiKey(config.apiKey)}`);
  console.log(`===================================================================\n`);
});
