# shared — @shexmap/shared

Internal workspace package. Never deployed standalone. Every service imports from here.

---

## ⚠️ Governance — DO NOT modify this package directly

This package is a **shared contract** between all services. Uncoordinated changes break multiple services simultaneously.

**If you are a service agent** (working inside `svc-validate`, `svc-shexmap`, etc.) and you need a change to this package:

1. **Do not edit any file in `services/shared/`.**
2. Create a proposal file at `services/shared/proposals/<your-service>-<short-description>.md`.
3. The shared agent (a Claude Code session opened at `services/shared/`) will review the proposal, evaluate impact across all consumers, and implement it if feasible.

See [Proposal format](#proposal-format) below.

---

## Contents

| Path | Purpose |
|------|---------|
| `proto/validate.proto` | gRPC contract for svc-validate |
| `proto/shexmap.proto`  | gRPC contract for svc-shexmap |
| `proto/pairing.proto`  | gRPC contract for svc-pairing (imports shexmap.proto) |
| `proto/coverage.proto` | gRPC contract for svc-coverage |
| `proto/schema.proto`   | gRPC contract for svc-schema |
| `src/rdf/prefixes.ts`  | RDF prefix map + SPARQL PREFIX builder |
| `src/sparql/client.ts` | `sparqlSelect`, `sparqlUpdate`, `sparqlAsk` helpers |
| `src/types/index.ts`   | Wire-format TypeScript interfaces + `AuthContext` |
| `proposals/`           | Pending change requests from service agents |

---

## Rules for the shared agent

When a proposal arrives in `proposals/`:

1. **Read the proposal** — understand the requested change, which service needs it, and why.
2. **Assess impact** — check every other service's CLAUDE.md and existing code to find all consumers of the changed element.
3. **Evaluate feasibility**:
   - Is the change backwards-compatible? (adding optional fields, new RPC methods → usually yes)
   - Does it break existing callers? (removing fields, changing types → usually no, must negotiate)
   - Does it belong in `shared` or should it stay private to the requesting service?
4. **If approved**: implement the change, update all affected proto files and TypeScript types, document the change in the proposal file with `STATUS: APPROVED`, commit.
5. **If rejected**: write the reason in the proposal file with `STATUS: REJECTED` and suggest an alternative (e.g., "keep this type private to svc-shexmap").
6. **Delete the proposal file** after resolving it and communicating the result back.

---

## Proposal format

Create `services/shared/proposals/<svc-name>-<description>.md`:

```markdown
# Proposal: <short title>

**Requesting service:** svc-<name>
**Date:** YYYY-MM-DD

## What change is needed

Describe the new type, field, helper, or proto change required.

## Why it belongs in shared

Explain why this cannot stay private to your service (e.g., svc-gateway needs the same type to translate the response, or svc-pairing references the same message).

## Proposed change

```ts
// New field in src/types/index.ts:
export interface ShExMap {
  // ... existing fields ...
  newField?: string;  // <-- add this
}
```

Or for proto:
```proto
// In shexmap.proto, message ShexMap:
string new_field = 19;  // <-- add this
```

## Impact on other services

List which services consume the changed element and whether they need updates.
```

---

## Design rules (for the shared agent)

- **No Zod schemas.** Each service owns its own input validation.
- **No config reads at module level.** `buildPrefixes(base)` takes `base` as a parameter — services pass it from their own `config.ts`.
- **No runtime Fastify dependency.** `sparqlClient.ts` takes a `SimpleClient` instance, not a `FastifyInstance`.
- **Proto field numbering is permanent.** Never reuse a field number. Mark unused fields as `reserved`. Add new fields at the end with the next available number.
- **Additive changes only.** New optional fields and new RPC methods are backwards-compatible. Removing or renaming fields requires a migration plan.

---

## AuthContext

`AuthContext` is passed as gRPC **metadata** (not a proto message field) so it threads through every call without touching the service's business-logic proto contract.

```
Metadata keys (constants exported from src/types/index.ts as AUTH_META):
  x-auth-user-id    — user UUID string, empty string = anonymous
  x-auth-role       — "anonymous" | "user" | "admin"
  x-auth-enabled    — "true" | "false"
```

Read them in a service:
```ts
import { AUTH_META, type AuthContext } from '@shexmap/shared';
import type * as grpc from '@grpc/grpc-js';

export function readAuth(metadata: grpc.Metadata): AuthContext {
  return {
    userId:      String(metadata.get(AUTH_META.USER_ID)[0]  ?? ''),
    role:        (metadata.get(AUTH_META.ROLE)[0] ?? 'anonymous') as AuthContext['role'],
    authEnabled: metadata.get(AUTH_META.AUTH_ENABLED)[0] === 'true',
  };
}
```

---

## SPARQL client usage

```ts
import { createSparqlClient, sparqlSelect, sparqlUpdate, buildPrefixes } from '@shexmap/shared';

const client   = createSparqlClient(sparqlUrl, updateUrl, accessToken);
const prefixes = buildPrefixes(config.baseNamespace);

const rows = await sparqlSelect(client, prefixes, `SELECT ...`);
await sparqlUpdate(client, prefixes, `INSERT DATA { ... }`);
```
