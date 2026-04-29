# Branch 3 prompt — svc-shexmap ACL integration

Paste everything below into a fresh general-purpose agent session.

---

You are implementing **Branch 3** of the svc-acl introduction plan in this repository: `/home/ensar/workspace/03_ids/shexmap-repository`.

## Context

Branches 1 and 2 are done:
- **Branch 1** (`feature/acl-shared-additions` @ `7f386ec`): added `acl` and `shexrauth` prefixes, `sparqlAsk` helper, `services/shared/proto/acl.proto`.
- **Branch 2** (`feature/svc-acl-skeleton` @ `4f5bc43`): introduced the new `services/svc-acl/` service with `HasMode` / `GrantMode` / `RevokeMode` / `ListAuthorizations` / `PurgeResource` gRPC RPCs. Service starts cleanly; 23/23 unit tests pass. svc-acl listens on port 50000 internally; gRPC package `shexmap.acl.AclService`; wire field names are snake_case (`resource_iri`, `agent_iri`, `mode`, `authorization_iri`, `deleted_count`); `GrantMode` is idempotent; `PurgeResource` is best-effort.

Read **`plans/svc-acl-introduction.md`** end-to-end before starting. Your scope is **§7 only** (Branch 3 — svc-shexmap integration). Do NOT touch svc-pairing, svc-acl, frontend, or shared package.

## Your job

Wire svc-shexmap into svc-acl as both reader (during the existing AuthZ check) and writer (new user-facing Grant/Revoke/List RPCs). Add gateway HTTP routes.

### 1. Add svc-acl gRPC client to svc-shexmap

- Copy `services/shared/proto/acl.proto` into svc-shexmap's build artifact `proto/` directory. Update svc-shexmap's `package.json` build script + Dockerfile `COPY` to include this proto file alongside its existing proto copies.
- Add `SVC_ACL_URL` env var to `services/svc-shexmap/src/config.ts` (default `svc-acl:50000`). Match the style of the existing `SVC_VALIDATE_URL`.
- Add a lazy gRPC client builder in `services/svc-shexmap/src/server.ts` (or a small `src/grpc/acl-client.ts`) that mirrors the existing `getValidateClient()` / `getShexmapClient()` patterns elsewhere in the repo. Wrap each gRPC call as a Promise (Node gRPC is callback-based). Inject AuthContext gRPC metadata into every call (svc-acl reads it for logging) — see how `services/svc-pairing/src/server.ts` does this.
- Update `docker-compose.yml`: add `SVC_ACL_URL: svc-acl:50000` to svc-shexmap's environment block. Add `svc-acl` to its `depends_on`.

### 2. Modify the AuthZ check (3 sites)

