# Plan — Introduce `svc-acl` (WAC-based ACL service)

**Status:** DRAFT — awaiting approval before assignment
**Author:** Claude (drafted from spike + design discussion)
**Date:** 2026-04-28

---

## 1. Motivation

Today, ownership-based AuthZ is enforced inline in `services/svc-shexmap/src/server.ts` and `services/svc-pairing/src/server.ts`. There is no way for an owner to grant edit access to another user — only ownership and a planned `admin` role bypass the check. This plan introduces a separate **`svc-acl`** service that stores W3C **Web Access Control (WAC)** authorizations in a dedicated SPARQL named graph, and an integration path that lets svc-shexmap and svc-pairing consult it during their existing Tier-2 AuthZ block.

## 2. Why a separate service

A separate svc-acl is preferred over inlining ACL logic into svc-shexmap and svc-pairing because:

| Benefit | What it buys us |
|---|---|
| Single owner of the ACL graph | One service writes `<https://w3id.org/shexmap/acl>`; everyone else reads only via its API. Storage layout can change without rippling through callers. |
| Reuse across resource services | svc-shexmap and svc-pairing both consult the same `HasMode` RPC instead of duplicating SPARQL ASK queries. |
| Future-proof for new resource types | Schemas, datasets, etc. all become just another `acl:accessTo` IRI; no per-service ACL plumbing. |
| Clean swap path | We can later add caching, audit logs, or move to a different store without touching consumer services. |

The cost is one extra gRPC hop on every Update/Delete/SaveVersion AuthZ check. Measured baseline: gRPC inside Docker network + QLever ASK ≈ sub-millisecond. Acceptable for our scale.

## 3. Architectural decisions (locked)

These are settled by the spike (`scripts/probe-named-graphs.sh`, results 2026-04-28) and the design discussion preceding this plan. They are NOT open questions for the implementing agent.

### 3.1 Storage: single named graph, WAC vocabulary

```
GRAPH <https://w3id.org/shexmap/acl> {
  shexrauth:<uuid>
      a               acl:Authorization ;
      acl:accessTo    <resource-iri> ;
      acl:agent       <user-iri> ;
      acl:mode        acl:Write .
}
```

- One global ACL graph, **not** one per resource.
- Authorization nodes get stable IRIs (UUIDs under `shexrauth:`), **not** blank nodes — simplifies revocation queries.
- Only `acl:Write` mode is implemented in v1. The API takes a mode string so `Read`/`Append`/`Control` can be added later without schema changes.
- The `dct:creator` ownership triple stays where it is; ACL is *additional* grants, not a replacement for ownership.

### 3.2 Service boundaries

- **svc-acl owns the ACL graph.** No other service writes to `<…/acl>`.
- **svc-acl does NOT enforce who-can-modify-the-ACL.** The owner check is upstream's responsibility (in svc-shexmap/svc-pairing's existing Tier-2 block). svc-acl trusts its callers because it sits behind the gateway on the internal Docker network.
- **svc-acl is read by svc-shexmap and svc-pairing during their AuthZ check.** A `HasMode` gRPC call replaces / augments the existing inline check.
- **svc-acl is written by svc-shexmap and svc-pairing only.** When a user calls `POST /api/v1/shexmaps/:id/acl`, the request hits svc-shexmap, which performs the owner check, then forwards `GrantMode` to svc-acl.

### 3.3 Lifecycle

- When a resource is deleted, the *resource service* (svc-shexmap or svc-pairing) calls `svc-acl.PurgeResource(resourceIri)` to clean up dangling authorizations. svc-acl never observes resource lifecycle events itself.

## 4. Branch structure

Five branches, each independently testable and mergeable. Following the user instruction `feedback_branching` (one task per branch).

