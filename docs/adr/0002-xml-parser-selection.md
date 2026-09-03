# ADR 0002: XML Parser Selection

## Context

FinLayer Connector receives XML responses from TallyPrime.
The connector needs to transform Tally XML into internal application objects.

## Decision

Use a dedicated XML parsing library instead of manual XML string parsing.

## Reason

Manual XML parsing would be fragile and difficult to maintain as Tally responses become more complex.

A parser library provides:
- XML to object conversion
- Attribute handling
- Nested structure support

## Consequences

The connector will have an external dependency for XML parsing, but gains reliability and maintainability.

## Status

Accepted
