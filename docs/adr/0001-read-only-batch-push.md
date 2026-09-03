# ADR 0001: Read-Only, Batch, Push-Only Tally Integration

## Status

Accepted

## Context

FinLayer needs to move accounting data from Tally installations running on customer-owned Windows computers into FinLayer Cloud.

Tally runs locally on the customer's machine.

The customer's machine cannot be assumed to:

* have a public IP address
* accept inbound internet connections
* remain powered on continuously
* have Tally running continuously
* have the correct Tally company loaded continuously

FinLayer's initial use cases do not require real-time synchronization.

The initial synchronization target is approximately hourly.

FinLayer is intended to provide clean accounting data to authorized consuming applications.

Profitniti will be the first planned consumer, but the FinLayer ingestion and canonical accounting layers must remain application-independent.

## Decision

FinLayer will use a read-only, batch, push-only integration architecture.

### Read-Only

Data flows from Tally to FinLayer.

FinLayer will not write accounting data back into Tally.

### Batch Synchronization

The initial synchronization target is approximately hourly.

FinLayer will not require real-time event streaming or persistent connections.

### Push-Only Windows Agent

A Windows Agent running on the customer's computer will eventually read data from the local Tally installation.

The agent will initiate outbound HTTPS requests to FinLayer Cloud.

FinLayer Cloud will not initiate inbound connections to the customer's computer.

Tally's local integration port must not be exposed to the public internet.

### Raw Before Normalization

Every payload received from Tally must be stored verbatim before parsing or normalization.

This allows FinLayer to reprocess historical payloads if a parser or mapping is later found to be incorrect without requiring the customer's Tally installation to be contacted again.

### Deterministic Financial Processing

Authoritative accounting values and financial metrics must be computed using SQL or application code.

AI systems may explain or interpret computed values but must not calculate authoritative financial figures directly from raw accounting transactions.

### Simple Infrastructure

The initial architecture will favor:

* one cloud API
* one Windows Agent
* PostgreSQL
* plain SQL migrations
* simple PostgreSQL-backed background processing where required

Complex distributed infrastructure will not be introduced without demonstrated need.

## Consequences

### Advantages

* Customer routers and firewalls do not require inbound configuration.
* Tally port 9000 does not need to be publicly exposed.
* Temporary internet outages can be handled by retrying future outbound synchronization.
* FinLayer does not require a persistent connection to customer machines.
* Raw payload retention allows parser bugs to be corrected through reprocessing.
* The architecture remains understandable for a small engineering team.
* Read-only integration removes the complexity and risk associated with writing accounting data back into Tally.

### Limitations

* Data may be stale until the next successful synchronization.
* Synchronization cannot occur while the customer's computer or Tally is unavailable.
* A Windows Agent must eventually be installed and maintained on customer machines.
* Tally version differences will need to be handled.
* Incorrect company selection in Tally may prevent or invalidate synchronization.
* Retry, local buffering, diagnostics, installer behaviour, upgrades, and Windows operational issues will eventually need to be handled by the agent.

## Open Questions

The following are intentionally not decided by this ADR:

* exact incremental synchronization algorithm
* exact use of MASTERID and ALTERID
* deletion detection
* Tally version-specific extraction behaviour
* Tally educational-mode HTTP behaviour
* Windows ARM emulation compatibility
* final canonical accounting schema
* final public FinLayer API schema

These must be verified or designed in later steps.

In particular, do not assume that the highest ALTERID alone is a complete incremental synchronization cursor.

## Decision Boundary

This ADR decides the direction of communication and synchronization architecture.

It does not define:

* the database schema
* Tally XML requests
* API endpoints
* Windows Agent implementation
* public authentication design
* Profitniti financial metrics

Those decisions will be made separately after relevant assumptions have been tested.
