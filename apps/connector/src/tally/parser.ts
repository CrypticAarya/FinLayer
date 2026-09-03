import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
});

function extractValue(value: any): any {
  if (value && typeof value === "object" && "#text" in value) {
    return value["#text"];
  }
  return value;
}

export function parseLedgers(xml: string) {
  const result = parser.parse(xml);

  const ledgers =
    result?.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER ?? [];

  const ledgerList = Array.isArray(ledgers)
    ? ledgers
    : [ledgers];

  return ledgerList.map((ledger: any) => ({
    name: ledger["@_NAME"],
    parent: extractValue(ledger.PARENT),
    masterId: Number(extractValue(ledger.MASTERID)),
    alterId: Number(extractValue(ledger.ALTERID)),
  }));
}
