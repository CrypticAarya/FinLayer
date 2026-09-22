#!/usr/bin/env python3
"""
FinLayer SaaS API — Python Integration Quickstart

Demonstrates:
1. API key authentication using standard library (urllib.request)
2. Fetching company metadata
3. Fetching and validating Trial Balance
4. Fetching vouchers with cursor pagination

Usage:
  python3 quickstart.py
"""

import os
import sys
import json
import urllib.request
import urllib.error

BASE_URL = os.getenv("FINLAYER_BASE_URL", "http://localhost:4000/api/v1")
API_KEY = os.getenv("FINLAYER_API_KEY", "fl_live_your_api_key_here")
COMPANY_ID = os.getenv("FINLAYER_COMPANY_ID", "cmu84468l00001s3tnvjagcrz")


def request(endpoint: str) -> dict:
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Accept": "application/json",
            "User-Agent": "FinLayer-Python-Quickstart/2.2",
        },
    )
    try:
        with urllib.request.urlopen(req) as response:
            data = response.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(error_body)
            msg = parsed.get("error", e.reason)
        except Exception:
            msg = error_body or e.reason
        raise RuntimeError(f"API Error [{e.code}]: {msg}")


def main():
    print("===================================================================")
    print(" FinLayer SaaS API: Python Integration Quickstart")
    print(f" Base URL:    {BASE_URL}")
    print(f" Company ID:  {COMPANY_ID}")
    print("===================================================================\n")

    try:
        # ─── 1. Fetch Company Details ─────────────────────────────────────────
        print("[1/3] Fetching Company Metadata...")
        company_res = request(f"/companies/{COMPANY_ID}")
        company = company_res["data"]
        print(f"  ✓ Company Name:   \"{company['name']}\"")
        print(f"  ✓ Tally System:   {company.get('tallyCompanyName') or 'N/A'}")
        print(f"  ✓ Sync Status:    {company.get('connectorStatus') or 'ONLINE'}")
        print(f"  ✓ Last Sync At:   {company.get('lastSyncAt') or 'Real-time'}\n")

        # ─── 2. Fetch Trial Balance & Verify Double-Entry Equation ─────────────
        print("[2/3] Fetching Trial Balance...")
        tb_res = request(f"/companies/{COMPANY_ID}/trial-balance")
        totals = tb_res["totals"]
        ledgers = tb_res["data"]
        diff = abs(totals["debitTotal"] - totals["creditTotal"])

        print(f"  ✓ Accounts Count: {len(ledgers)}")
        print(f"  ✓ Total Debit:    ₹ {totals['debitTotal']:.2f}")
        print(f"  ✓ Total Credit:   ₹ {totals['creditTotal']:.2f}")
        print(f"  ✓ Net Difference: ₹ {diff:.2f}")
        is_balanced = totals.get("isBalanced", diff < 0.01)
        status_text = "BALANCED (Debit === Credit)" if is_balanced else "UNBALANCED"
        print(f"  ✓ Balance Status: {status_text}\n")

        # ─── 3. Fetch Vouchers with Cursor Pagination ─────────────────────────
        print("[3/3] Fetching Vouchers (first page, limit=5)...")
        vouchers_res = request(f"/companies/{COMPANY_ID}/vouchers?limit=5")
        vouchers = vouchers_res["data"]
        pagination = vouchers_res["pagination"]

        print(f"  ✓ Vouchers Count: {len(vouchers)} (total: {pagination.get('totalCount', len(vouchers))})")
        print(f"  ✓ Has Next Page:  {pagination.get('hasMore')}")
        if pagination.get("nextCursor"):
            print(f"  ✓ Next Cursor:    \"{pagination['nextCursor']}\"")

        if vouchers:
            sample = vouchers[0]
            print("\n  Sample Voucher:")
            print(f"    Number: #{sample['voucherNumber']} ({sample['voucherType']})")
            print(f"    Date:   {sample['date']}")
            print(f"    Amount: ₹ {sample['amount']:.2f}")
            print("    Legs:")
            for entry in sample.get("entries", []):
                print(f"      • [{entry['type'].upper()}] {entry['ledgerName']:<24} ₹ {entry['amount']:.2f}")

        print("\n===================================================================")
        print(" SUCCESS: FinLayer SaaS API integration verified successfully!")
        print("===================================================================\n")

    except Exception as err:
        print(f"\n❌ Integration flow failed: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
