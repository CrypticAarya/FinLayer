#!/usr/bin/env tsx
import prisma from "../db/prisma.js";
import { generateSaasApiKey } from "../auth/saas-auth.js";

async function main() {
  const args = process.argv.slice(2);
  let companyNameOrId = args[0];
  let keyName = args[1] || "SaaS Lifetime API Key";

  // Find company
  let company = null;
  if (companyNameOrId) {
    company = await prisma.company.findFirst({
      where: {
        OR: [
          { id: companyNameOrId },
          { name: { contains: companyNameOrId, mode: "insensitive" } },
          { tallyCompanyName: { contains: companyNameOrId, mode: "insensitive" } },
        ],
      },
    });
  } else {
    // Pick the most recent company
    company = await prisma.company.findFirst({
      orderBy: { createdAt: "desc" },
    });
  }

  if (!company) {
    console.error("❌ No company found in database. Please sync a company from Tally first or specify a company ID.");
    process.exit(1);
  }

  const { apiKey, keyRecord } = await generateSaasApiKey({
    companyId: company.id,
    name: keyName,
  });

  console.log("\n==================================================================");
  console.log("       🎉 LIFETIME FREE SAAS API KEY GENERATED SUCCESSFULLY        ");
  console.log("==================================================================");
  console.log(`Company Name : ${company.name} (${company.tallyCompanyName})`);
  console.log(`Company ID   : ${company.id}`);
  console.log(`Key Name     : ${keyRecord.name}`);
  console.log(`Status       : ${keyRecord.status} (Valid Forever / Never Expires)`);
  console.log("------------------------------------------------------------------");
  console.log(`API KEY      : ${apiKey}`);
  console.log("------------------------------------------------------------------");
  console.log("⚠️  SAVE THIS KEY! It is shown only once and cannot be recovered.");
  console.log("\nHow the SaaS developer uses it:");
  console.log(`curl -X GET "http://YOUR_API_HOST/api/v1/companies/${company.id}/ledgers" \\`);
  console.log(`  -H "x-api-key: ${apiKey}"`);
  console.log("==================================================================\n");
}

main()
  .catch((err) => {
    console.error("Error generating API key:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
