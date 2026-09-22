#!/usr/bin/env bash
# ==============================================================================
# FinLayer SaaS API — cURL Quickstart Integration Flow
# ==============================================================================
# Demonstrates:
# 1. API key authentication (Bearer and x-api-key)
# 2. Fetching company metadata
# 3. Fetching balanced Trial Balance
# 4. Fetching vouchers with cursor pagination and NDJSON streaming
# ==============================================================================

set -euo pipefail

# 1. Configuration (Set your credentials here or export in your environment)
FINLAYER_BASE_URL="${FINLAYER_BASE_URL:-http://localhost:4000/api/v1}"
FINLAYER_API_KEY="${FINLAYER_API_KEY:-fl_live_your_api_key_here}"
FINLAYER_COMPANY_ID="${FINLAYER_COMPANY_ID:-cmu84468l00001s3tnvjagcrz}"

echo "==================================================================="
echo " FinLayer SaaS API: cURL Integration Flow"
echo " Base URL:    ${FINLAYER_BASE_URL}"
echo " Company ID:  ${FINLAYER_COMPANY_ID}"
echo "==================================================================="
echo ""

# ─── Step 1: Authentication Header Check ──────────────────────────────────────
# You can authenticate using either 'Authorization: Bearer <key>' or 'x-api-key: <key>'
AUTH_HEADER="Authorization: Bearer ${FINLAYER_API_KEY}"

# ─── Step 2: Fetch Company Metadata ───────────────────────────────────────────
echo "[Step 1/3] Fetching Company Metadata..."
curl -sS -X GET "${FINLAYER_BASE_URL}/companies/${FINLAYER_COMPANY_ID}" \
  -H "${AUTH_HEADER}" \
  -H "Accept: application/json" | python3 -m json.tool || true

echo -e "\n-------------------------------------------------------------------\n"

# ─── Step 3: Fetch Trial Balance (Double-Entry Verification) ───────────────────
echo "[Step 2/3] Fetching Trial Balance..."
curl -sS -X GET "${FINLAYER_BASE_URL}/companies/${FINLAYER_COMPANY_ID}/trial-balance?startDate=2026-04-01&endDate=2027-03-31" \
  -H "${AUTH_HEADER}" \
  -H "Accept: application/json" | python3 -m json.tool || true

echo -e "\n-------------------------------------------------------------------\n"

# ─── Step 4: Fetch Vouchers (Cursor Paginated) ─────────────────────────────────
echo "[Step 3/3] Fetching First Page of Vouchers (limit=5)..."
curl -sS -X GET "${FINLAYER_BASE_URL}/companies/${FINLAYER_COMPANY_ID}/vouchers?limit=5" \
  -H "${AUTH_HEADER}" \
  -H "Accept: application/json" | python3 -m json.tool || true

echo -e "\n-------------------------------------------------------------------\n"

# ─── Bonus: High-Speed Streaming Vouchers (NDJSON) ────────────────────────────
echo "[Bonus] Streaming Vouchers via NDJSON (first 2 lines shown)..."
curl -sS -X GET "${FINLAYER_BASE_URL}/companies/${FINLAYER_COMPANY_ID}/vouchers?stream=true" \
  -H "${AUTH_HEADER}" \
  -H "Accept: application/x-ndjson" | head -n 2 || true

echo -e "\n\nDone."
