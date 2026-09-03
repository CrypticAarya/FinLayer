import { parseLedgers } from "./parser.ts";

const sampleXml = `
<ENVELOPE>
 <BODY>
  <DATA>
   <COLLECTION>
    <LEDGER NAME="Cash">
     <PARENT>Cash-in-Hand</PARENT>
     <MASTERID>31</MASTERID>
     <ALTERID>32</ALTERID>
    </LEDGER>
    <LEDGER NAME="Profit &amp; Loss A/c">
     <PARENT>Primary</PARENT>
     <MASTERID>30</MASTERID>
     <ALTERID>31</ALTERID>
    </LEDGER>
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>`;

const result = parseLedgers(sampleXml);

console.log(JSON.stringify(result, null, 2));
