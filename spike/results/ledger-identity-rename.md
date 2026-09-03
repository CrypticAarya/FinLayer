# Ledger Identity Rename Experiment

## Environment

TallyPrime: 7.1
Mode: Educational
Company: FinLayer Test Company
Tally endpoint: Windows VM port 9000
FinLayer spike executed from macOS

## Before Rename

Name: Finlayer Identity Test
Parent: Indirect Expenses
MASTERID: 206
ALTERID: 208

## After Rename

Name: Finlayer Identity Rename
Parent: Indirect Expenses
MASTERID: 206
ALTERID: 210

## Observed Result

MASTERID remained unchanged across the ledger rename.

ALTERID changed when the ledger was renamed.

The editable ledger name therefore cannot be used as permanent identity.

In this experiment, MASTERID behaved like a stable identity primitive and ALTERID behaved like a change signal.

## Important Limits

This experiment does NOT prove:

- MASTERID behaviour for vouchers or other master types
- MASTERID uniqueness across different Tally companies
- deletion behaviour
- ALTERID ordering guarantees
- ALTERID increment size
- that maximum ALTERID is a safe incremental synchronization cursor

Those require separate experiments.
