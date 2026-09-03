# FinLayer Tally Spike Environment

This document records the environment strategy for testing FinLayer against Tally.

No production integration code should be written until we have an environment where the relevant Tally behaviour can actually be observed.

## Development Machine

Current development machine:

MacBook Pro M4
Apple Silicon / ARM64

Tally is a Windows desktop application.

Tally's documented Windows requirements are based on 64-bit Windows and x64 processors.

Therefore, running Tally inside ARM Windows on Apple Silicon must be treated as an experiment rather than assumed production compatibility.

## Environment Strategy

Use the following order.

### Stage 1: Local ARM Windows Feasibility Test

Create a Windows 11 ARM virtual machine on the MacBook.

Possible virtualization options include:

* Parallels Desktop
* UTM

The purpose of this environment is ONLY to answer:

1. Does TallyPrime install?
2. Does TallyPrime launch?
3. Can a company be created or loaded?
4. Does the local HTTP integration interface respond?
5. Can the spike application communicate with it?

If any of these fail due to ARM/x64 compatibility, stop using this environment for the Tally spike.

Do not spend significant engineering time trying to work around emulator-specific failures.

### Stage 2: x64 Windows Environment

If ARM Windows is unsuitable, use a real x64 Windows environment.

Possible environments:

* physical Windows x64 computer
* x64 Windows cloud/VPS machine
* other production-representative x64 Windows test machine

This environment becomes mandatory later for testing:

* Windows Service behaviour
* sleep/wake behaviour
* startup
* antivirus interaction
* installer behaviour
* upgrades
* local buffering
* network failures
* service recovery

## Tally Licensing Strategy

Use the least expensive environment that proves the next assumption.

### Educational Mode

Educational mode may be useful for basic integration experiments.

However, do not assume the local HTTP integration interface works in educational mode until it is tested.

Educational mode also restricts transaction dates, so it is not sufficient for realistic time-series testing such as:

* ageing
* period comparisons
* back-dated voucher scenarios across arbitrary dates

### Full Trial

Tally currently provides a limited-time full-feature trial.

Do not activate the trial simply because it is available.

Use it deliberately after the basic environment has been proven.

During the full-feature trial, prioritize harvesting representative raw responses for:

* companies
* ledgers
* voucher types
* vouchers
* Trial Balance
* inventory
* bill allocations
* change-detection experiments

Save useful raw responses immediately.

## Production Validation Rule

Successful execution under ARM Windows emulation does NOT prove that the FinLayer Windows Agent is production-ready.

Before production release, FinLayer must be validated on a normal x64 Windows environment representative of customer machines.

## Current Questions

The environment spike must answer these questions before production agent work:

1. Does TallyPrime install and launch under Windows ARM emulation?
2. Does Tally's local HTTP interface work in that environment?
3. Does the HTTP interface work in Educational Mode?
4. If ARM emulation fails, which x64 Windows environment will be used?
5. Can useful raw samples be harvested before production schema design begins?

## Decision Rule

Use the Mac/ARM environment if it is sufficient for learning Tally's API behaviour.

Do not treat emulator-specific success or failure as evidence about normal x64 customer machines.

When the environment blocks meaningful testing, move to x64 Windows instead of engineering around the emulator.
