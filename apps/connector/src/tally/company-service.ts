import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface TallyCompany {
  name: string;
  isActive?: boolean;
}

export interface ParsedCompanyResponse {
  companies: TallyCompany[];
  activeCompanyName: string | null;
}

/**
 * Logs Tally XML requests and responses to:
 * 1. Console
 * 2. Application Logger
 * 3. Persistent disk file: %APPDATA%/FinLayer/logs/tally-communication.log
 */
export function logTallyCommunication(
  direction: "REQUEST" | "RESPONSE",
  strategy: string,
  url: string,
  payload: string
): void {
  const timestamp = new Date().toISOString();
  const separator = "─".repeat(60);
  const logEntry = `\n${separator}\n[${timestamp}] [TALLY ${direction}] [${strategy}] [${url}]\n${payload}\n${separator}\n`;

  // Console output
  console.log(`[Tally ${direction}] [${strategy}] (${url}):\n${payload}`);

  // Connector logger
  logger.info(`[Tally ${direction}] ${strategy} (${url}): ${payload.slice(0, 300)}...`);

  // Persistent disk file
  try {
    const baseDir = process.env.APPDATA
      ? path.join(process.env.APPDATA, "FinLayer", "logs")
      : path.join(process.cwd(), "logs");
    mkdirSync(baseDir, { recursive: true });
    appendFileSync(path.join(baseDir, "tally-communication.log"), logEntry, "utf-8");
  } catch {}
}

/**
 * 1. ##SVCURRENTCOMPANY dynamic TDL export (CurrentCompanyObj)
 */
export function getCurrentCompanyRequest(): string {
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>CurrentCompanyCollection</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<OBJECT NAME="CurrentCompanyObj">
<LOCALFORMULA>Name:##SVCURRENTCOMPANY</LOCALFORMULA>
</OBJECT>
<COLLECTION NAME="CurrentCompanyCollection">
<OBJECTS>CurrentCompanyObj</OBJECTS>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>`;
}

/**
 * 1b. ##SVCURRENTCOMPANY dynamic TDL export (CurCompCol with CurrentCompany field)
 */
export function getCurrentCompanyCurCompColRequest(): string {
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>CurCompCol</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="CurCompCol">
<OBJECTS>CurCompObj</OBJECTS>
</COLLECTION>
<OBJECT NAME="CurCompObj">
<LOCALFORMULA>CurrentCompany:##SVCURRENTCOMPANY</LOCALFORMULA>
<LOCALFORMULA>Name:##SVCURRENTCOMPANY</LOCALFORMULA>
</OBJECT>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>`;
}

/**
 * 2. Standard collection "List of Companies" with <FETCH>Name</FETCH>
 */
export function getCompaniesRequest(): string {
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>List of Companies</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="List of Companies">
<TYPE>Company</TYPE>
<FETCH>Name</FETCH>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>`;
}

/**
 * 3. Standard collection "List of Companies" without custom TDL modification
 */
export function getStandardListOfCompaniesRequest(): string {
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>List of Companies</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>`;
}

/**
 * 4. Standard collection "ListOfCompanies" (no spaces)
 */
export function getListOfCompaniesNoSpacesRequest(): string {
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>ListOfCompanies</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>`;
}

/**
 * 5. Standard collection "Company"
 */
export function getCompanyCollectionRequest(): string {
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>Company</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>`;
}

/**
 * 6. Function export for $$CurrentCompany
 */
export function getCurrentCompanyFunctionRequest(): string {
  return `<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Function</TYPE>
<ID>$$CurrentCompany</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>`;
}

// Backwards compatibility alias
export const getSimpleListOfCompaniesRequest = getStandardListOfCompaniesRequest;

const BLACKLIST_NAMES = new Set([
  "currentcompanyobj",
  "curcompobj",
  "currentcompany",
  "svcurrentcompany",
  "$$currentcompany",
  "list of companies",
  "listofcompanies",
  "company",
  "$$sysname:xml",
  "(none)",
  "none",
  "no companies loaded",
  "no company loaded",
  "finlayer",
  "finlayer connector",
  "",
]);

export function cleanCompanyName(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#38;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function isValidCompanyName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  return !BLACKLIST_NAMES.has(name.trim().toLowerCase());
}

