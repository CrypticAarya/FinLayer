# FinLayer

FinLayer turns locally stored Tally accounting data into a clean, secure API that authorized applications can consume.

## What FinLayer Does

Many businesses keep their accounting data inside Tally on a local Windows computer.

Applications that need this data should not have to understand:

* Tally XML
* TDL
* local port 9000
* Windows networking
* Tally version differences
* whether the customer's computer is online

FinLayer will sit between Tally and consuming applications.

High-level flow:

Tally
→ FinLayer Windows Agent
→ FinLayer Cloud
→ Normalized Accounting Data
→ FinLayer API
→ Authorized Applications

## First Consumer

Profitniti will be the first planned consumer of FinLayer.

However, FinLayer's core ingestion and accounting-data layer must remain application-independent.

Profitniti-specific financial intelligence must not be embedded into the core Tally ingestion layer.

## Core Direction

FinLayer is initially:

* Read-only
* Batch synchronized
* Push-only from the customer's machine
* API-first
* Built around PostgreSQL
* Designed for deterministic financial data processing

The initial synchronization target is approximately hourly.

Real-time synchronization is not currently required.

## Planned Architecture

Tally
→ Windows Agent
→ Ingest API
→ Raw Payload Store
→ Normalizer
→ Canonical Accounting Database
→ Deterministic Metrics
→ FinLayer API
→ Consuming Applications

## Technology Direction

Planned technologies:

Tally Spike:
TypeScript + Node.js

Cloud Backend:
TypeScript + Fastify

Database:
PostgreSQL 16

Database Migrations:
Plain SQL

Windows Agent:
Language decision deferred until after the Tally spike.

These technologies are not yet initialized.

## Current Status

The repository structure has been created.

No application code has been written yet.

The project is intentionally being built in small, reviewed steps to reduce architectural mistakes.

## Development Principle

Build the smallest thing that proves the next assumption.

Do not implement later stages before earlier assumptions have been tested.
