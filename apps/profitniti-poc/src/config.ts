import fs from "node:fs";
import path from "node:path";

// Zero-dependency .env loader
try {
  const envPaths = [".env", path.resolve(process.cwd(), ".env")];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const k = trimmed.slice(0, eqIdx).trim();
          let v = trimmed.slice(eqIdx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (process.env[k] === undefined) {
            process.env[k] = v;
          }
        }
      }
      break;
    }
  }
} catch {
  // fallback to environment variables
}

export interface FinLayerConfig {
  apiUrl: string;
  apiKey: string;
  companyId: string;
  timeoutMs: number;
}

/**
 * Masks an API key for safe logging and display.
 * Returns e.g. "fl_live_••••••••••••3a7b" or "[NOT_SET]".
 */
export function maskApiKey(key?: string): string {
  if (!key) return "[NOT_CONFIGURED]";
  if (key.length <= 12) return "••••••••••••";
  const prefix = key.slice(0, 8);
  const suffix = key.slice(-4);
  return `${prefix}${"•".repeat(Math.max(key.length - 12, 8))}${suffix}`;
}

/**
 * Loads and validates FinLayer API configuration from environment.
 * Ensures API key is present and strictly sanitizes trailing slashes.
 */
export function loadFinLayerConfig(): FinLayerConfig {
  const apiUrl = (process.env.FINLAYER_API_URL || "http://localhost:4000/api/v1").replace(/\/+$/, "");
  const apiKey = (process.env.FINLAYER_API_KEY || "").trim();
  const companyId = (process.env.FINLAYER_COMPANY_ID || "").trim();
  const timeoutMs = Number.parseInt(process.env.FINLAYER_TIMEOUT_MS || "10000", 10);

  return {
    apiUrl,
    apiKey,
    companyId,
    timeoutMs: Number.isNaN(timeoutMs) ? 10000 : timeoutMs,
  };
}

/**
 * Validates configuration readiness.
 */
export function validateConfig(config: FinLayerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.apiUrl) {
    errors.push("FINLAYER_API_URL is required (e.g. http://localhost:4000/api/v1)");
  }
  if (!config.apiKey) {
    errors.push("FINLAYER_API_KEY is required (expected 'fl_live_...')");
  }
  if (!config.companyId) {
    errors.push("FINLAYER_COMPANY_ID is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