/**
 * Parses Tally XML response to extract all companies and determine the active company.
 * Supports:
 * - <CURRENTCOMPANYOBJ ...> and <CURCOMPOBJ ...>
 * - <CURRENTCOMPANY> and <SVCURRENTCOMPANY>
 * - <COMPANY ...> and self-closing <COMPANY ... />
 * - <NAME> and <NAME TYPE="String">
 * - <DSPDISPNAME>
 * - Filters out application names ("Finlayer") and system placeholders.
 */
export function parseTallyCompanyResponse(xml: string): ParsedCompanyResponse {
  const companies: TallyCompany[] = [];
  const seen = new Set<string>();

  const addCompany = (company: TallyCompany) => {
    const key = company.name.toLowerCase();
    if (!seen.has(key) && isValidCompanyName(company.name)) {
      seen.add(key);
      companies.push(company);
    } else if (seen.has(key) && company.isActive) {
      const existing = companies.find((c) => c.name.toLowerCase() === key);
      if (existing) existing.isActive = true;
    }
  };

  // 1. Check for explicit <CURRENTCOMPANY> or <SVCURRENTCOMPANY> tag
  let explicitCurrentCompany: string | null = null;

  const currentCompMatch = /<CURRENTCOMPANY\b[^>]*>([^<]+)<\/CURRENTCOMPANY>/i.exec(xml);
  if (currentCompMatch && currentCompMatch[1]) {
    const cleaned = cleanCompanyName(currentCompMatch[1]);
    if (isValidCompanyName(cleaned)) {
      explicitCurrentCompany = cleaned;
    }
  }

  if (!explicitCurrentCompany) {
    const svCompMatch = /<SVCURRENTCOMPANY\b[^>]*>([^<]+)<\/SVCURRENTCOMPANY>/i.exec(xml);
    if (svCompMatch && svCompMatch[1]) {
      const cleaned = cleanCompanyName(svCompMatch[1]);
      if (isValidCompanyName(cleaned)) {
        explicitCurrentCompany = cleaned;
      }
    }
  }

  // 1b. Check <CURRENTCOMPANYOBJ> or <CURCOMPOBJ> blocks & attributes
  const currentObjRegex = /<(?:CURRENTCOMPANYOBJ|CURCOMPOBJ)\b([^>]*)>([\s\S]*?)<\/(?:CURRENTCOMPANYOBJ|CURCOMPOBJ)>/gi;
  let match: RegExpExecArray | null;
  while ((match = currentObjRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";

    let name: string | null = null;

    // Check inner <CURRENTCOMPANY>
    const innerCurrent = /<CURRENTCOMPANY\b[^>]*>([^<]+)<\/CURRENTCOMPANY>/i.exec(inner);
    if (innerCurrent && innerCurrent[1]) {
      name = cleanCompanyName(innerCurrent[1]);
    }

    // Check inner <NAME>
    if (!name) {
      const nameMatch = /<NAME\b[^>]*>([^<]+)<\/NAME>/i.exec(inner);
      if (nameMatch && nameMatch[1]) {
        name = cleanCompanyName(nameMatch[1]);
      }
    }

    // Check NAME="..." attribute
    if (!name) {
      const attrMatch = /NAME="([^"]+)"/i.exec(attrs);
      if (attrMatch && attrMatch[1]) {
        name = cleanCompanyName(attrMatch[1]);
      }
    }

    // Direct inner text fallback
    if (!name) {
      const directVal = inner.replace(/<[^>]+>/g, "").trim();
      name = cleanCompanyName(directVal);
    }

    if (name && isValidCompanyName(name)) {
      explicitCurrentCompany = explicitCurrentCompany || name;
      addCompany({ name, isActive: true });
    }
  }

  // Self-closing <CURRENTCOMPANYOBJ NAME="..." /> or <CURCOMPOBJ NAME="..." />
  const selfClosingObjRegex = /<(?:CURRENTCOMPANYOBJ|CURCOMPOBJ)\b[^>]*NAME="([^"]+)"[^>]*\/>/gi;
  while ((match = selfClosingObjRegex.exec(xml)) !== null) {
    const name = cleanCompanyName(match[1]);
    if (name && isValidCompanyName(name)) {
      explicitCurrentCompany = explicitCurrentCompany || name;
      addCompany({ name, isActive: true });
    }
  }

  // 2. Check for <COMPANY ...> ... </COMPANY> blocks
  const companyBlockRegex = /<COMPANY\b([^>]*)>([\s\S]*?)<\/COMPANY>/gi;
  while ((match = companyBlockRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";

    let name: string | null = null;
    const nameTagMatch = /<NAME\b[^>]*>([^<]+)<\/NAME>/i.exec(inner);
    if (nameTagMatch && nameTagMatch[1]) {
      name = cleanCompanyName(nameTagMatch[1]);
    }

    if (!name) {
      const dspMatch = /<DSPDISPNAME\b[^>]*>([^<]+)<\/DSPDISPNAME>/i.exec(inner);
      if (dspMatch && dspMatch[1]) {
        name = cleanCompanyName(dspMatch[1]);
      }
    }

    if (!name) {
      const nameAttrMatch = /NAME="([^"]+)"/i.exec(attrs);
      if (nameAttrMatch && nameAttrMatch[1]) {
        name = cleanCompanyName(nameAttrMatch[1]);
      }
    }

    let isActive = false;
    const activeMatch = /<ISACTIVE\b[^>]*>([^<]+)<\/ISACTIVE>/i.exec(inner);
    if (activeMatch && activeMatch[1]) {
      isActive = /^(?:yes|true|1)$/i.test(activeMatch[1].trim());
    } else {
      const activeAttr = /ISACTIVE="([^"]+)"/i.exec(attrs);
      if (activeAttr && activeAttr[1]) {
        isActive = /^(?:yes|true|1)$/i.test(activeAttr[1].trim());
      }
    }

    if (name && isValidCompanyName(name)) {
      addCompany({ name, isActive });
    }
  }

  // 3. Check for self-closing <COMPANY NAME="..." ... />
  const selfClosingRegex = /<COMPANY\b([^>]*)\/>/gi;
  while ((match = selfClosingRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const nameAttrMatch = /NAME="([^"]+)"/i.exec(attrs);
    if (nameAttrMatch && nameAttrMatch[1]) {
      const name = cleanCompanyName(nameAttrMatch[1]);
      if (name && isValidCompanyName(name)) {
        const activeAttr = /ISACTIVE="([^"]+)"/i.exec(attrs);
        const isActive = activeAttr ? /^(?:yes|true|1)$/i.test(activeAttr[1].trim()) : false;
        addCompany({ name, isActive });
      }
    }
  }

  // 4. Check for <LISTOFCOMPANIES ...> ... </LISTOFCOMPANIES>
  const listCompRegex = /<LISTOFCOMPANIES\b([^>]*)>([\s\S]*?)<\/LISTOFCOMPANIES>/gi;
  while ((match = listCompRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";

    let name: string | null = null;
    const nameTagMatch = /<NAME\b[^>]*>([^<]+)<\/NAME>/i.exec(inner);
    if (nameTagMatch && nameTagMatch[1]) {
      name = cleanCompanyName(nameTagMatch[1]);
    }

    if (!name) {
      const dspMatch = /<DSPDISPNAME\b[^>]*>([^<]+)<\/DSPDISPNAME>/i.exec(inner);
      if (dspMatch && dspMatch[1]) {
        name = cleanCompanyName(dspMatch[1]);
      }
    }

    if (!name) {
      const nameAttrMatch = /NAME="([^"]+)"/i.exec(attrs);
      if (nameAttrMatch && nameAttrMatch[1]) {
        name = cleanCompanyName(nameAttrMatch[1]);
      }
    }

    let isActive = false;
    const activeMatch = /<ISACTIVE\b[^>]*>([^<]+)<\/ISACTIVE>/i.exec(inner);
    if (activeMatch && activeMatch[1]) {
      isActive = /^(?:yes|true|1)$/i.test(activeMatch[1].trim());
    }

    if (name && isValidCompanyName(name)) {
      addCompany({ name, isActive });
    }
  }

  // 5. Fallback for any standalone <DSPDISPNAME> tags
  const dspRegex = /<DSPDISPNAME\b[^>]*>([^<]+)<\/DSPDISPNAME>/gi;
  while ((match = dspRegex.exec(xml)) !== null) {
    const name = cleanCompanyName(match[1]);
    if (name && isValidCompanyName(name)) {
      addCompany({ name, isActive: false });
    }
  }

  // 6. If explicitCurrentCompany exists and not yet in companies, add it
  if (explicitCurrentCompany) {
    addCompany({ name: explicitCurrentCompany, isActive: true });
  }

  // 7. Resolve active company using multi-tier criteria:
  let activeCompanyName: string | null = null;

  // Criterion A: Explicit CurrentCompany / SVCurrentCompany
  if (explicitCurrentCompany) {
    const found = companies.find((c) => c.name.toLowerCase() === explicitCurrentCompany!.toLowerCase());
    activeCompanyName = found ? found.name : explicitCurrentCompany;
  }

  // Criterion B: IsActive flag if available
  if (!activeCompanyName) {
    const activeEntry = companies.find((c) => c.isActive === true);
    if (activeEntry) {
      activeCompanyName = activeEntry.name;
    }
  }

  // Criterion C: First valid company returned as fallback
  if (!activeCompanyName && companies.length > 0) {
    activeCompanyName = companies[0].name;
  }

  return {
    companies,
    activeCompanyName,
  };
}

