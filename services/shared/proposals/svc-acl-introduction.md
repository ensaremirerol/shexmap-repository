# Proposal: Shared additions for svc-acl introduction

**Requesting service:** svc-acl (new service, planned in `plans/svc-acl-introduction.md`)
**Date:** 2026-04-28
**Status:** IMPLEMENTED (Branch 1 of the svc-acl plan)

## What change is needed

Three additive, backwards-compatible additions to `@shexmap/shared` so the
forthcoming `svc-acl` service (and its consumers — svc-shexmap, svc-pairing)
can read/write Web Access Control (WAC) authorizations stored in a dedicated
SPARQL named graph in QLever.

1. **Two new RDF prefixes** in `src/rdf/prefixes.ts`:
   - `acl` — fixed external IRI `http://www.w3.org/ns/auth/acl#` (W3C WAC vocabulary).
   - `shexrauth` — derived from `baseNamespace` as `${base}resource/auth/`,
     follows the same pattern as the existing `shexrmap`, `shexruser`,
     `shexrpair`. This is the IRI namespace for `acl:Authorization` instances.
2. **`sparqlAsk` helper** in `src/sparql/client.ts`. ASK queries are required
   by svc-acl to check whether a given (resource, agent, mode) authorization
   exists — the existing `sparqlSelect` would work but is awkward for boolean
   results, and `sparqlAsk` matches the SPARQL protocol's native ASK form.
   Already exported from `src/index.ts` via `export * from './sparql/client.js'`.
3. **`proto/acl.proto`** — gRPC contract for the new svc-acl service.
   Defines `AclService` with five RPCs (`HasMode`, `GrantMode`, `RevokeMode`,
   `ListAuthorizations`, `PurgeResource`).

## Why it belongs in shared

- The two prefixes will be used by svc-acl (writer) and svc-shexmap +
  svc-pairing (readers, during their AuthZ check). All three services build
  their `Prefixes` map by calling `buildPrefixes(baseNamespace)` from shared,
  so the prefix list is the only correct place to add these.
- `sparqlAsk` is a generic SPARQL-protocol helper; it has no svc-acl-specific
  knowledge and is useful for any future service that needs ASK semantics.
- `acl.proto` is consumed by all three services that talk to svc-acl
  (the service itself implements it; svc-shexmap and svc-pairing import it
  as gRPC clients).

## Proposed change

### `src/rdf/prefixes.ts`

```ts
export function buildPrefixes(base: string = DEFAULT_BASE) {
  return {
    // ... existing entries unchanged ...
    shexrpair:    `${base}resource/pairing/`,
    shexrversion: `${base}resource/version/`,
    shexrauth:    `${base}resource/auth/`,           // NEW
    acl:    'http://www.w3.org/ns/auth/acl#',        // NEW
    shex:   'http://www.w3.org/ns/shex#',
    // ... rest unchanged ...
  } as const;
}
```

`Prefixes` is `ReturnType<typeof buildPrefixes>`, so the type updates
automatically. `sparqlPrefixes(prefixes)` iterates `Object.entries`, so the
new prefixes are emitted in PREFIX headers without any further change.

### `src/sparql/client.ts`

```ts
export async function sparqlAsk(
  client: SimpleClient,
  prefixes: Prefixes,
  query: string,
): Promise<boolean> {
  const fullQuery = `${sparqlPrefixes(prefixes)}\n${query}`;
  const res = await client.query.ask(fullQuery, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SPARQL ASK failed (${res.status}): ${body}`);
  }
  const data = await res.json() as SparqlAskResult;
  return data.boolean;
}
```

Mirrors the error-handling style of `sparqlSelect` (includes response body
in the error message). The `SparqlAskResult` interface already exists in
the file.

### `proto/acl.proto`

See §5.1.4 of `plans/svc-acl-introduction.md`. Five RPCs, six message types.
Field numbering starts at 1 for each message; no `reserved` numbers (new
file).

## Impact on other services

| Service | Impact |
|---|---|
| svc-validate    | None. Doesn't use prefixes or SPARQL. |
| svc-shexmap     | None for Branch 1. Branch 3 will start using `acl` + `shexrauth` prefixes and importing `acl.proto` as a gRPC client. |
| svc-pairing     | None for Branch 1. Branch 4 will mirror Branch 3. |
| svc-coverage    | None. |
| svc-schema      | None. |
| svc-auth        | None. |
| svc-sparql-proxy| None. |
| svc-gateway     | None for Branch 1. Branches 3/4 add HTTP routes that proxy to svc-shexmap/svc-pairing's new ACL RPCs; no direct svc-acl coupling. |
| svc-acl         | This is the new service that will be created in Branch 2. It depends on every artifact added here. |

The `sparqlPrefixes(prefixes)` output now contains two extra `PREFIX` lines.
This is harmless for every existing query — unused prefix declarations are
silently ignored by SPARQL endpoints.

## Acceptance

- `tsc --noEmit` (the shared package's `typecheck` script) passes.
- No existing service's tests fail (verified by running the relevant
  workspace tests after the change).

## Lifecycle

Per `services/shared/CLAUDE.md`, this proposal file should be deleted once
the changes are merged. Keeping it in the same commit as the implementation
for Branch 1 of the svc-acl plan; a follow-up housekeeping commit may
remove it.
