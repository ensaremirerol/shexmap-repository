# Branch 4 prompt — svc-pairing ACL integration

Paste everything below into a fresh general-purpose agent session.

---

You are implementing **Branch 4** of the svc-acl introduction plan in this repository: `/home/ensar/workspace/03_ids/shexmap-repository`.

## Context

Branches 1, 2, 3 are done:
- **Branch 1** (`feature/acl-shared-additions`): shared package — prefixes, sparqlAsk, acl.proto
- **Branch 2** (`feature/svc-acl-skeleton`): new svc-acl service
- **Branch 3** (`feature/svc-shexmap-acl-integration`): svc-shexmap consults svc-acl during AuthZ + new Grant/Revoke/List RPCs + gateway routes for /api/v1/shexmaps/:id/acl

Read **`plans/svc-acl-introduction.md`** (especially §8 — Branch 4) and **`plans/agent-prompts/branch-3-svc-shexmap-integration.md`** before starting. Your task is the same pattern as Branch 3, applied to svc-pairing. Use Branch 3's commit (run `git log feature/svc-shexmap-acl-integration --oneline | head -5` and view the diff with `git diff feature/svc-acl-skeleton..feature/svc-shexmap-acl-integration`) as your **primary reference template** for the svc-pairing changes. The structure is symmetric.

## Scope

Apply Branch 3's pattern to svc-pairing:

1. **gRPC client to svc-acl** in svc-pairing (mirror Branch 3's wiring).
   - Copy `acl.proto` into svc-pairing's `proto/` build artifact.
   - Add `SVC_ACL_URL` env var to `services/svc-pairing/src/config.ts`.
   - Lazy client builder + AuthContext metadata injection.
   - Add `SVC_ACL_URL: svc-acl:50000` and `svc-acl` depends_on to svc-pairing's docker-compose block.

2. **AuthZ check modification** at 3 sites in `services/svc-pairing/src/server.ts`:
   - `updatePairingHandler` (around line 208)
   - `deletePairingHandler` (around line 244)
   - `savePairingVersionHandler` (around line 289)

   The change is identical to Branch 3's, but use `prefixes.shexrpair` (NOT `shexrmap`) for the resource IRI.

3. **PurgeResource on delete** — call `aclPurgeResource(pairingIri)` after `deleteShExMapPairing` succeeds. Best-effort, swallow errors.

4. **New RPCs** in `services/shared/proto/pairing.proto`:
   ```proto
   rpc GrantWriteAccess  (AccessRequest)     returns (AccessGrantResponse);
   rpc RevokeWriteAccess (AccessRequest)     returns (AccessRevokeResponse);
   rpc ListWriteAccess   (ListAccessRequest) returns (ListAccessResponse);

   message AccessRequest        { string pairing_id = 1; string agent_user_id = 2; }
   message AccessGrantResponse  { string authorization_iri = 1; }
   message AccessRevokeResponse { int32 deleted_count = 1; }
   message ListAccessRequest    { string pairing_id = 1; }
   message ListAccessResponse   { repeated AccessEntry items = 1; }
   message AccessEntry {
     string authorization_iri = 1;
     string agent_user_id     = 2;
     string mode              = 3;
   }
   ```
   Note `pairing_id`, not `map_id`. Per shared governance, write proposal `services/shared/proposals/svc-pairing-acl-rpcs.md` and implement the change in this branch.

5. **Implement handlers** for the three new RPCs in svc-pairing — mirror Branch 3's pattern, with owner-only gating (acl:Write grants do NOT confer grant/revoke ability).

6. **Gateway routes** in `services/svc-gateway/src/routes/pairings.ts`:
   ```
   POST /api/v1/pairings/:id/acl/grant   { agentUserId }
   POST /api/v1/pairings/:id/acl/revoke  { agentUserId }
   GET  /api/v1/pairings/:id/acl
   ```

7. **Update `services/svc-pairing/CLAUDE.md`** — same edits as Branch 3 made to svc-shexmap's CLAUDE.md.

## Tests

Mirror Branch 3's tests for svc-pairing handlers and the new gateway routes.

## Acceptance

```bash
cd services/svc-pairing && npm test
cd services/svc-gateway && npm test
docker compose build svc-pairing svc-gateway
docker compose up -d svc-pairing svc-gateway svc-acl qlever
```

Smoke test analogous to Branch 3 (or defer to Branch 5).

## Git workflow (CRITICAL)

- **Branch off `feature/svc-shexmap-acl-integration`** (NOT master, NOT `feature/svc-acl-skeleton`).
- Create branch `feature/svc-pairing-acl-integration`.
- Same uncommitted-files restriction as before. **Never** `git add .`.
- Stage ONLY: `services/svc-pairing/`, `services/svc-gateway/src/routes/pairings.ts`, `services/svc-gateway/test/` (any new pairings ACL tests), `services/shared/proto/pairing.proto`, `services/shared/proposals/svc-pairing-acl-rpcs.md`, `docker-compose.yml`.
- Verify with `git status` before commit.
- Commit message: `feat(svc-pairing): integrate svc-acl for write authorization and add Grant/Revoke/List RPCs`. With Co-Authored-By trailer.
- Do NOT merge, do NOT push.

## What to return

≤300-word report:
1. Branch name + commit SHA
2. Files modified (just delta from Branch 3's pattern — what was different)
3. Test results
4. Anything that diverged from svc-shexmap's pattern (e.g. pairing has `sourceFocusIri`/`targetFocusIri` plumbing — were any ACL-relevant differences encountered?)
5. `git status` clean confirmation
6. Notes for Branch 5 (frontend): the exact HTTP endpoint shapes, response schemas