/**
 * Backwards compatible helper returning company array.
 */
export function parseTallyCompanies(xml: string): TallyCompany[] {
  return parseTallyCompanyResponse(xml).companies;
}

/**
 * Backwards compatible helper returning active company name or null.
 */
export function detectActiveCompanyFromXml(xml: string): string | null {
  return parseTallyCompanyResponse(xml).activeCompanyName;
}

/**
 * Queries TallyPrime to fetch the currently active/opened company.
 * Implements multi-fallback strategy and logs complete XML requests and responses.
 *
 * Strategies:
 * 1. ##SVCURRENTCOMPANY dynamic TDL export (CurrentCompanyObj)
 * 1b. ##SVCURRENTCOMPANY dynamic TDL export (CurCompCol)
 * 2. "List of Companies" collection with <FETCH>Name</FETCH>
 * 3. Standard "List of Companies" collection
 * 4. Standard "ListOfCompanies" collection
 * 5. Standard "Company" collection
 * 6. "$$CurrentCompany" function export
 *
 * Returns { name: "..." } or null if all methods fail.
 */
export async function fetchActiveCompany(
  tallyUrl: string = config.tallyUrl
): Promise<TallyCompany | null> {
  console.log(`[Tally Detection] Starting company detection. Target: ${tallyUrl}`);

  const strategies: Array<{ name: string; requestXml: string }> = [
    {
      name: "1. ##SVCURRENTCOMPANY CurrentCompanyObj",
      requestXml: getCurrentCompanyRequest(),
    },
    {
      name: "1b. ##SVCURRENTCOMPANY CurCompCol",
      requestXml: getCurrentCompanyCurCompColRequest(),
    },
    {
      name: "2. List of Companies with FETCH Name",
      requestXml: getCompaniesRequest(),
    },
    {
      name: "3. Standard List of Companies",
      requestXml: getStandardListOfCompaniesRequest(),
    },
    {
      name: "4. Standard ListOfCompanies",
      requestXml: getListOfCompaniesNoSpacesRequest(),
    },
    {
      name: "5. Company Collection",
      requestXml: getCompanyCollectionRequest(),
    },
    {
      name: "6. $$CurrentCompany Function",
      requestXml: getCurrentCompanyFunctionRequest(),
    },
  ];

  for (const strategy of strategies) {
    try {
      console.log(`[Tally Detection] Attempting: ${strategy.name}`);
      // Log request XML
      logTallyCommunication("REQUEST", strategy.name, tallyUrl, strategy.requestXml);

      const res = await fetch(tallyUrl, {
        method: "POST",
        headers: { "Content-Type": "text/xml" },
        body: strategy.requestXml,
      });

      if (res.ok || res.status === 200) {
        const xml = await res.text();

        // Log response XML
        logTallyCommunication("RESPONSE", strategy.name, tallyUrl, xml);

        const parsed = parseTallyCompanyResponse(xml);
        if (parsed.activeCompanyName) {
          console.log(`[Tally Detection] ✓ Active company detected via [${strategy.name}]: "${parsed.activeCompanyName}"`);
          return {
            name: parsed.activeCompanyName,
            isActive: true,
          };
        }
      } else {
        const errText = await res.text().catch(() => "");
        logTallyCommunication("RESPONSE", `${strategy.name} (HTTP ${res.status})`, tallyUrl, errText);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Tally Detection] Strategy [${strategy.name}] error: ${msg}`);
    }
  }

  console.log("[Tally Detection] All detection strategies exhausted. No open company detected.");
  return null;
}

/**
 * Connects to Tally XML server and fetches available companies.
 */
export async function fetchCompaniesFromTally(
  tallyUrl: string = config.tallyUrl
): Promise<TallyCompany[]> {
  const active = await fetchActiveCompany(tallyUrl);
  if (active) {
    return [active];
  }
  return [];
}
