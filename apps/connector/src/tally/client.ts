import { config } from "../config.js";

export async function sendToTally(xml: string): Promise<string> {
  const response = await fetch(config.tallyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
    },
    body: xml,
  });

  if (!response.ok) {
    throw new Error(`Tally request failed: ${response.status}`);
  }

  return await response.text();
}
