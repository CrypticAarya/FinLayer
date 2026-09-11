import { config } from "../config.js";
import { logger } from "../logger.js";

export interface TallyCompany {
  name: string;
}

/**
 * Builds the Tally XML export envelope evaluating ##SVCURRENTCOMPANY
 * to fetch the currently active/loaded company in TallyPrime.
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
 * Builds the Tally XML export envelope for List of Companies collection.
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
<COLLECTION NAME="List of Companies" ISMODIFY="No">
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
 * Builds a simple ListOfCompanies collection request without custom TDL.
 */
export function getSimpleListOfCompaniesRequest(): string {
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

const BLACKLIST_NAMES = new Set([
  "currentcompanyobj",
  "currentcompany",
  "$$sysname:xml",
  "(none)",
  "none",
  "",
]);

/**
 * Extracts company names from various Tally XML response formats:
 * - <CURRENTCOMPANYOBJ ...><NAME>...</NAME></CURRENTCOMPANYOBJ>
 * - <COMPANY NAME="..."><NAME>...</NAME></COMPANY>
 * - <LISTOFCOMPANIES><NAME>...</NAME></LISTOFCOMPANIES>
 * - <SVCURRENTCOMPANY>...
 */
export function parseTallyCompanies(xml: string): TallyCompany[] {
  const companies: TallyCompany[] = [];
  const seen = new Set<string>();

  const addCompany = (rawName: string | undefined | null) => {
    if (!rawName) return;
    const name = rawName
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();

    if (name.length > 0 && !BLACKLIST_NAMES.has(name.toLowerCase()) && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      companies.push({ name });
    }
  };

  // 1. Check for <CURRENTCOMPANYOBJ> ... </CURRENTCOMPANYOBJ> or <CURRENTCOMPANY>
  const currentCompRegex = /<(?:CURRENTCOMPANYOBJ|CURRENTCOMPANY)\b[^>]*>([\s\S]*?)<\/(?:CURRENTCOMPANYOBJ|CURRENTCOMPANY)>/gi;
  let match: RegExpExecArray | null;
  while ((match = currentCompRegex.exec(xml)) !== null) {
    const inner = match[1] || "";
    const nameMatch = /<NAME[^>]*>([^<]+)<\/NAME>/i.exec(inner);
    if (nameMatch && nameMatch[1]) {
      addCompany(nameMatch[1]);
    } else {
      // Sometimes value is directly text
      const directVal = inner.replace(/<[^>]+>/g, "").trim();
      if (directVal) addCompany(directVal);
    }
  }

  // 2. Check for <COMPANY ...> ... </COMPANY> blocks
  const companyBlockRegex = /<COMPANY\b([^>]*)>([\s\S]*?)<\/COMPANY>/gi;
  while ((match = companyBlockRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";

    const nameTagMatch = /<NAME[^>]*>([^<]+)<\/NAME>/i.exec(inner);
    if (nameTagMatch && nameTagMatch[1]) {
      addCompany(nameTagMatch[1]);
      continue;
    }

    const nameAttrMatch = /NAME="([^"]+)"/i.exec(attrs);
    if (nameAttrMatch && nameAttrMatch[1]) {
      addCompany(nameAttrMatch[1]);
    }
  }

  // 3. Self-closing <COMPANY NAME="..." />
  const selfClosingRegex = /<COMPANY\b[^>]*NAME="([^"]+)"[^>]*\/>/gi;
  while ((match = selfClosingRegex.exec(xml)) !== null) {
    addCompany(match[1]);
  }

  // 4. Check for <LISTOFCOMPANIES> ... <NAME>...</NAME>
  const listOfCompRegex = /<LISTOFCOMPANIES\b[^>]*>([\s\S]*?)<\/LISTOFCOMPANIES>/gi;
  while ((match = listOfCompRegex.exec(xml)) !== null) {
    const inner = match[1] || "";
    const names = inner.matchAll(/<NAME[^>]*>([^<]+)<\/NAME>/gi);
    for (const n of names) {
      if (n[1]) addCompany(n[1]);
    }
  }

  // 5. Fallback for LINE / DSPDISPNAME format
  const dspRegex = /<DSPDISPNAME[^>]*>([^<]+)<\/DSPDISPNAME>/gi;
  while ((match = dspRegex.exec(xml)) !== null) {
    addCompany(match[1]);
  }

  // 6. Fallback for SVCURRENTCOMPANY
  const svCurrentRegex = /<SVCURRENTCOMPANY[^>]*>([^<]+)<\/SVCURRENTCOMPANY>/gi;
  while ((match = svCurrentRegex.exec(xml)) !== null) {
    addCompany(match[1]);
  }

  return companies;
}

/**
 * Queries TallyPrime to fetch the currently active/opened company.
 * Returns { name: "..." } or null if no company is open.
 */
export async function fetchActiveCompany(
  tallyUrl: string = config.tallyUrl
): Promise<TallyCompany | null> {
  logger.info(`Fetching active company from Tally at ${tallyUrl}...`);

  // 1. Try ##SVCURRENTCOMPANY query
  try {
    const res = await fetch(tallyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: getCurrentCompanyRequest(),
    });
    if (res.ok) {
      const xml = await res.text();
      const companies = parseTallyCompanies(xml);
      if (companies.length > 0 && companies[0].name) {
        logger.info(`Active company detected: "${companies[0].name}"`);
        return companies[0];
      }
    }
  } catch (err) {
    logger.warn(`Current company query attempt failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Fallback to List of Companies collection query
  try {
    const res = await fetch(tallyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: getCompaniesRequest(),
    });
    if (res.ok) {
      const xml = await res.text();
      const companies = parseTallyCompanies(xml);
      if (companies.length > 0 && companies[0].name) {
        logger.info(`Company detected from List of Companies: "${companies[0].name}"`);
        return companies[0];
      }
    }
  } catch (err) {
    logger.warn(`List of Companies query attempt failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Fallback to simple ListOfCompanies collection
  try {
    const res = await fetch(tallyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: getSimpleListOfCompaniesRequest(),
    });
    if (res.ok) {
      const xml = await res.text();
      const companies = parseTallyCompanies(xml);
      if (companies.length > 0 && companies[0].name) {
        logger.info(`Company detected from simple ListOfCompanies: "${companies[0].name}"`);
        return companies[0];
      }
    }
  } catch {}

  logger.info("No active company found in TallyPrime response");
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
