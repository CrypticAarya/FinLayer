import { sendToTally } from "./client.ts";

const LEDGER_REQUEST_XML = `
<ENVELOPE>
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
    <SVCURRENTCOMPANY>FinLayer Test Company</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;

export async function getLedgers(): Promise<string> {
  return await sendToTally(LEDGER_REQUEST_XML);
}
