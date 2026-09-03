# FinLayer Connector Architecture

## Overview

FinLayer Connector is a TallyPrime synchronization engine designed to allow SaaS applications to consume Tally data without requiring users to manually export and upload files.

The current version implements a read-only synchronization flow:

- Connect to TallyPrime
- Fetch ledger data
- Parse XML responses
- Compare current data with previous sync state
- Detect created, updated, and unchanged records
- Store synchronization state

---

## System Architecture

```text
TallyPrime
    |
    | XML Request / Response
    |
FinLayer Connector
    |
    ├── tally/
    |     |
    |     ├── requests.ts
    |     |       Creates XML requests for Tally
    |     |
    |     ├── client.ts
    |     |       Handles HTTP communication with Tally
    |     |
    |     └── parser.ts
    |             Converts XML responses into application objects
    |
    ├── sync/
    |     |
    |     ├── ledger-sync.ts
    |     |       Compares previous and current ledger data
    |     |
    |     └── sync-runner.ts
    |             Runs complete synchronization workflow
    |
    └── state/
          |
          └── state-store.ts
                  Stores previous synchronization state
```

---

## Data Flow

### 1. Request Generation

The connector creates an XML request asking TallyPrime for ledger information.

Flow:

```text
requests.ts
      |
      ↓
XML Request
```

### 2. Communication Layer

The client layer sends the XML request to TallyPrime using HTTP.

Flow:

```text
client.ts

XML Request
      |
      ↓
TallyPrime
      |
      ↓
XML Response
```

### 3. Parsing Layer

Tally returns XML data.

Example:

```xml
<LEDGER NAME="Cash">
    <MASTERID>31</MASTERID>
    <ALTERID>32</ALTERID>
</LEDGER>
```

The parser converts it into:

```json
{
  "name": "Cash",
  "masterId": 31,
  "alterId": 32
}
```

---

## Synchronization Logic

FinLayer uses two foundational identifiers provided by TallyPrime to track identity and changes:

### MASTERID

Used as the permanent identity of a record.

Example:

Cash Ledger  
`MASTERID: 31`

### ALTERID

Used as the version and change tracker.

Example:

Before modification:
- `MASTERID: 31`
- `ALTERID: 32`

After modification:
- `MASTERID: 31`
- `ALTERID: 33`

### Detection Rules

- **Same MASTERID + changed ALTERID** = Updated record
- **Same MASTERID + same ALTERID** = Unchanged record
- **New MASTERID** = Created record

---

## Sync Result Types

The comparison produces three outputs:

### Created

New records found in Tally that were not present in previous sync state.

### Updated

Existing records where `MASTERID` exists in previous sync state but `ALTERID` has changed.

### Unchanged

Records where both identity (`MASTERID`) and version (`ALTERID`) remain identical.

Example output:

```json
{
  "created": [],
  "updated": [],
  "unchanged": []
}
```

---

## Complete Sync Workflow

```text
runLedgerSync()
        |
        ↓
Generate Tally XML Request
        |
        ↓
Send Request To Tally
        |
        ↓
Receive XML Response
        |
        ↓
Parse XML Into Ledger Objects
        |
        ↓
Load Previous Sync State
        |
        ↓
Compare Current And Previous Data
        |
        ↓
Generate Sync Result
        |
        ↓
Save Latest State
```

---

## Current Capabilities

- TallyPrime XML communication over HTTP
- Ledger data fetching using TDL collection requests
- XML response parsing and attribute extraction
- Ledger object transformation
- Incremental change detection via `MASTERID` and `ALTERID`
- Created / Updated / Unchanged classification
- Local synchronization state persistence

---

## Future Roadmap

### Multi-company Support

Current:
`sync-state.json`

Future:
```text
data/
 └── states/
      ├── company-a.json
      ├── company-b.json
```

### Scheduled Synchronization

Future support:
- Manual sync trigger
- 15 minute sync interval
- Hourly sync interval
- Custom sync intervals

### SaaS Backend Integration

Future architecture:

```text
TallyPrime
    ↓
FinLayer Connector
    ↓
SaaS Backend API
    ↓
Database
    ↓
Analytics/Application
```
