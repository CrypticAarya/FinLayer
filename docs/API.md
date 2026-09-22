# FinLayer SaaS API Developer Guide (v2.2)

Welcome to the FinLayer developer platform! This guide covers everything external SaaS developers need to integrate financial data extracted from TallyPrime into their SaaS product in under 15 minutes.

---

## 1. Getting Started

### Overview
FinLayer extracts financial data from on-premise TallyPrime instances, normalizes it into canonical double-entry accounting models in PostgreSQL, and serves it through a high-performance REST API.

- **Base URL**: `http://<your-finlayer-host>:4000/api/v1` (or your production cloud domain)
- **Data Format**: JSON (default) and NDJSON (for streaming vouchers)
- **Interactive Documentation**: Visit `http://<your-finlayer-host>:4000/docs` in your browser for the read-only Swagger UI.
- **Raw OpenAPI Specification**: `http://<your-finlayer-host>:4000/docs/openapi.json`

---

## 2. Authentication

Every request to the FinLayer SaaS API requires an API key issued for a specific tenant company.

### API Key Format
API keys follow the standard prefix format:
```text
fl_live_<48-hex-characters>
```
Example: `fl_live_your_api_key_here`

### Passing the API Key
You can authenticate your requests using either of the following HTTP headers:

#### Option A: Authorization Bearer Header (Recommended)
```http
Authorization: Bearer fl_live_your_api_key_here
```

#### Option B: `x-api-key` Header
```http
x-api-key: fl_live_your_api_key_here
```

### Tenant Isolation Guarantee
FinLayer enforces strict company-level isolation. An API key is permanently bound to a single `companyId`. If an API key issued for Company A makes a request to `/api/v1/companies/Company_B`, the gateway immediately rejects it with:
```json
{
  "success": false,
  "error": "Forbidden: API key does not have access to this company."
}
```

---

## 3. First API Request

Here is a minimal request to verify connectivity and retrieve your company's metadata:

```bash
curl -X GET "http://localhost:4000/api/v1/companies/cmu84468l00001s3tnvjagcrz" \
  -H "Authorization: Bearer fl_live_your_api_key_here"
```

### Expected Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": "cmu84468l00001s3tnvjagcrz",
    "name": "Acme Manufacturing Private Limited",
    "tallyCompanyName": "Acme Manufacturing",
    "connectorStatus": "ONLINE",
    "lastHeartbeat": "2026-09-22T13:15:00.000Z",
    "lastSyncAt": "2026-09-22T13:17:28.452Z",
    "createdAt": "2026-09-18T10:00:00.000Z",
    "updatedAt": "2026-09-22T12:00:00.000Z"
  }
}
```

---

## 4. Fetching Accounting Data

### 4.1. Chart of Accounts & Ledgers
Retrieve all master accounts, account groups, and closing balances:

```http
GET /api/v1/companies/:companyId/ledgers?limit=50
```

Response snippet:
```json
{
  "success": true,
  "data": [
    {
      "id": "cmu84468l00002s3tnvjagcrz",
      "name": "HDFC Bank Account",
      "groupName": "Bank Accounts",
      "parentType": "Asset",
      "openingBalance": 250000.00,
      "closingBalance": 345000.50,
      "currency": "INR"
    }
  ],
  "pagination": {
    "hasMore": false,
    "nextCursor": null,
    "totalCount": 10,
    "limit": 50
  }
}
```

### 4.2. Canonical Trial Balance
FinLayer aggregates opening balances and double-entry transaction legs into a mathematically balanced Trial Balance:

```http
GET /api/v1/companies/:companyId/trial-balance?startDate=2026-04-01&endDate=2027-03-31
```

#### Query Parameters
- `startDate` (or `fromDate`): Start date in `YYYY-MM-DD` format.
- `endDate` (or `toDate`): End date in `YYYY-MM-DD` format.
- `asOfDate`: Aggregates all balances up to a specific date.

#### Response Structure
```json
{
  "success": true,
  "companyId": "cmu84468l00001s3tnvjagcrz",
  "filters": {
    "startDate": "2026-04-01T00:00:00.000Z",
    "endDate": "2027-03-31T00:00:00.000Z"
  },
  "data": [
    {
      "ledgerId": "cmu84468l00002s3tnvjagcrz",
      "ledgerName": "Sales Account",
      "groupName": "Sales Accounts",
      "debitAmount": 0.00,
      "creditAmount": 36000.50,
      "netBalance": -36000.50
    }
  ],
  "totals": {
    "debitTotal": 36000.50,
    "creditTotal": 36000.50,
    "isBalanced": true
  }
}
```

> [!TIP]
> Always check `totals.isBalanced === true` in your consumer application to confirm financial equation correctness.

---

## 5. Pagination

Endpoints returning lists of records (`/ledgers` and `/vouchers`) implement **deterministic keyset cursor pagination**. This guarantees $O(\text{batch size})$ database memory usage without the performance penalty of traditional SQL `OFFSET`.

### How Keyset Pagination Works
1. First request: Query without a cursor:
   ```http
   GET /api/v1/companies/:companyId/vouchers?limit=50
   ```
2. Inspect the `pagination` object in the response:
   ```json
   {
     "pagination": {
       "hasMore": true,
       "nextCursor": "cmu84468l00015s3tnvjagcrz",
       "limit": 50
     }
   }
   ```
3. Subsequent requests: Pass the `nextCursor` value in the `cursor` query parameter:
   ```http
   GET /api/v1/companies/:companyId/vouchers?limit=50&cursor=cmu84468l00015s3tnvjagcrz
   ```
4. Stop when `hasMore` is `false` or `nextCursor` is `null`.

### JavaScript Pagination Example
```javascript
let cursor = undefined;
let hasMore = true;

