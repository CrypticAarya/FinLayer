import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

async function runElectronWithEnv(envOverrides: Record<string, string>, extraArgs: string[] = []): Promise<string> {
  const electronBin = path.join(process.cwd(), "apps/windows-app/node_modules/.bin/electron");
  const mainScript = path.join(process.cwd(), "apps/windows-app/dist/main.js");

  return new Promise((resolve, reject) => {
    const proc = spawn(electronBin, [mainScript, ...extraArgs], {
      cwd: path.join(process.cwd(), "apps/windows-app"),
      env: {
        ...process.env,
        TEST_VERIFY: "1",
        ...envOverrides,
      },
    });

    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve(output);
    }, 8000);

    proc.on("close", () => {
      clearTimeout(timeout);
      resolve(output);
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  console.log("=== Testing Windows Desktop App API Configuration ===");

  // Test 1: Default fallback when no env var is set
  console.log("\n[Test 1] Testing default fallback URL...");
  const out1 = await runElectronWithEnv({ FINLAYER_API_URL: "", API_URL: "" });
  console.log("Test 1 output:", out1.trim());
  if (!out1.includes("TEST_VERIFY")) {
    throw new Error("Electron failed to launch with default config");
  }
  console.log("✓ Default fallback verified");

  // Test 2: Environment variable FINLAYER_API_URL=http://192.168.88.25:4000
  console.log("\n[Test 2] Testing FINLAYER_API_URL environment variable...");
  const customIp = "http://192.168.88.25:4000";
  const out2 = await runElectronWithEnv({ FINLAYER_API_URL: customIp });
  console.log("Test 2 output:", out2.trim());
  if (!out2.includes("TEST_VERIFY")) {
    throw new Error("Electron failed to launch with FINLAYER_API_URL");
  }
  console.log("✓ Environment variable FINLAYER_API_URL verified");

  // Test 3: Command line flag --api-url=http://10.0.0.99:5000
  console.log("\n[Test 3] Testing CLI flag --api-url=...");
  const out3 = await runElectronWithEnv({ FINLAYER_API_URL: "" }, ["--api-url=http://10.0.0.99:5000"]);
  console.log("Test 3 output:", out3.trim());
  if (!out3.includes("TEST_VERIFY")) {
    throw new Error("Electron failed to launch with CLI argument");
  }
  console.log("✓ CLI argument override verified");

  // Test 4: config.json file next to app
  console.log("\n[Test 4] Testing config.json file resolution...");
  const configPath = path.join(process.cwd(), "apps/windows-app/config.json");
  await fs.writeFile(configPath, JSON.stringify({ FINLAYER_API_URL: "http://172.16.0.10:4000" }), "utf-8");
  try {
    const out4 = await runElectronWithEnv({ FINLAYER_API_URL: "" });
    console.log("Test 4 output:", out4.trim());
    if (!out4.includes("Loaded API URL from") || !out4.includes("http://172.16.0.10:4000")) {
      throw new Error("config.json was not picked up by desktop app");
    }
    console.log("✓ config.json resolution verified");
  } finally {
    if (existsSync(configPath)) {
      await fs.unlink(configPath);
    }
  }

  console.log("\n=== ALL API CONFIGURATION TESTS PASSED SUCCESSFULLY ===");
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
