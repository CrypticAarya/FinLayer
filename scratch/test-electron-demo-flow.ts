import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// 1. Start lightweight mock Tally server on 9000
const tallyServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    if (body.includes("CurrentCompany")) {
      res.end(`
        <ENVELOPE>
          <BODY>
            <DATA>
              <COLLECTION>
                <CURRENTCOMPANY>Founder Demo Tech Pvt Ltd</CURRENTCOMPANY>
              </COLLECTION>
            </DATA>
          </BODY>
        </ENVELOPE>
      `);
    } else {
      res.end(`
        <ENVELOPE>
          <BODY>
            <DATA>
              <COLLECTION>
                <COMPANY>
                  <NAME>Founder Demo Tech Pvt Ltd</NAME>
                  <STARTINGFROM>20240401</STARTINGFROM>
                </COMPANY>
              </COLLECTION>
            </DATA>
          </BODY>
        </ENVELOPE>
      `);
    }
  });
});

tallyServer.listen(9000, "127.0.0.1", () => {
  console.log("Mock Tally server listening on 127.0.0.1:9000");

  const electronProc = spawn(
    "npx",
    ["electron", "apps/windows-app/dist/main.js"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        TEST_FLOW: "1",
        DEMO_MODE: "true",
      },
      stdio: "inherit",
    }
  );

  electronProc.on("exit", (code) => {
    console.log(`Electron process exited with code ${code}`);
    tallyServer.close(() => {
      console.log("Mock Tally server stopped");
      process.exit(code || 0);
    });
  });
});
