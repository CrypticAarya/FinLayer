# FinLayer Tally Spike

This directory is for throwaway experiments against a real Tally installation.

The purpose of the spike is to learn what Tally actually does before FinLayer's production schema, synchronization logic, or Windows Agent is designed.

Code created inside the spike is experimental and must not automatically be promoted into production code.

## Primary Goal

Prove that FinLayer can reliably read the Tally data needed for later ingestion.

We must observe real Tally responses rather than design against assumptions.

## Environment Requirement

The integration experiments must run against an actual Tally installation.

Production Windows Agent development must not begin until the required Tally behaviour can be tested.

The initial development machine is a MacBook Pro M4, so Windows/Tally compatibility must be tested separately.

## Experiment Sequence

Run the experiments in this order.

Do not jump directly to fetching all accounting data.

### Experiment 1: Tally Reachability

Prove that a program can reach the local Tally HTTP interface.

Record:

* whether Tally is running
* whether the configured port responds
* what happens when Tally is closed
* what happens when no company is loaded
* what response or error is returned

Do not assume behaviour in advance.

### Experiment 2: Company Discovery

Determine how to identify the currently loaded Tally company.

Record the raw response.

Verify behaviour when:

* one company is loaded
* a different company is loaded
* no company is loaded

The goal is to prevent FinLayer from silently synchronizing the wrong company.

### Experiment 3: Ledger Collection

Fetch a small ledger collection.

Determine which identity and change-related fields are actually returned.

Specifically inspect whether fields such as:

* MASTERID
* ALTERID
* ledger name
* parent/group information

are available in the response being used.

Do not use ledger name as permanent identity.

### Experiment 4: Voucher Collection

Fetch a small set of vouchers.

Inspect the raw structure before designing database tables.

Look for:

* voucher identity
* voucher type
* voucher number
* date
* party ledger
* ledger entries
* amounts
* inventory allocations where present
* bill allocations where present
* MASTERID
* ALTERID

Do not assume every voucher type has the same shape.

### Experiment 5: Trial Balance

Fetch Tally's Trial Balance or equivalent source data needed for reconciliation.

Save the raw response.

This will later be used to compare FinLayer's normalized balances against Tally's own values.

### Experiment 6: Change Detection

Create a controlled test voucher.

Observe relevant identifiers.

Then:

1. edit the voucher
2. record what changes
3. make a back-dated edit
4. record what changes
5. delete the voucher
6. observe whether and how deletion can be detected

The purpose is to determine whether MASTERID, ALTERID, or another mechanism can safely support incremental synchronization.

Do not assume that maximum ALTERID alone is sufficient.

### Experiment 7: Ledger Rename

Create or identify a test ledger.

Record its identity-related fields.

Rename it.

Fetch it again.

Verify whether its stable identity remains unchanged.

This experiment exists because FinLayer must not create duplicate ledgers when users rename them.

### Experiment 8: Company Switching

With more than one test company available:

1. fetch data from Company A
2. switch Tally to Company B
3. repeat the same request
4. determine how FinLayer can identify that the active company changed

The future agent must not silently upload Company B data under Company A's FinLayer connection.

## Raw Sample Policy

Every useful raw Tally response from the spike should eventually be saved before parsing.

Use:

`spike/samples/private/`

for real, sensitive, or customer-derived data.

Use:

`spike/samples/local/`

for temporary machine-specific experiments.

Use:

`spike/samples/fixtures/`

only for carefully anonymized samples that are safe to commit and use in automated tests.

Never copy real customer accounting data into `fixtures/`.

## What the Spike Must NOT Build

Do not build:

* the production Windows Agent
* the production FinLayer API
* database schema
* database migrations
* normalization pipeline
* metrics engine
* background workers
* authentication
* installer
* auto-update system

Those depend on what we learn here.

## Exit Criteria

The spike is complete only when we have evidence for:

* Tally reachability behaviour
* company detection behaviour
* ledger response structure
* voucher response structure
* Trial Balance response structure
* stable identity behaviour
* edit behaviour
* back-dated edit behaviour
* deletion behaviour
* ledger rename behaviour
* company switching behaviour

We should also have representative raw samples stored for future parser development.

Only after reviewing these results should FinLayer's canonical database schema and incremental synchronization strategy be designed.

## Guiding Rule

When observed Tally behaviour conflicts with an assumption, the observed behaviour wins.
