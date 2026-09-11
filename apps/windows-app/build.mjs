import * as esbuild from "esbuild";

try {
  await esbuild.build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    external: ["electron"],
    outfile: "dist/main.js",
    format: "cjs",
    sourcemap: true,
    define: {
      "import.meta.url": "import_meta_url",
    },
    banner: {
      js: 'const import_meta_url = require("url").pathToFileURL(__filename).href;',
    },
  });

  await esbuild.build({
    entryPoints: ["src/preload.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    external: ["electron"],
    outfile: "dist/preload.js",
    format: "cjs",
    sourcemap: true,
  });

  console.log("✓ Windows Electron app bundles compiled successfully to dist/");
} catch (err) {
  console.error("❌ Build error:", err);
  process.exit(1);
}