| Branch | Title | What it adds | Reviewable in isolation? |
|---|---|---|---|
| 1 | `feature/acl-shared-additions` | Shared package: `acl` + `shexrauth` prefixes, `sparqlAsk` helper, `acl.proto` | Yes — additive, no consumers yet |
| 2 | `feature/svc-acl-skeleton` | New svc-acl with helpers + handlers + tests + docker-compose entry | Yes — service runs but nothing calls it |
| 3 | `feature/svc-shexmap-acl-integration` | svc-shexmap consults svc-acl in AuthZ + exposes Grant/Revoke/List RPCs + gateway routes | Yes — pairings still work without ACL |
| 4 | `feature/svc-pairing-acl-integration` | Same pattern for pairings | Yes |
| 5 | `feature/acl-frontend-ui` | "Manage access" panel + React Query hooks + Playwright e2e | Yes — backend already complete |

Branches 1 → 2 → (3 ‖ 4) → 5. Branches 3 and 4 can be done in parallel by separate agents if desired.

---

## 5. Branch 1 — `feature/acl-shared-additions`

Shared-package additions. Per `services/shared/CLAUDE.md` governance, these go through proposal files first, then the shared agent (or a Claude session opened at `services/shared/`) approves and implements.

### 5.1 Tasks

1. **Create proposal** `services/shared/proposals/svc-acl-introduction.md` documenting all four additions below in the format specified by `services/shared/CLAUDE.md`.
2. **Add prefixes** to `services/shared/src/rdf/prefixes.ts`:
   ```ts
   acl:        'http://www.w3.org/ns/auth/acl#',
   shexrauth:  `${baseNamespace}resource/auth/`,
   ```
   Update the `Prefixes` interface accordingly. Make sure `sparqlPrefixes(prefixes)` includes them.
3. **Add `sparqlAsk` helper** to `services/shared/src/sparql/client.ts`:
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
   Export from `services/shared/src/index.ts`.
4. **Add `acl.proto`** at `services/shared/proto/acl.proto`:
   ```proto
   syntax = "proto3";
   package shexmap.acl;

   service AclService {
     rpc HasMode            (HasModeRequest)            returns (HasModeResponse);
     rpc GrantMode          (GrantModeRequest)          returns (GrantModeResponse);
     rpc RevokeMode         (RevokeModeRequest)         returns (RevokeModeResponse);
     rpc ListAuthorizations (ListAuthorizationsRequest) returns (ListAuthorizationsResponse);
     rpc PurgeResource      (PurgeResourceRequest)      returns (PurgeResourceResponse);
   }

   message HasModeRequest  { string resource_iri = 1; string agent_iri = 2; string mode = 3; }
   message HasModeResponse { bool allowed = 1; }

   message GrantModeRequest  { string resource_iri = 1; string agent_iri = 2; string mode = 3; }
   message GrantModeResponse { string authorization_iri = 1; }

   message RevokeModeRequest  { string resource_iri = 1; string agent_iri = 2; string mode = 3; }
   message RevokeModeResponse { int32 deleted_count = 1; }

   message ListAuthorizationsRequest  { string resource_iri = 1; }
   message ListAuthorizationsResponse {
     repeated Authorization items = 1;
   }
   message Authorization {
     string authorization_iri = 1;
     string resource_iri      = 2;
     string agent_iri         = 3;
     string mode              = 4;
   }

   message PurgeResourceRequest  { string resource_iri = 1; }
   message PurgeResourceResponse { int32 deleted_count = 1; }
   ```
5. **Add proto to consumer copy steps**: each service that ends up calling svc-acl will need `proto/acl.proto` copied into its build. (Branches 2/3/4 handle this.)

### 5.2 Acceptance

- `npm test` in `services/shared/` passes.
- All existing services' tests still pass (no consumers changed yet, so this should be true by construction).
- The proposal file is removed once changes are merged (per shared governance).

### 5.3 Deliverable PR description

> Adds `acl` and `shexrauth` prefixes, `sparqlAsk` helper, and `acl.proto` to shared package. No consumer changes. Prerequisite for `svc-acl`.

---

## 6. Branch 2 — `feature/svc-acl-skeleton`

The new service. Mirrors the pattern of svc-coverage and svc-schema (read-mostly gRPC services).

### 6.1 Directory layout to create

