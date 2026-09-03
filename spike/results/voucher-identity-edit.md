# Voucher Identity Edit Experiment

## Environment

TallyPrime: 7.1
Mode: Educational
Company: FinLayer Test Company
Voucher Type: Payment
Date: 1-Apr-2026

## Before Edit

MASTERID: 2
ALTERID: 2

Ledger Entries:

Finlayer Identity Rename: -100.00
Cash: 100.00

## After Edit

The voucher amount was changed from 100 to 125.

MASTERID: 2
ALTERID: 4

Ledger Entries:

Finlayer Identity Rename: -125.00
Cash: 125.00

## Observed Result

MASTERID remained unchanged across the voucher amount edit.

ALTERID changed from 2 to 4.

The ledger entries remained balanced.

In this experiment, voucher MASTERID behaved like a stable identity primitive and ALTERID behaved like a change signal.

Tally's raw ledger-entry amount signs were preserved exactly as returned.

## Important Limits

This experiment does NOT prove:

- MASTERID behaviour across voucher deletion
- MASTERID uniqueness across Tally companies
- ALTERID global ordering guarantees
- ALTERID increment size
- that maximum ALTERID is a safe synchronization cursor
- backdated edit behaviour
- cancellation behaviour
- deletion behaviour
