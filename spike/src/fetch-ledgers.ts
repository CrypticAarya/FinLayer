import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TALLY_URL = process.env.TALLY_URL ?? "http://127.0.0.1:9000/";

const REQUEST_XML = `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>EXPORT</TALLYREQUEST>
<TYPE>COLLECTION</TYPE>
<ID>List of Ledgers</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>`;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, "..", "samples", "local", "ledgers.xml");

async function main() {
  let response: Response;

  try {
    response = await fetch(TALLY_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: REQUEST_XML,
    });
  } catch (error) {
    console.error("ERROR: Could not reach Tally at", TALLY_URL);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log("HTTP Status:", response.status);

  const body = await response.text();
  console.log("Response Body:");
  console.log(body);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body, "utf-8");
  console.log("Saved raw response to:", outputPath);
}

main();