```
services/svc-acl/
├── CLAUDE.md
├── Dockerfile                        # multi-stage; copy from svc-coverage as template
├── package.json                      # @shexmap/svc-acl
├── tsconfig.json
├── proto/                            # populated at build time from ../shared/proto/acl.proto
├── src/
│   ├── index.ts                      # entry point — calls startServer()
│   ├── config.ts                     # PORT=50000, QLEVER_*, BASE_NAMESPACE
│   ├── server.ts                     # grpc.Server + AclService handler
│   ├── sparql.ts                     # createSparqlClient + buildPrefixes wiring
│   └── services/
│       └── acl.service.ts            # grantMode, revokeMode, hasMode, listAuthorizations, purgeResource
└── test/
    ├── acl.service.test.ts           # vi.mock sparqlAsk/sparqlUpdate; assert query shapes
    └── acl.handler.test.ts           # gRPC handler integration with mocked services
```

### 6.2 Constants

```ts
// src/services/acl.service.ts
export const ACL_GRAPH = 'https://w3id.org/shexmap/acl';
export const SUPPORTED_MODES = ['Write'] as const;  // extend later
export type AclMode = typeof SUPPORTED_MODES[number];
```

### 6.3 Service functions (signatures)

```ts
export async function hasMode(
  client: SimpleClient, prefixes: Prefixes,
  resourceIri: string, agentIri: string, mode: AclMode,
): Promise<boolean>

export async function grantMode(
  client: SimpleClient, prefixes: Prefixes,
  resourceIri: string, agentIri: string, mode: AclMode,
): Promise<{ authorizationIri: string }>

export async function revokeMode(
  client: SimpleClient, prefixes: Prefixes,
  resourceIri: string, agentIri: string, mode: AclMode,
): Promise<{ deletedCount: number }>

export async function listAuthorizations(
  client: SimpleClient, prefixes: Prefixes,
  resourceIri: string,
): Promise<Authorization[]>

export async function purgeResource(
  client: SimpleClient, prefixes: Prefixes,
  resourceIri: string,
): Promise<{ deletedCount: number }>
```

### 6.4 SPARQL templates (use these exact query shapes)

**hasMode** — ASK against the named graph:
```sparql
ASK {
  GRAPH <https://w3id.org/shexmap/acl> {
    ?auth a acl:Authorization ;
          acl:accessTo <{resource}> ;
          acl:agent    <{agent}> ;
          acl:mode     acl:{mode} .
  }
}
```

**grantMode** — INSERT DATA, but first check via hasMode to keep the operation idempotent (avoid duplicate Authorization nodes for the same triple-set):
```sparql
INSERT DATA {
  GRAPH <https://w3id.org/shexmap/acl> {
    <{authIri}> a acl:Authorization ;
                acl:accessTo <{resource}> ;
                acl:agent    <{agent}> ;
                acl:mode     acl:{mode} .
  }
}
```
Where `{authIri}` is `${prefixes.shexrauth}${uuidv4()}`.

**revokeMode** — DELETE all triples of every Authorization node matching the spec:
```sparql
DELETE { GRAPH <https://w3id.org/shexmap/acl> { ?auth ?p ?o } }
WHERE  { GRAPH <https://w3id.org/shexmap/acl> {
  ?auth a acl:Authorization ;
        acl:accessTo <{resource}> ;
        acl:agent    <{agent}> ;
        acl:mode     acl:{mode} ;
        ?p ?o .
} }
```

**listAuthorizations**:
```sparql
SELECT ?auth ?agent ?mode WHERE {
  GRAPH <https://w3id.org/shexmap/acl> {
    ?auth a acl:Authorization ;
          acl:accessTo <{resource}> ;
          acl:agent    ?agent ;
          acl:mode     ?mode .
  }
}
```

**purgeResource**:
```sparql
DELETE { GRAPH <https://w3id.org/shexmap/acl> { ?auth ?p ?o } }
WHERE  { GRAPH <https://w3id.org/shexmap/acl> {
  ?auth a acl:Authorization ;
        acl:accessTo <{resource}> ;
        ?p ?o .
} }
```

### 6.5 gRPC handlers in `server.ts`

Read AuthContext from gRPC metadata (same pattern as other services), but **do not enforce auth**: svc-acl trusts its callers (services on the internal network). Log the caller's `userId` for audit if `authEnabled`.

