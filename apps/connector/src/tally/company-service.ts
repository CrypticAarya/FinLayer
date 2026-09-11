import { config } from "../config.js";
import { logger } from "../logger.js";

export interface TallyCompany {
  name: string;
}

/**
 * Builds the Tally XML export envelope for List of Companies.
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
<NATIVEMETHOD>Name</NATIVEMETHOD>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>`;
}

/**
 * Extracts company names from various Tally XML response formats:
 * - <COMPANY NAME="..."><NAME>...</NAME></COMPANY>
 * - <COMPANY NAME="..."> without child <NAME>
 * - <NAME.LIST><NAME>...</NAME></NAME.LIST>
 * - <LINE><DSPDISPNAME>...</DSPDISPNAME></LINE>
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

    if (name.length > 0 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      companies.push({ name });
    }
  };

  // 1. Check for <COMPANY ...> ... </COMPANY> blocks
  const companyBlockRegex = /<COMPANY\b([^>]*)>([\s\S]*?)<\/COMPANY>/gi;
  let match: RegExpExecArray | null;

  while ((match = companyBlockRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";

    // Check inner <NAME>...</NAME>
    const nameTagMatch = /<NAME[^>]*>([^<]+)<\/NAME>/i.exec(inner);
    if (nameTagMatch && nameTagMatch[1]) {
      addCompany(nameTagMatch[1]);
      continue;
    }

    // Check attribute NAME="..."
    const nameAttrMatch = /NAME="([^"]+)"/i.exec(attrs);
    if (nameAttrMatch && nameAttrMatch[1]) {
      addCompany(nameAttrMatch[1]);
    }
  }

  // 2. Self-closing <COMPANY NAME="..." />
  const selfClosingRegex = /<COMPANY\b[^>]*NAME="([^"]+)"[^>]*\/>/gi;
  while ((match = selfClosingRegex.exec(xml)) !== null) {
    addCompany(match[1]);
  }

  // 3. Fallback for LINE / DSPDISPNAME format
  const dspRegex = /<DSPDISPNAME[^>]*>([^<]+)<\/DSPDISPNAME>/gi;
  while ((match = dspRegex.exec(xml)) !== null) {
    addCompany(match[1]);
  }

  // 4. Fallback for SVCURRENTCOMPANY
  const svCurrentRegex = /<SVCURRENTCOMPANY[^>]*>([^<]+)<\/SVCURRENTCOMPANY>/gi;
  while ((match = svCurrentRegex.exec(xml)) !== null) {
    addCompany(match[1]);
  }

  return companies;
}

/**
 * Connects to Tally XML server and fetches available companies.
 */
export async function fetchCompaniesFromTally(
  tallyUrl: string = config.tallyUrl
): Promise<TallyCompany[]> {
  logger.info(`Fetching companies from Tally at ${tallyUrl}...`);
  const requestXml = getCompaniesRequest();
  const response = await fetch(tallyUrl, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: requestXml,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(no body)");
    throw new Error(`Tally HTTP error: ${response.status} ${response.statusText} — ${errorText}`);
  }

  const xmlText = await response.text();
  const companies = parseTallyCompanies(xmlText);
  logger.info(`Found ${companies.length} company(ies) in Tally`);
  return companies;
}