In `services/svc-shexmap/src/server.ts`, the current AuthZ block (around lines 190-197, 220-228, 275-281 — verify line numbers; they're the three handlers that touch existing resources: `updateShexMapHandler`, `deleteShexMapHandler`, `saveVersionHandler`):

```ts
if (ctx.authEnabled) {
  if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, ... });
  const unclaimed = !existing.authorId || existing.authorId === 'anonymous';
  if (!unclaimed && existing.authorId !== ctx.userId && ctx.role !== 'admin') {
    return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not the owner' });
  }
}
```

becomes:

```ts
if (ctx.authEnabled) {
  if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, ... });
  const unclaimed = !existing.authorId || existing.authorId === 'anonymous';
  const isOwner   = existing.authorId === ctx.userId;
  const isAdmin   = ctx.role === 'admin';
  let hasAclWrite = false;
  if (!unclaimed && !isOwner && !isAdmin) {
    const resourceIri = `${prefixes.shexrmap}${existing.id}`;
    const agentIri    = `${prefixes.shexruser}${ctx.userId}`;
    hasAclWrite = await aclHasMode(resourceIri, agentIri, 'Write');
  }
  if (!unclaimed && !isOwner && !hasAclWrite && !isAdmin) {
    return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not authorized to edit' });
  }
}
```

The conditional ACL lookup avoids extra RPCs when the cheap checks already pass.

### 3. Call `purgeResource` on delete

In `deleteShexMapHandler`, after `deleteShExMap(...)` succeeds, call `aclPurgeResource(resourceIri)` and **swallow errors** (just log; do not roll back the delete).

### 4. New user-facing RPCs in svc-shexmap

Add three RPCs to `services/shared/proto/shexmap.proto`:

```proto
rpc GrantWriteAccess  (AccessRequest)   returns (AccessGrantResponse);
rpc RevokeWriteAccess (AccessRequest)   returns (AccessRevokeResponse);
rpc ListWriteAccess   (ListAccessRequest) returns (ListAccessResponse);

message AccessRequest        { string map_id = 1; string agent_user_id = 2; }
message AccessGrantResponse  { string authorization_iri = 1; }
message AccessRevokeResponse { int32 deleted_count = 1; }
message ListAccessRequest    { string map_id = 1; }
message ListAccessResponse   { repeated AccessEntry items = 1; }
message AccessEntry {
  string authorization_iri = 1;
  string agent_user_id     = 2;
  string mode              = 3;
}
```

Per shared governance, this requires a proposal file at `services/shared/proposals/svc-shexmap-acl-rpcs.md`. **Create the proposal AND implement the proto change in this branch** (we are acting as both service agent and shared agent under the user's coordinated plan).

### 5. Implement the new handlers

In `services/svc-shexmap/src/server.ts`. Each does:
1. Read AuthContext from metadata
2. Lookup `existing = getShExMap(call.request.map_id)`. NOT_FOUND if absent.
3. Apply the same ownership check as Update/Delete/SaveVersion (owner | admin | unclaimed). PERMISSION_DENIED if fails. Important: `acl:Write` grant alone does NOT confer the ability to grant/revoke — that's owner-only. (Reasoning: matches `acl:Control` semantics, but we don't model Control as a separate mode.)
4. Derive `resourceIri = ${prefixes.shexrmap}${map_id}` and `agentIri = ${prefixes.shexruser}${agent_user_id}`.
5. Delegate to svc-acl: `GrantMode` / `RevokeMode` / `ListAuthorizations`.
6. For Grant/Revoke, return the svc-acl response shape mapped to `AccessGrantResponse` / `AccessRevokeResponse`.
7. For List, transform svc-acl's `Authorization` items: extract the user UUID from the agent IRI (`agent_iri.replace(prefixes.shexruser, '')`) into `agent_user_id`.

### 6. Gateway routes

Add to `services/svc-gateway/src/routes/shexmaps.ts`:

```
POST /api/v1/shexmaps/:id/acl/grant   { agentUserId }   → GrantWriteAccess
POST /api/v1/shexmaps/:id/acl/revoke  { agentUserId }   → RevokeWriteAccess
GET  /api/v1/shexmaps/:id/acl                            → ListWriteAccess
```

All three require auth (the `requiresAuth(method)` helper already covers POST; for GET intentionally allow public reads of the ACL — owners and would-be collaborators both need to see it).

Use the existing `grpcCall` helper with `shexmapClient`. Convert snake_case proto responses to camelCase via `snakeToCamel`.

### 7. Update svc-shexmap CLAUDE.md

In the AuthZ table, change the Update/Delete/SaveVersion rules to also list the `acl:Write` grant path. Add a "Manage Access RPCs" section listing the three new RPCs.

## Tests (extend existing files)

- `services/svc-shexmap/test/shexmap.handler.test.ts` (or add `acl.handler.test.ts`): mock the svc-acl gRPC client. Verify:
  - Update succeeds when ACL `HasMode` returns true (and is otherwise PERMISSION_DENIED). Mock `existing.authorId` as a different user.
  - GrantWriteAccess: 403 for non-owner; 200 for owner; svc-acl `GrantMode` called with correct IRIs.
  - RevokeWriteAccess: same auth check; svc-acl `RevokeMode` called.
  - ListWriteAccess: returns transformed list (agent_user_id extracted from IRI).
  - Delete: `purgeResource` is called best-effort; delete still succeeds if purge throws.

- `services/svc-gateway/test/shexmaps.route.test.ts`: add tests for the three new HTTP routes (mock the gRPC call).

## Acceptance

```bash
cd services/svc-shexmap && npm test          # all green
cd services/svc-gateway && npm test          # all green
cd /home/ensar/workspace/03_ids/shexmap-repository
docker compose build svc-shexmap svc-gateway
docker compose up -d svc-shexmap svc-gateway svc-acl qlever
```

Manual end-to-end smoke test (use curl with two test JWTs — generate them ad-hoc using the JWT secret from `.env`, or wait for full e2e in Branch 5):
- As user A (owner of map M), `POST /api/v1/shexmaps/M/acl/grant { "agentUserId": "user-B-uuid" }` → 200.
- As user B, `PATCH /api/v1/shexmaps/M` with new title → 200 (was 403 before).
- As user A, `POST /api/v1/shexmaps/M/acl/revoke { "agentUserId": "user-B-uuid" }` → 200.
- As user B, `PATCH /api/v1/shexmaps/M` → 403 again.

If JWT generation is friction, just verify unit tests pass and document the manual flow as "needs Branch 5 to verify end-to-end".

## Git workflow (CRITICAL)

- **Branch off `feature/svc-acl-skeleton`** (NOT master, NOT the current Claude session branch).
- Create branch `feature/svc-shexmap-acl-integration`.
- The working tree has uncommitted changes from earlier sessions — DO NOT touch them. Specifically: untracked `frontend/e2e/`, `frontend/playwright.config.ts`, `plans/`, `scripts/probe-named-graphs.sh`, and modified `frontend/*`, root `CLAUDE.md`, several `services/*/CLAUDE.md`. **Leave all of these alone.**
- Stage ONLY files inside: `services/svc-shexmap/`, `services/svc-gateway/src/routes/shexmaps.ts`, `services/svc-gateway/test/shexmaps.route.test.ts`, `services/shared/proto/shexmap.proto`, `services/shared/proposals/svc-shexmap-acl-rpcs.md`, and `docker-compose.yml`.
- **NEVER** `git add .`, `git add -A`, or `git add -u`. Use explicit paths.
- Run `git status` before commit; only Branch 3 files should be staged.
- Commit message: `feat(svc-shexmap): integrate svc-acl for write authorization and add Grant/Revoke/List RPCs`. Include `Co-Authored-By: Claude <noreply@anthropic.com>` via HEREDOC.
- Do NOT merge, do NOT push.

## What to return

≤400-word report:
1. Branch name + commit SHA
2. Files added/modified (terse list)
3. Test results: counts (passed/failed) for svc-shexmap and svc-gateway
4. Smoke test outcome (or "deferred to Branch 5" with reasoning)
5. Anything surprising, blockers, deviations
6. `git status` confirmation: only Branch 3 files staged
7. Notes for Branch 4 (svc-pairing): patterns, gotchas, anything reusable

If a blocker prevents completion, STOP and report rather than improvise.