Mode validation: reject any mode not in `SUPPORTED_MODES` with `INVALID_ARGUMENT`. This is the contract guard so callers can't accidentally drift the vocabulary.

### 6.6 Tests

**acl.service.test.ts** (mock `sparqlAsk` / `sparqlUpdate` / `sparqlSelect`):
- `hasMode` issues the expected ASK query
- `grantMode` issues an INSERT DATA with a UUID-shaped Authorization IRI
- `revokeMode` issues the DELETE-WHERE
- `listAuthorizations` parses bindings correctly
- `purgeResource` issues the DELETE-WHERE without an agent filter
- Invalid mode → throws

**acl.handler.test.ts**:
- Each RPC end-to-end (with service-layer functions mocked) returns the expected response message
- Invalid mode RPC returns INVALID_ARGUMENT

### 6.7 Docker compose

Add to `docker-compose.yml`:
```yaml
svc-acl:
  build:
    context: ./services
    dockerfile: svc-acl/Dockerfile
  environment:
    NODE_ENV: production
    PORT: "50000"
    LOG_LEVEL: info
    QLEVER_SPARQL_URL: http://qlever:7001/sparql
    QLEVER_UPDATE_URL: http://qlever:7001/update
    QLEVER_ACCESS_TOKEN: ${QLEVER_ACCESS_TOKEN:-shexmap-dev-token}
    BASE_NAMESPACE: ${BASE_NAMESPACE:-https://w3id.org/shexmap/}
  depends_on:
    qlever-init:
      condition: service_completed_successfully
  networks:
    - shexmap-svc-net
  restart: unless-stopped
```

Note: `QLEVER_ACCESS_TOKEN` default in compose is `shexmap-dev-token`, but the running QLever uses `very_secure_token` (set in `.env`). The agent must verify which token the running QLever expects and ensure svc-acl uses the same.

### 6.8 CLAUDE.md

Create `services/svc-acl/CLAUDE.md` mirroring the structure of svc-schema's CLAUDE.md (read-mostly, gRPC, no auth enforcement at this layer).

### 6.9 Acceptance

- `cd services/svc-acl && npm test` — green
- `docker compose up --build svc-acl` — service starts, logs `svc-acl gRPC listening on :50000`
- Manual probe (using `docker exec ... grpcurl` or a quick test script): `HasMode` returns `false` for an unknown grant; `GrantMode` then `HasMode` returns `true`; `RevokeMode` then `HasMode` returns `false`.

### 6.10 Deliverable PR description

> New svc-acl service. Stores WAC `acl:Authorization` instances in `<https://w3id.org/shexmap/acl>` named graph. Exposes Has/Grant/Revoke/List/Purge gRPC RPCs. Not yet integrated with svc-shexmap or svc-pairing — Branch 3/4.

---

## 7. Branch 3 — `feature/svc-shexmap-acl-integration`

Wire svc-shexmap into svc-acl, both as a reader (during AuthZ) and as a writer (for user-facing Grant/Revoke/List).

### 7.1 Tasks

1. **Add gRPC client** to svc-acl in `services/svc-shexmap/src/`:
   - Copy `acl.proto` into `services/svc-shexmap/proto/` at build time.
   - Add `SVC_ACL_URL` env var to `config.ts` (default `svc-acl:50000`).
   - Lazy gRPC client builder, same pattern as svc-shexmap's existing `getValidateClient`.

2. **Modify AuthZ check** in `services/svc-shexmap/src/server.ts:190` (and the analogous block in `deleteShexMapHandler`, `saveVersionHandler`):
   ```ts
   const isOwner = existing.authorId === ctx.userId;
   const isAdmin = ctx.role === 'admin';
   const hasAclWrite = await aclHasMode(existing.iri, ctx.userIri, 'Write');
   if (!unclaimed && !isOwner && !hasAclWrite && !isAdmin) {
     return callback({ code: PERMISSION_DENIED, ... });
   }
   ```
   Note: `existing.iri` and `ctx.userIri` may need to be derived from `existing.id` and `ctx.userId` (resource ID → IRI mapping using the prefix).

