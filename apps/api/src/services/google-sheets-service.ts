export interface CreateSpreadsheetResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

export interface GoogleTokensResult {
  accessToken: string;
  refreshToken: string;
  email: string;
}

export const FINANCIAL_SPREADSHEET_TABS = [
  "Dashboard",
  "Trial Balance",
  "Ledgers",
  "Transactions",
] as const;

/**
 * Checks if Google OAuth credentials are set in the environment.
 */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  );
}

/**
 * Builds the Google OAuth 2.0 authorization URL.
 */
export function getGoogleAuthUrl(companyId: string, redirectUri?: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const baseRedirect = redirectUri || process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/google/callback";
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: baseRedirect,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state: companyId,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges authorization code for tokens and fetches user profile email.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri?: string
): Promise<GoogleTokensResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const baseRedirect = redirectUri || process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/google/callback";

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: baseRedirect,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text().catch(() => "(no body)");
    throw new Error(`Google token exchange error: ${tokenRes.status} ${tokenRes.statusText} — ${errorText}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || "";

  // Fetch user email from Google UserInfo
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let email = "user@example.com";
  if (userRes.ok) {
    const userData = (await userRes.json()) as { email?: string };
    if (userData.email) {
      email = userData.email;
    }
  }

  return {
    accessToken,
    refreshToken,
    email,
  };
}

/**
 * Creates the standard FinLayer financial spreadsheet with the 4 required tabs:
 * - Dashboard
 * - Trial Balance
 * - Ledgers
 * - Transactions
 */
export async function createFinancialSpreadsheet(
  accessToken: string,
  companyName: string
): Promise<CreateSpreadsheetResult> {
  const spreadsheetTitle = `${companyName.trim()} Financial Data`;

  const payload = {
    properties: {
      title: spreadsheetTitle,
    },
    sheets: FINANCIAL_SPREADSHEET_TABS.map((title) => ({
      properties: { title },
    })),
  };

  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "(no body)");
    throw new Error(`Google Sheets API error: ${res.status} ${res.statusText} — ${errorText}`);
  }

  const data = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
  };

  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
  };
}

/**
 * Generates a mock financial spreadsheet result for testing and development
 * when Google credentials are not configured.
 */
export function createMockFinancialSpreadsheet(companyName: string): CreateSpreadsheetResult {
  const cleanId = Buffer.from(`${companyName}-${Date.now()}`).toString("base64url").slice(0, 32);
  return {
    spreadsheetId: `1mock_${cleanId}`,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/1mock_${cleanId}/edit`,
  };
}
