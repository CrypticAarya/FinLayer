# FinLayer API Documentation

**Version:** v1  
**Base URL:** `https://api.finlayer.io/api/v1`  
**Protocol:** HTTPS only

---

## Table of Contents

1. [What is FinLayer?](#1-what-is-finlayer)
2. [Authentication](#2-authentication)
3. [Integration Workflow](#3-integration-workflow)
4. [API Reference](#4-api-reference)
   - [GET /companies/:companyId](#41-get-company)
   - [POST /companies/:companyId/sync](#42-trigger-sync)
   - [GET /companies/:companyId/sync-status](#43-get-sync-status)
   - [GET /companies/:companyId/trial-balance](#44-get-trial-balance)
   - [GET /companies/:companyId/ledgers](#45-get-ledgers)
   - [GET /companies/:companyId/vouchers](#46-get-vouchers)
5. [Code Examples](#5-code-examples)
6. [Error Handling](#6-error-handling)
7. [SaaS Integration Checklist](#7-saas-integration-checklist)

---

## 1. What is FinLayer?

FinLayer is a **headless integration bridge** that connects TallyPrime accounting data to external SaaS applications in real time — without manual exports, CSV files, or custom Tally integrations.

### Architecture

```
TallyPrime (Windows)
        │
        │  XML via ODBC / HTTP
        ▼
FinLayer Connector
(Runs on customer's Windows machine)
        │
        │  Secure bearer token (ct_...)
        ▼
FinLayer Cloud API
(Hosted infrastructure)
        │
        │  SaaS API key (fl_live_...)
        ▼
Your SaaS Application
(ProfitNiti, ERP, BI tools, etc.)
```

### What FinLayer does

| Layer | Responsibility |
|-------|---------------|
| **Connector** | Polls TallyPrime, extracts XML data, transforms and uploads to cloud |
| **Cloud API** | Stores synced data, enforces tenant isolation, exposes SaaS APIs |
| **Your app** | Triggers syncs on demand, reads clean financial data via REST API |

### What FinLayer does NOT do

- No dashboards or reports
- No manual data entry
- No CSV/Google Sheets exports
- No accounting logic (TallyPrime handles that)

---

## 2. Authentication

All SaaS API endpoints require a **company-scoped API key**. Each key is bound to exactly one company — it cannot access data from any other company.

### API Key Format

```
fl_live_<48 hex characters>
```

**Example:**
```
fl_live_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
```

### Providing the Key

You can pass the API key in either of two ways:

**Option A — `x-api-key` header (recommended):**
```http
x-api-key: fl_live_a1b2c3d4e5f6...
```

**Option B — `Authorization` Bearer header:**
```http
Authorization: Bearer fl_live_a1b2c3d4e5f6...
```

### API Key Security

| Property | Detail |
|----------|--------|
| **Storage** | Only a SHA-256 hash is stored in the database. The plaintext key is shown **once** at creation and cannot be retrieved again. |
| **Scope** | Each key is scoped to a single `companyId`. Cross-company requests are hard-rejected with `403`. |
| **Revocation** | Keys can be revoked instantly. Revoked keys return `401` immediately. |
| **Rotation** | Generate a new key and revoke the old one. Zero downtime rotation is supported. |

### Key Management

API keys are managed through your FinLayer admin. Contact your FinLayer integration partner to:

- Issue a new API key for a company
- Revoke a compromised key
- List active keys for a company

### Invalid Key Responses

| Scenario | HTTP Status | Error |
|----------|-------------|-------|
| No key provided | `401` | `"Missing API key."` |
| Key not found in DB | `401` | `"Invalid API key."` |
| Key revoked | `401` | `"API key has been revoked."` |
| Key inactive | `401` | `"API key is inactive."` |
| Key for wrong company | `403` | `"API key does not have access to this company."` |

---

## 3. Integration Workflow

### Step 1 — Company is connected via FinLayer Connector

The customer installs the **FinLayer Connector** on their Windows machine where TallyPrime is running. The Connector registers and pairs with a FinLayer company record. This is a one-time setup done by the FinLayer team.

Once registered, the Connector sends heartbeats every 30 seconds and stays ONLINE automatically. You can verify connector status via the `sync-status` endpoint.

### Step 2 — Trigger a Sync

When your SaaS application needs fresh Tally data, trigger a sync:

```http
POST /api/v1/companies/{companyId}/sync
x-api-key: fl_live_xxxxx
```

This creates an asynchronous `SyncJob`. The Connector polls for it, runs the full Tally extraction pipeline (trial balance → ledgers → vouchers), and marks the job complete. Your API call returns immediately with a job ID.

```json
{
  "success": true,
  "syncJobId": "cm1abc123",
  "status": "QUEUED"
}
```

### Step 3 — Poll Sync Status

Check whether the sync has completed:

```http
GET /api/v1/companies/{companyId}/sync-status
x-api-key: fl_live_xxxxx
```

`currentSyncStatus` transitions:

```
QUEUED → IN_PROGRESS → IDLE (success)
                     ↘ SYNC_FAILED (error)
```

Wait until `currentSyncStatus` is `"IDLE"` and `lastSuccessfulSync` is recent before reading data.

### Step 4 — Fetch Financial Data

Once sync is complete, read the latest financial data:

| Data | Endpoint |
|------|----------|
| Trial Balance | `GET /api/v1/companies/{companyId}/trial-balance` |
| Chart of Accounts / Ledgers | `GET /api/v1/companies/{companyId}/ledgers` |
| Vouchers / Transactions | `GET /api/v1/companies/{companyId}/vouchers` |

All data is guaranteed to be **company-isolated** — your key can only ever see data for the one company it is scoped to.

---

## 4. API Reference

All endpoints share these properties:

- **Base URL:** `https://api.finlayer.io/api/v1`
- **Content-Type:** `application/json`
- **Authentication:** `x-api-key` or `Authorization: Bearer` (required on all endpoints)

---

### 4.1 Get Company

Retrieve metadata about the connected TallyPrime company, including connector status and last sync time.

```
GET /api/v1/companies/:companyId
```

#### Request

```http
GET /api/v1/companies/cm1xyz789
x-api-key: fl_live_a1b2c3d4e5f6...
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "cm1xyz789",
    "name": "Acme Pvt Ltd",
    "tallyCompanyName": "Acme Private Limited",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-09-24T08:00:00.000Z",
    "connectorStatus": "ONLINE",
    "lastHeartbeat": "2024-09-24T12:00:00.000Z",
    "lastSyncAt": "2024-09-24T11:45:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | FinLayer company ID |
| `name` | string | Company name in FinLayer |
| `tallyCompanyName` | string | Exact company name in TallyPrime |
| `connectorStatus` | `ONLINE` \| `OFFLINE` \| `null` | Current connector health |
| `lastHeartbeat` | ISO 8601 \| `null` | Last heartbeat from connector |
| `lastSyncAt` | ISO 8601 \| `null` | Last successful sync timestamp |

#### Error Codes

| Status | When |
|--------|------|
| `401` | Missing or invalid API key |
| `403` | API key scoped to a different company |
| `404` | Company not found |

---

### 4.2 Trigger Sync

Request an asynchronous sync of TallyPrime data. The Connector picks up the job and runs the extraction pipeline in the background.

```
POST /api/v1/companies/:companyId/sync
```

#### Request

```http
POST /api/v1/companies/cm1xyz789/sync
x-api-key: fl_live_a1b2c3d4e5f6...
Content-Type: application/json

{
  "type": "FINANCIAL_DATA"
}
```

#### Request Body (optional)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | `FINANCIAL_DATA` | Type of sync to perform |

**Sync types:**

| Value | What gets synced |
|-------|-----------------|
| `FINANCIAL_DATA` | Trial Balance + Ledgers + Vouchers (full sync, **recommended**) |
| `LEDGERS` | Chart of accounts only |
| `VOUCHERS` | Transactions only |
| `TRIAL_BALANCE` | Trial balance snapshot only |
| `BOTH` | Ledgers + Vouchers (no trial balance) |

#### Response `200 OK`

```json
{
  "success": true,
  "syncJobId": "cm1abc123def456",
  "jobId": "cm1abc123def456",
  "status": "QUEUED"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `syncJobId` | string | Unique ID of the created sync job |
| `status` | `QUEUED` | Always `QUEUED` on success |

#### Error Codes

| Status | When |
|--------|------|
| `401` | Missing or invalid API key |
| `403` | API key scoped to a different company |
| `404` | Company not found, or no connector is registered for this company |

---

### 4.3 Get Sync Status

Check the current sync state, connector health, and data freshness for a company.

```
GET /api/v1/companies/:companyId/sync-status
```

#### Request

```http
GET /api/v1/companies/cm1xyz789/sync-status
x-api-key: fl_live_a1b2c3d4e5f6...
```

#### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "companyId": "cm1xyz789",
    "currentSyncStatus": "IDLE",
    "connectorStatus": "ONLINE",
    "lastSyncTime": "2024-09-24T11:45:00.000Z",
    "lastSyncResult": "SYNC_COMPLETED",
    "recordsProcessed": 1452,
    "lastSuccessfulSync": {
      "syncRunId": "run_001",
      "syncType": "FINANCIAL_DATA",
      "completedAt": "2024-09-24T11:45:00.000Z",
      "recordsProcessed": 1452
    },
    "lastFailedSync": null,
    "connector": {
      "id": "conn_001",
      "status": "ONLINE",
      "version": "2.5.0",
      "lastSeenAt": "2024-09-24T12:00:00.000Z",
      "lastHeartbeat": "2024-09-24T12:00:00.000Z"
    },
    "lastSync": {
      "syncRunId": "run_001",
      "syncType": "FINANCIAL_DATA",
      "status": "SYNC_COMPLETED",
      "startedAt": "2024-09-24T11:40:00.000Z",
      "completedAt": "2024-09-24T11:45:00.000Z",
      "durationMs": 300000,
      "recordsProcessed": 1452,
      "recordsCreated": 1200,
      "recordsUpdated": 252,
      "recordsFailed": 0,
      "recordsFetched": 1452,
      "errorSummary": null
    }
  }
}
```

**`currentSyncStatus` values:**

| Value | Meaning |
|-------|---------|
| `IDLE` | No sync running. Data is ready to read. |
| `QUEUED` | Sync job created, connector has not started yet |
| `IN_PROGRESS` | Connector is actively syncing from TallyPrime |
| `SYNC_FAILED` | Last sync failed. Check `lastFailedSync.errorSummary`. |

> **Polling recommendation:** Poll every 5–10 seconds until `currentSyncStatus` returns `IDLE` or `SYNC_FAILED`.

#### Error Codes

| Status | When |
|--------|------|
| `401` | Missing or invalid API key |
| `403` | API key scoped to a different company |
| `404` | Company not found |

---

### 4.4 Get Trial Balance

Return the trial balance for the company. Supports optional date range filtering to aggregate from transaction-level data.

```
GET /api/v1/companies/:companyId/trial-balance
```

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromDate` | `YYYY-MM-DD` | No | Start of date range (inclusive) |
| `toDate` | `YYYY-MM-DD` | No | End of date range (inclusive) |

> **Note:** `startDate`/`endDate` are accepted as aliases for `fromDate`/`toDate`.

When no date range is provided, the latest **synced trial balance snapshot** from TallyPrime is returned. When a date range is provided, FinLayer aggregates ledger debits and credits from vouchers in that period.

#### Request

```http
GET /api/v1/companies/cm1xyz789/trial-balance?fromDate=2024-04-01&toDate=2024-09-30
x-api-key: fl_live_a1b2c3d4e5f6...
```

#### Response `200 OK`

```json
{
  "success": true,
  "companyId": "cm1xyz789",
  "filters": {
    "startDate": "2024-04-01T00:00:00.000Z",
    "endDate": "2024-09-30T00:00:00.000Z"
  },
  "data": [
    {
      "ledgerId": "led_001",
      "ledgerName": "Bank of Baroda - Current",
      "groupName": "Bank Accounts",
      "debitAmount": 1250000.00,
      "creditAmount": 980000.00,
      "netBalance": 270000.00
    },
    {
      "ledgerId": "led_002",
      "ledgerName": "Sales - Domestic",
      "groupName": "Sales Accounts",
      "debitAmount": 0.00,
      "creditAmount": 4500000.00,
      "netBalance": -4500000.00
    }
  ],
  "totals": {
    "debitTotal": 8750000.00,
    "creditTotal": 8750000.00,
    "isBalanced": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ledgerName` | string | Ledger account name from TallyPrime |
| `groupName` | string | Tally group (e.g., `Bank Accounts`, `Sundry Debtors`) |
| `debitAmount` | number | Total debits (2 decimal places) |
| `creditAmount` | number | Total credits (2 decimal places) |
| `netBalance` | number | `debitAmount - creditAmount` |
| `totals.isBalanced` | boolean | Whether total debits === total credits (double-entry check) |

#### Error Codes

| Status | When |
|--------|------|
| `400` | Invalid date format or `fromDate` is after `toDate` |
| `401` | Missing or invalid API key |
| `403` | API key scoped to a different company |
| `404` | Company not found |

---

### 4.5 Get Ledgers

Return the company's chart of accounts (ledgers) from TallyPrime. Results are paginated using cursor-based pagination.

```
GET /api/v1/companies/:companyId/ledgers
```

#### Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | `50` | `250` | Number of records per page |
| `cursor` | string | — | — | Cursor from previous response for next page |

#### Request

```http
GET /api/v1/companies/cm1xyz789/ledgers?limit=100
x-api-key: fl_live_a1b2c3d4e5f6...
```

#### Response `200 OK`

```json
{
  "success": true,
  "companyId": "cm1xyz789",
  "data": [
    {
      "id": "led_001",
      "name": "Bank of Baroda - Current",
      "parent": "Bank Accounts",
      "masterId": "tally-master-123",
      "alterId": "tally-alter-456",
      "createdAt": "2024-09-24T11:45:00.000Z",
      "updatedAt": "2024-09-24T11:45:00.000Z"
    }
  ],
  "pagination": {
    "limit": 100,
    "cursor": null,
    "nextCursor": "led_100",
    "hasMore": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Ledger name from TallyPrime |
| `parent` | string | Parent group in Tally hierarchy |
| `masterId` | string | Tally master ID (unique per company) |
| `alterId` | string | Tally alter ID (version tracking) |
| `pagination.nextCursor` | string \| `null` | Pass as `cursor=` to get the next page |
| `pagination.hasMore` | boolean | `true` if there are more records |

#### Pagination Example

```
Page 1: GET /ledgers?limit=100
         → nextCursor: "led_100"

Page 2: GET /ledgers?limit=100&cursor=led_100
         → nextCursor: "led_200"

Page 3: GET /ledgers?limit=100&cursor=led_200
         → nextCursor: null, hasMore: false
```

#### Error Codes

| Status | When |
|--------|------|
| `401` | Missing or invalid API key |
| `403` | API key scoped to a different company |
| `404` | Company not found |

---

### 4.6 Get Vouchers

Return financial transactions (vouchers) from TallyPrime. Supports cursor pagination, date range filtering, and high-volume NDJSON streaming.

```
GET /api/v1/companies/:companyId/vouchers
```

#### Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | `50` | `250` | Records per page (standard mode only) |
| `cursor` | string | — | — | Cursor for next page |
| `fromDate` | `YYYY-MM-DD` | — | — | Filter vouchers on or after this date |
| `toDate` | `YYYY-MM-DD` | — | — | Filter vouchers on or before this date |
| `stream` | `true` | — | — | Enable NDJSON streaming (see below) |

> **Note:** `startDate`/`endDate` are accepted as aliases for `fromDate`/`toDate`.

#### Request

```http
GET /api/v1/companies/cm1xyz789/vouchers?fromDate=2024-04-01&toDate=2024-09-30&limit=50
x-api-key: fl_live_a1b2c3d4e5f6...
```

#### Response `200 OK`

```json
{
  "success": true,
  "companyId": "cm1xyz789",
  "filters": {
    "startDate": "2024-04-01T00:00:00.000Z",
    "endDate": "2024-09-30T00:00:00.000Z"
  },
  "data": [
    {
      "id": "vch_001",
      "voucherNumber": "INV-2024-0001",
      "voucherType": "Sales",
      "date": "2024-09-15T00:00:00.000Z",
      "partyName": "ABC Enterprises",
      "amount": 50000.00,
      "entries": [
        {
          "id": "ent_001",
          "ledgerId": "led_010",
          "ledgerName": "ABC Enterprises",
          "groupName": "Sundry Debtors",
          "amount": 50000.00,
          "type": "debit"
        },
        {
          "id": "ent_002",
          "ledgerId": "led_002",
          "ledgerName": "Sales - Domestic",
          "groupName": "Sales Accounts",
          "amount": 50000.00,
          "type": "credit"
        }
      ]
    }
  ],
  "pagination": {
    "limit": 50,
    "cursor": null,
    "nextCursor": "vch_050",
    "hasMore": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `voucherNumber` | string | Tally voucher number (e.g., `INV-2024-0001`) |
| `voucherType` | string | Tally type (e.g., `Sales`, `Payment`, `Receipt`, `Journal`) |
| `date` | ISO 8601 | Voucher date |
| `partyName` | string \| `null` | Party involved (customer, vendor) |
| `amount` | number | Voucher total amount |
| `entries[].type` | `debit` \| `credit` | Entry side |
| `entries[].amount` | number | Entry amount (always positive) |

#### NDJSON Streaming (Large Datasets)

For companies with tens of thousands of vouchers, use streaming mode to avoid memory issues. The API streams vouchers as newline-delimited JSON, one object per line:

```http
GET /api/v1/companies/cm1xyz789/vouchers?stream=true
x-api-key: fl_live_a1b2c3d4e5f6...
Accept: application/x-ndjson
```

Response `Content-Type: application/x-ndjson`:
```
{"id":"vch_001","voucherNumber":"INV-2024-0001",...}
{"id":"vch_002","voucherNumber":"INV-2024-0002",...}
...
```

Each line is a complete, valid JSON object. Parse line by line.

#### Error Codes

| Status | When |
|--------|------|
| `400` | Invalid date format or `fromDate` is after `toDate` |
| `401` | Missing or invalid API key |
| `403` | API key scoped to a different company |
| `404` | Company not found |

---

## 5. Code Examples

Replace `YOUR_API_KEY` and `YOUR_COMPANY_ID` with your actual values.

---

### cURL

#### Trigger sync and poll until complete

```bash
#!/bin/bash

API_KEY="fl_live_your_key_here"
COMPANY_ID="cm1xyz789"
BASE_URL="https://api.finlayer.io/api/v1"

# 1. Trigger sync
echo "Triggering sync..."
RESPONSE=$(curl -s -X POST "$BASE_URL/companies/$COMPANY_ID/sync" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "FINANCIAL_DATA"}')

JOB_ID=$(echo $RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['syncJobId'])")
echo "Sync job created: $JOB_ID"

# 2. Poll for completion
while true; do
  STATUS_RESPONSE=$(curl -s "$BASE_URL/companies/$COMPANY_ID/sync-status" \
    -H "x-api-key: $API_KEY")

  SYNC_STATUS=$(echo $STATUS_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['currentSyncStatus'])")
  echo "Status: $SYNC_STATUS"

  if [ "$SYNC_STATUS" = "IDLE" ]; then
    echo "Sync complete!"
    break
  elif [ "$SYNC_STATUS" = "SYNC_FAILED" ]; then
    echo "Sync failed!"
    exit 1
  fi

  sleep 5
done

# 3. Fetch trial balance
curl -s "$BASE_URL/companies/$COMPANY_ID/trial-balance" \
  -H "x-api-key: $API_KEY" | python3 -m json.tool

# 4. Fetch ledgers (first page)
curl -s "$BASE_URL/companies/$COMPANY_ID/ledgers?limit=100" \
  -H "x-api-key: $API_KEY" | python3 -m json.tool

# 5. Fetch vouchers with date filter
curl -s "$BASE_URL/companies/$COMPANY_ID/vouchers?fromDate=2024-04-01&toDate=2024-09-30" \
  -H "x-api-key: $API_KEY" | python3 -m json.tool
```

---

### JavaScript (Node.js / Browser)

#### Full integration flow with async/await

```javascript
const FINLAYER_BASE_URL = 'https://api.finlayer.io/api/v1';
const API_KEY = 'fl_live_your_key_here';
const COMPANY_ID = 'cm1xyz789';

const headers = {
  'x-api-key': API_KEY,
  'Content-Type': 'application/json',
};

/**
 * Trigger a sync and wait for completion.
 */
async function syncAndWait(syncType = 'FINANCIAL_DATA') {
  const triggerRes = await fetch(
    `${FINLAYER_BASE_URL}/companies/${COMPANY_ID}/sync`,
    { method: 'POST', headers, body: JSON.stringify({ type: syncType }) }
  );
  if (!triggerRes.ok) {
    const err = await triggerRes.json();
    throw new Error(`Sync trigger failed: ${err.error}`);
  }
  const { syncJobId } = await triggerRes.json();
  console.log(`Sync job created: ${syncJobId}`);

  while (true) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const statusRes = await fetch(
      `${FINLAYER_BASE_URL}/companies/${COMPANY_ID}/sync-status`,
      { headers }
    );
    const status = await statusRes.json();
    const current = status.data.currentSyncStatus;
    console.log(`Sync status: ${current}`);
    if (current === 'IDLE') return status.data.lastSuccessfulSync;
    if (current === 'SYNC_FAILED') {
      throw new Error(`Sync failed: ${status.data.lastFailedSync?.errorSummary}`);
    }
  }
}

/**
 * Fetch all ledgers using cursor pagination.
 */
async function getAllLedgers() {
  const ledgers = [];
  let cursor = null;
  do {
    const url = new URL(`${FINLAYER_BASE_URL}/companies/${COMPANY_ID}/ledgers`);
    url.searchParams.set('limit', '250');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), { headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    ledgers.push(...data.data);
    cursor = data.pagination.nextCursor;
  } while (cursor);
  return ledgers;
}

/**
 * Fetch trial balance for a date range.
 */
async function getTrialBalance(fromDate, toDate) {
  const url = new URL(`${FINLAYER_BASE_URL}/companies/${COMPANY_ID}/trial-balance`);
  if (fromDate) url.searchParams.set('fromDate', fromDate);
  if (toDate) url.searchParams.set('toDate', toDate);
  const res = await fetch(url.toString(), { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data;
}

/**
 * Stream all vouchers using NDJSON streaming.
 * Processes each voucher as it arrives without loading all into memory.
 */
async function streamVouchers(onVoucher, fromDate, toDate) {
  const url = new URL(`${FINLAYER_BASE_URL}/companies/${COMPANY_ID}/vouchers`);
  url.searchParams.set('stream', 'true');
  if (fromDate) url.searchParams.set('fromDate', fromDate);
  if (toDate) url.searchParams.set('toDate', toDate);

  const res = await fetch(url.toString(), {
    headers: { ...headers, Accept: 'application/x-ndjson' },
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) onVoucher(JSON.parse(line));
    }
  }
}

// Example usage
async function main() {
  await syncAndWait('FINANCIAL_DATA');

  const tb = await getTrialBalance('2024-04-01', '2025-03-31');
  console.log(`Balanced: ${tb.totals.isBalanced} | Debit: ${tb.totals.debitTotal}`);

  const ledgers = await getAllLedgers();
  console.log(`Total ledgers: ${ledgers.length}`);

  let count = 0;
  await streamVouchers(() => count++, '2024-04-01', '2025-03-31');
  console.log(`Total vouchers: ${count}`);
}

main().catch(console.error);
```

---

### PHP

> **Note:** ProfitNiti and other PHP-based SaaS applications should use this example.

```php
<?php

class FinLayerClient
{
    private string $baseUrl;
    private string $apiKey;
    private string $companyId;

    public function __construct(string $apiKey, string $companyId, string $baseUrl = 'https://api.finlayer.io/api/v1')
    {
        $this->apiKey    = $apiKey;
        $this->companyId = $companyId;
        $this->baseUrl   = rtrim($baseUrl, '/');
    }

    private function request(string $method, string $path, array $queryParams = [], ?array $body = null): array
    {
        $url = $this->baseUrl . $path;
        if (!empty($queryParams)) {
            $url .= '?' . http_build_query(array_filter($queryParams, fn($v) => $v !== null));
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                "x-api-key: {$this->apiKey}",
                "Content-Type: application/json",
                "Accept: application/json",
            ],
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        ]);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = json_decode($response, true);

        if ($httpCode >= 400) {
            throw new RuntimeException("FinLayer API error [{$httpCode}]: " . ($data['error'] ?? 'Unknown error'));
        }

        return $data;
    }

    public function getCompany(): array
    {
        return $this->request('GET', "/companies/{$this->companyId}");
    }

    public function triggerSync(string $type = 'FINANCIAL_DATA'): string
    {
        $response = $this->request('POST', "/companies/{$this->companyId}/sync", [], ['type' => $type]);
        return $response['syncJobId'];
    }

    public function getSyncStatus(): array
    {
        return $this->request('GET', "/companies/{$this->companyId}/sync-status");
    }

    public function syncAndWait(string $type = 'FINANCIAL_DATA', int $pollIntervalSeconds = 5, int $timeoutSeconds = 600): array
    {
        $jobId = $this->triggerSync($type);
        echo "Sync job created: {$jobId}\n";

        $start = time();
        while (true) {
            if (time() - $start > $timeoutSeconds) {
                throw new RuntimeException("Sync timed out after {$timeoutSeconds} seconds.");
            }
            sleep($pollIntervalSeconds);

            $status  = $this->getSyncStatus();
            $current = $status['data']['currentSyncStatus'];
            echo "Sync status: {$current}\n";

            if ($current === 'IDLE') {
                echo "Sync complete!\n";
                return $status['data']['lastSuccessfulSync'] ?? [];
            }
            if ($current === 'SYNC_FAILED') {
                $error = $status['data']['lastFailedSync']['errorSummary'] ?? 'Unknown error';
                throw new RuntimeException("Sync failed: {$error}");
            }
        }
    }

    public function getTrialBalance(?string $fromDate = null, ?string $toDate = null): array
    {
        return $this->request('GET', "/companies/{$this->companyId}/trial-balance", [
            'fromDate' => $fromDate,
            'toDate'   => $toDate,
        ]);
    }

    public function getAllLedgers(int $limit = 250): array
    {
        $allLedgers = [];
        $cursor     = null;
        do {
            $response   = $this->request('GET', "/companies/{$this->companyId}/ledgers", [
                'limit'  => $limit,
                'cursor' => $cursor,
            ]);
            $allLedgers = array_merge($allLedgers, $response['data']);
            $cursor     = $response['pagination']['nextCursor'];
        } while ($cursor !== null);
        return $allLedgers;
    }

    public function getAllVouchers(?string $fromDate = null, ?string $toDate = null, int $limit = 250): array
    {
        $allVouchers = [];
        $cursor      = null;
        do {
            $response    = $this->request('GET', "/companies/{$this->companyId}/vouchers", [
                'fromDate' => $fromDate,
                'toDate'   => $toDate,
                'limit'    => $limit,
                'cursor'   => $cursor,
            ]);
            $allVouchers = array_merge($allVouchers, $response['data']);
            $cursor      = $response['pagination']['nextCursor'];
        } while ($cursor !== null);
        return $allVouchers;
    }
}

// ── Example Usage ─────────────────────────────────────────────────────────────

try {
    $client = new FinLayerClient(
        apiKey:    getenv('FINLAYER_API_KEY'),
        companyId: getenv('FINLAYER_COMPANY_ID')
    );

    // Full sync workflow
    $client->syncAndWait('FINANCIAL_DATA');

    // Trial balance for FY 2024-25
    $tb = $client->getTrialBalance('2024-04-01', '2025-03-31');
    echo "Balanced: " . ($tb['totals']['isBalanced'] ? 'YES' : 'NO') . "\n";
    echo "Total Debit:  " . $tb['totals']['debitTotal']  . "\n";
    echo "Total Credit: " . $tb['totals']['creditTotal'] . "\n";

    // All ledgers
    $ledgers = $client->getAllLedgers();
    echo "Total ledgers: " . count($ledgers) . "\n";

    // All vouchers for FY
    $vouchers = $client->getAllVouchers('2024-04-01', '2025-03-31');
    echo "Total vouchers: " . count($vouchers) . "\n";

    foreach ($vouchers as $voucher) {
        echo "{$voucher['date']} | {$voucher['voucherNumber']} | {$voucher['voucherType']} | {$voucher['amount']}\n";
        foreach ($voucher['entries'] as $entry) {
            echo "  [{$entry['type']}] {$entry['ledgerName']} {$entry['amount']}\n";
        }
    }

} catch (RuntimeException $e) {
    echo "Error: " . $e->getMessage() . "\n";
    exit(1);
}
```

---

## 6. Error Handling

All error responses follow the same structure:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Name | When it occurs |
|------|------|----------------|
| `400` | Bad Request | Invalid query parameter (e.g., malformed date, `fromDate` after `toDate`) |
| `401` | Unauthorized | Missing API key, invalid key, revoked key, or inactive key |
| `403` | Forbidden | API key is valid but scoped to a different company |
| `404` | Not Found | Company does not exist, or no connector registered for company |
| `429` | Too Many Requests | Rate limit exceeded. See `Retry-After` header for wait time. |
| `500` | Internal Server Error | Unexpected server error. Contact FinLayer support. |

### 401 Unauthorized — Detailed Errors

| Error Message | Cause | Fix |
|---------------|-------|-----|
| `"Missing API key."` | No `x-api-key` or `Authorization` header | Add the header |
| `"Invalid API key."` | Key not found in database | Check key value, or generate a new key |
| `"API key has been revoked."` | Key was revoked | Generate a new key |
| `"API key is inactive."` | Key exists but is not ACTIVE | Contact FinLayer support |

### 403 Forbidden

```json
{
  "success": false,
  "error": "Forbidden: API key does not have access to this company."
}
```

**Cause:** The API key is scoped to Company A but the request path contains Company B's `companyId`.

### 404 Not Found — Sync Trigger

```json
{
  "success": false,
  "error": "No connector found for company \"cm1xyz789\". Ensure a connector is registered and paired."
}
```

**Cause:** No FinLayer Connector has been installed and paired for this company.

### 429 Too Many Requests

```http
HTTP/1.1 429 Too Many Requests
x-ratelimit-limit: 100
x-ratelimit-remaining: 0
x-ratelimit-reset: 1727185200
retry-after: 60
```

```json
{
  "success": false,
  "statusCode": 429,
  "error": "Rate limit exceeded. Try again in 60 seconds.",
  "message": "Rate limit exceeded. Try again in 60 seconds.",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

> **Rate limit:** 100 requests per minute per IP (production). The `retry-after` header value is in seconds.

**Fix:** Read the `retry-after` header value and wait that many seconds before retrying. Use exponential backoff for repeated failures.

### Recommended Error Handling Pattern (PHP)

```php
try {
    $tb = $client->getTrialBalance('2024-04-01', '2025-03-31');
} catch (RuntimeException $e) {
    $message = $e->getMessage();

    if (str_contains($message, '[401]')) {
        // Invalid or missing API key — alert developer
        error_log('FinLayer auth failure: ' . $message);
    } elseif (str_contains($message, '[403]')) {
        // Wrong company ID — configuration error
        error_log('FinLayer company mismatch: ' . $message);
    } elseif (str_contains($message, '[404]')) {
        // Connector not set up — notify customer
        echo "Your TallyPrime connector is not connected. Please ensure the FinLayer Connector is running.";
    } elseif (str_contains($message, '[429]')) {
        // Rate limit — retry after delay
        sleep(30);
        $tb = $client->getTrialBalance('2024-04-01', '2025-03-31');
    } else {
        error_log('FinLayer unexpected error: ' . $message);
    }
}
```

---

## 7. SaaS Integration Checklist

### Before Integration

```
□  Obtain your company's FinLayer API key (fl_live_...)
□  Store the API key securely (environment variable, not hardcoded)
□  Never commit API keys to version control
□  Confirm your company ID with the FinLayer team
□  Verify the FinLayer Connector is installed on the customer's Windows machine
```

### First Integration Test

```
□  GET /companies/:companyId → 200 OK, connectorStatus = "ONLINE"
□  POST /companies/:companyId/sync → syncJobId returned, status = "QUEUED"
□  GET /companies/:companyId/sync-status → poll until currentSyncStatus = "IDLE"
□  GET /companies/:companyId/trial-balance → data returned, totals.isBalanced = true
□  GET /companies/:companyId/ledgers → chart of accounts populated
□  GET /companies/:companyId/vouchers → transactions available
```

### Production Readiness

```
□  API key stored as environment variable (FINLAYER_API_KEY)
□  Error handling implemented for 401, 403, 404, 429, 500
□  Retry logic with exponential backoff for 429 and transient failures
□  Sync polling has a timeout (recommended: 10 minutes)
□  Pagination implemented — never assume one page contains all records
□  Date filters used for large datasets (fromDate/toDate on vouchers)
□  For > 10,000 vouchers: use streaming mode (?stream=true)
□  Scheduled sync trigger (cron job or webhook) set up for regular refresh
```

### Ongoing Operations

```
□  Monitor lastSuccessfulSync.completedAt — alert if stale (> 24h)
□  Check connectorStatus — alert if "OFFLINE" (customer machine may be down)
□  Handle SYNC_FAILED in sync-status and surface errorSummary to support
□  Rotate API keys every 90 days
□  Log all FinLayer API errors for debugging
```

---

## Appendix — Environment Variables

```bash
# Required
FINLAYER_API_KEY=fl_live_your_key_here
FINLAYER_COMPANY_ID=cm1xyz789
FINLAYER_BASE_URL=https://api.finlayer.io/api/v1

# Optional sync tuning
FINLAYER_SYNC_POLL_INTERVAL_MS=5000    # Default: 5 seconds
FINLAYER_SYNC_TIMEOUT_MS=600000        # Default: 10 minutes
```

## Appendix — Data Types Reference

| Type | Format | Example |
|------|--------|---------|
| ID | CUID string | `cm1xyz789abc` |
| Date/Time | ISO 8601 UTC | `2024-09-24T11:45:00.000Z` |
| Date filter | `YYYY-MM-DD` | `2024-04-01` |
| Money | `number` (2 decimal places) | `50000.00` |
| Entry type | `"debit"` \| `"credit"` | `"debit"` |

---

*FinLayer API Documentation — For integration support, contact your FinLayer integration partner.*