3. **Call `purgeResource`** in `deleteShexMapHandler` after a successful delete:
   ```ts
   await deleteShExMap(client, prefixes, id);
   await aclPurgeResource(mapIri).catch(err => fastify.log.warn({ err }, 'ACL purge failed'));
   ```
   Failures here should NOT roll back the delete — log and proceed. Dangling authorizations are harmless (the resource IRI no longer matches anything).

4. **Add user-facing Grant/Revoke/List RPCs** to `shexmap.proto` (proposal file required) and svc-shexmap's server. These do owner check, then delegate to svc-acl:
   - `GrantWriteAccess(map_id, agent_user_id) → Authorization`
   - `RevokeWriteAccess(map_id, agent_user_id) → DeletedCountResponse`
   - `ListWriteAccess(map_id) → ListAuthorizationsResponse`

5. **Add gateway routes** in `services/svc-gateway/src/routes/shexmaps.ts`:
   - `POST   /api/v1/shexmaps/:id/acl/grant   { agentUserId }` → `GrantWriteAccess`
   - `POST   /api/v1/shexmaps/:id/acl/revoke  { agentUserId }` → `RevokeWriteAccess`
   - `GET    /api/v1/shexmaps/:id/acl`                          → `ListWriteAccess`
   All require auth; ownership is enforced by svc-shexmap.

6. **Update CLAUDE.md** for svc-shexmap: add ACL row to AuthZ table, document the new RPCs.

### 7.2 Tests

- Unit tests in svc-shexmap: AuthZ check passes when `hasAclWrite` returns true; fails when all three conditions fail.
- Integration test: full curl flow — owner grants edit to user B → user B's PATCH succeeds.

### 7.3 Acceptance

- `cd services/svc-shexmap && npm test` — green
- `cd services/svc-gateway && npm test` — green
- Manual: as user A (owner), `POST /api/v1/shexmaps/:id/acl/grant` with user B's UUID. As user B, `PATCH /api/v1/shexmaps/:id` succeeds (was 403 before).

---

## 8. Branch 4 — `feature/svc-pairing-acl-integration`

Identical pattern to Branch 3, applied to svc-pairing. Three handlers (Update/Delete/SavePairingVersion) gain the `hasAclWrite` check; new RPCs `GrantWriteAccess`/`RevokeWriteAccess`/`ListWriteAccess`; gateway routes `POST /api/v1/pairings/:id/acl/grant` etc. svc-pairing CLAUDE.md updated.

Can run in parallel with Branch 3 — neither depends on the other.

---

## 9. Branch 5 — `feature/acl-frontend-ui`

User-visible "Manage access" UI.

### 9.1 Tasks

1. **API hooks** in `frontend/src/api/`:
   - `useShExMapAcl(id)` → `GET /api/v1/shexmaps/:id/acl`
   - `useGrantShExMapAcl(id)` → `POST .../acl/grant`
   - `useRevokeShExMapAcl(id)` → `POST .../acl/revoke`
   - Same trio for pairings.
2. **Manage Access panel** — new component `frontend/src/components/acl/ManageAccessPanel.tsx`:
   - List current grants (agent name + revoke button)
   - "Add user by ID" input (UUID for v1 — username search is a future feature)
   - Only rendered when `isOwner` is true
3. **Wire into ShExMapPage** — show panel as a collapsible section under "Edit metadata".
4. **Wire into CreatePairingPage** — same, in the metadata column.
5. **Playwright e2e**: extend `frontend/e2e/shexmap-page.spec.ts`:
   - Owner grants user B edit → as user B, ShExMapPage shows "Edit metadata" instead of "Fork".
   - Owner revokes → as user B, ShExMapPage shows "Fork" again.

### 9.2 Acceptance

- `npm run test:e2e` — green
- Manual smoke test: full grant/revoke flow visible in the UI.

---

## 10. Verification across the whole feature

Run before merging the final branch:

1. `./scripts/backup-db.sh` — snapshot data before any ACL writes.
2. Bring up full stack, exercise the grant/revoke flow end-to-end.
3. Run all unit tests across services + frontend Playwright.
4. Verify no regressions: existing owner-only flows still work; anonymous-claim escape hatch still works.

## 11. Risks and rollback

