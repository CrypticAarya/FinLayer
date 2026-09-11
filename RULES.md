

# FinLayer Engineering Rules

These rules apply to all future development work on FinLayer.

## 1. Build in Small Steps

Build the smallest thing that proves the next assumption.

Do not implement future stages early.

Before making a large architectural change, explain why it is necessary.

Do not modify multiple architectural concerns in one step unless explicitly instructed.

## 2. FinLayer Is Read-Only

Data flows:

Tally → FinLayer

FinLayer must not write accounting data back into Tally.

Do not introduce write-back logic unless this requirement is explicitly changed.

## 3. Synchronization Is Batch-Based

The initial target is approximately hourly synchronization.

Real-time synchronization is not required.

Do not introduce:

* WebSockets
* persistent command channels
* real-time event infrastructure
* persistent reconnect state machines for long-lived real-time connections

unless explicitly required later.

## 4. The Windows Agent Is Push-Only

The FinLayer Windows Agent will initiate outbound HTTPS connections to FinLayer Cloud.

FinLayer Cloud must not require inbound access to the customer's Windows machine.

Do not expose Tally port 9000 to the public internet.

## 5. Store Raw Before Parsing

Every payload received from Tally must eventually be stored verbatim before normalization.

The raw payload is the source material used for reprocessing if a parser or mapping is later found to be incorrect.

Do not discard raw Tally responses after parsing.

## 6. Deterministic Financial Data

Authoritative accounting values and financial metrics must be calculated using SQL or application code.

An LLM may explain, summarize, or interpret already-computed figures.

An LLM must not be used to calculate authoritative accounting numbers from raw Tally transactions.

## 7. Never Use Floating Point for Money

Money must use decimal or PostgreSQL numeric types.

Never use float or double for authoritative financial values.

## 8. Keep the Architecture Simple

Do not introduce the following unless explicitly approved:

* Kubernetes
* service meshes
* microservices
* Redis
* RabbitMQ
* Kafka
* SQS
* GraphQL
* tRPC
* event sourcing
* CQRS
* external authentication providers
* ORMs
* unnecessary caching layers

Expected initial scale is under 500 connected Tally machines.

PostgreSQL should be preferred for persistence and simple background work.

If a database-backed queue is required, use PostgreSQL with:

SELECT ... FOR UPDATE SKIP LOCKED

## 9. Technology Direction

Planned technology direction:

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

Do not replace these choices without explaining the reason first.

## 10. Tally Behaviour Must Be Verified

Do not invent undocumented Tally API behaviour.

When uncertain about a Tally API detail, stop and identify it as an open question rather than inventing behaviour.

Important known concepts include:

* MASTERID
* ALTERID

MASTERID appears to be an important stable identity primitive.

ALTERID appears to be an important change-detection primitive.

However, do not assume that the highest ALTERID alone is a complete incremental synchronization cursor.

The incremental synchronization strategy must be experimentally verified.

Test at minimum:

* new voucher creation
* voucher editing
* back-dated voucher editing
* voucher deletion
* ledger rename
* company switching

Do not use editable names such as ledger names as permanent record identity.

## 11. Do Not Build the Windows Agent Yet

Production Windows Agent implementation and language selection are intentionally deferred until after real Tally behaviour has been tested.

Production Windows Agent code must not be written until a Windows environment with a working Tally installation is available for testing.

The `agent/` directory must remain implementation-free until that condition is met.

Untested agent code must not be treated as completed work.

## 12. Preserve Application Independence

Profitniti is the first planned consumer of FinLayer.

However, FinLayer's ingestion and canonical accounting-data layers must remain application-independent.

Do not embed Profitniti-specific reporting or AI behaviour into the core Tally ingestion layer.

## 13. Prefer Evidence Over Assumption

When there is uncertainty:

1. Identify the assumption.
2. Design the smallest experiment that can test it.
3. Record the result.
4. Only then build dependent functionality.

Do not compensate for uncertainty by adding abstractions or infrastructure.