while (hasMore) {
  const url = new URL(`http://localhost:4000/api/v1/companies/${companyId}/vouchers`);
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  const { data, pagination } = await res.json();
  
  for (const voucher of data) {
    processVoucher(voucher);
  }

  hasMore = pagination.hasMore;
  cursor = pagination.nextCursor;
}
```

---

## 6. Streaming Large Data (NDJSON)

When synchronizing tens of thousands of historical vouchers, fetching large JSON arrays can lead to high memory consumption and socket timeouts. FinLayer provides **newline-delimited JSON (NDJSON)** chunked streaming.

### Activating the Stream
Append `?stream=true` to the voucher endpoint:
```http
GET /api/v1/companies/:companyId/vouchers?stream=true
```

Response headers:
```http
HTTP/1.1 200 OK
Content-Type: application/x-ndjson; charset=utf-8
Transfer-Encoding: chunked
```

### Consuming the Stream in Node.js
```javascript
import readline from "node:readline";

const response = await fetch(`http://localhost:4000/api/v1/companies/${companyId}/vouchers?stream=true`, {
  headers: { "Authorization": `Bearer ${apiKey}` }
});

const rl = readline.createInterface({
  input: response.body,
  crlfDelay: Infinity
});

for await (const line of rl) {
  if (!line.trim()) continue;
  const voucher = JSON.parse(line);
  console.log(`Processed Voucher #${voucher.voucherNumber} (₹${voucher.amount})`);
}
```

---

## 7. Error Handling

FinLayer returns consistent JSON error payloads across all endpoints.

### Error Envelope Format
```json
{
  "success": false,
  "error": "Human-readable description of the error."
}
```

### HTTP Status Code Reference

| Status Code | Meaning | Common Cause & Resolution |
| :---: | :--- | :--- |
| **`400 Bad Request`** | Validation Error | Malformed date range (e.g. `startDate > endDate`) or invalid query parameter. |
| **`401 Unauthorized`** | Authentication Failed | Missing `Authorization` header, invalid token format, unrecognised API key, or revoked key. |
| **`403 Forbidden`** | Tenant Access Denied | The authenticated API key is valid, but is not authorized for the requested `:companyId`. |
| **`404 Not Found`** | Resource Missing | The requested `:companyId` does not exist in the database. |
| **`429 Too Many Requests`** | Rate Limit Exceeded | Client exceeded the rate limit threshold (default: 100 requests / minute). Inspect the `Retry-After` header. |
| **`500 Internal Error`** | Server Error | Unhandled server exception. Check server application logs. |

---

## 8. Ready-to-Run Code Examples

Complete working scripts are available in the repository:
- **cURL / Shell**: [examples/curl/api-flow.sh](file:///Users/eunoia/Desktop/FinLayer/examples/curl/api-flow.sh)
- **JavaScript / Node.js**: [examples/javascript/quickstart.js](file:///Users/eunoia/Desktop/FinLayer/examples/javascript/quickstart.js)
- **Python 3**: [examples/python/quickstart.py](file:///Users/eunoia/Desktop/FinLayer/examples/python/quickstart.py)