| Risk | Mitigation |
|---|---|
| QLever's "experimental SPARQL UPDATE" warning becomes a real bug | Spike already exercised INSERT/SELECT/ASK/DROP successfully. Worst case: roll back svc-acl writes by `DROP GRAPH <…/acl>`; non-ACL data untouched. |
| Performance hit on AuthZ hot path (extra gRPC hop) | sub-ms baseline measured. If it becomes an issue, add a per-request cache in svc-shexmap/svc-pairing keyed on (resource, agent). Out of scope for v1. |
| Dangling authorizations after resource delete | Branch 3/4 add `purgeResource` calls; failures logged but non-fatal. Stale ACL triples are harmless. |
| ACL graph and content graph diverge in backups | Current backup script CONSTRUCTs everything into a single Turtle file (loses graph names). Acceptable for v1; a future enhancement is to emit TriG. Document this in the svc-acl CLAUDE.md. |
| Shared-package proposal stalls | The shared agent must approve Branch 1 before Branch 2 can proceed. Build the proposal file as the very first artifact; surface it for review immediately. |

## 12. Out of scope (explicit non-goals)

These are deliberately deferred to keep the v1 small:

- `acl:Read` mode and visibility flags (private maps) — design stays open
- `acl:agentClass` (public) and `acl:agentGroup` (teams)
- `acl:Append` mode (version-only collaboration)
- Username/email-based search in the Add User UI — v1 takes a UUID
- Caching layer on svc-acl
- Migration of existing legacy "anonymous" data to explicit authorizations — keep the unclaimed-claim rule
- TriG-format backups
- Audit log of grant/revoke events

## 13. Done definition

This plan is "done" when:

- All 5 branches are merged to master
- The full e2e Playwright test for grant/revoke passes in CI
- `services/svc-acl/CLAUDE.md` exists; root `CLAUDE.md` and svc-shexmap/svc-pairing CLAUDE.md are updated to mention the ACL service and its AuthZ implications
- A user with edit access can demonstrably edit a non-owned ShExMap and pairing

---

## Appendix A — Reference: existing code touch points

For the implementing agent's quick orientation:

| File | What this plan touches |
|---|---|
| `services/shared/src/rdf/prefixes.ts` | Add `acl`, `shexrauth` |
| `services/shared/src/sparql/client.ts` | Add `sparqlAsk` |
| `services/shared/proto/acl.proto` | New file |
| `services/svc-acl/**` | All new |
| `services/svc-shexmap/src/server.ts` lines ~190, ~225, ~280 | Add ACL check to AuthZ blocks |
| `services/svc-shexmap/src/server.ts` (delete handler) | Add `aclPurgeResource` call |
| `services/svc-pairing/src/server.ts` lines ~208, ~244, ~289 | Add ACL check to AuthZ blocks |
| `services/svc-pairing/src/server.ts` (delete handler) | Add `aclPurgeResource` call |
| `services/svc-gateway/src/routes/shexmaps.ts` | New routes for /:id/acl/grant etc. |
| `services/svc-gateway/src/routes/pairings.ts` | New routes for /:id/acl/grant etc. |
| `frontend/src/api/shexmaps.ts` | New hooks |
| `frontend/src/pages/ShExMapPage.tsx` | Panel integration |
| `frontend/src/pages/CreatePairingPage.tsx` | Panel integration |
| `frontend/e2e/shexmap-page.spec.ts` | New tests |
| `docker-compose.yml` | New svc-acl entry |
| `CLAUDE.md`, `services/svc-shexmap/CLAUDE.md`, `services/svc-pairing/CLAUDE.md`, `services/svc-acl/CLAUDE.md` | Doc updates |

## Appendix B — Spike evidence

The architectural decisions in §3 are grounded in `scripts/probe-named-graphs.sh` results (run 2026-04-28):

- INSERT DATA into named graph: succeeded
- SELECT with explicit GRAPH clause: returned the inserted triple
- ASK without GRAPH clause: returned `true` (union semantics — see §3.1 commentary)
- Listing all named graphs returned only the probe graph (default-graph data is unnamed)
- DROP GRAPH: succeeded
- QLever logs: "SPARQL 1.1 Update for QLever is experimental." (same warning we already accept for content writes)
