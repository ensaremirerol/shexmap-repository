# Branch 5 prompt — Frontend Manage-Access UI

Paste everything below into a fresh general-purpose agent session.

---

You are implementing **Branch 5** (the final branch) of the svc-acl introduction plan in this repository: `/home/ensar/workspace/03_ids/shexmap-repository`.

## Context

Branches 1-4 are complete:
- Branch 1 — shared package additions
- Branch 2 — new svc-acl service
- Branch 3 — svc-shexmap integration; HTTP endpoints `POST /api/v1/shexmaps/:id/acl/grant`, `POST .../acl/revoke`, `GET .../acl`
- Branch 4 — svc-pairing integration; HTTP endpoints `POST /api/v1/pairings/:id/acl/grant`, `POST .../acl/revoke`, `GET .../acl`

Read **`plans/svc-acl-introduction.md`** §9 (Frontend UI) before starting.

The backend is fully wired. Your job is the user-facing UI: a "Manage Access" panel on `ShExMapPage` and `CreatePairingPage`, plus Playwright e2e coverage.

Verify the exact response shapes from Branches 3 and 4 by reviewing their commits:
```
git log feature/svc-shexmap-acl-integration -1
git log feature/svc-pairing-acl-integration -1
git diff feature/svc-acl-skeleton..feature/svc-pairing-acl-integration -- services/svc-gateway/src/routes/
```

## Scope

### 1. React Query API hooks

Add to `frontend/src/api/shexmaps.ts` (or a new `frontend/src/api/acl.ts` if cleaner):

```ts
export interface AclEntry {
  authorizationIri: string;
  agentUserId: string;
  mode: string;
}

export function useShExMapAcl(mapId: string) { ... }    // GET .../shexmaps/:id/acl  → AclEntry[]
export function useGrantShExMapAcl(mapId: string)       // POST .../shexmaps/:id/acl/grant
export function useRevokeShExMapAcl(mapId: string)      // POST .../shexmaps/:id/acl/revoke
export function usePairingAcl(pairingId: string) { ... }
export function useGrantPairingAcl(pairingId: string)
export function useRevokePairingAcl(pairingId: string)
```

Mutations should `invalidateQueries` on the corresponding ACL list query.

### 2. ManageAccessPanel component

`frontend/src/components/acl/ManageAccessPanel.tsx`:

```tsx
interface Props {
  resourceId: string;
  resourceKind: 'shexmap' | 'pairing';
  isOwner: boolean;
}
```

Behaviour:
- Renders only when `isOwner === true`. Otherwise `return null`.
- Lists current grants: agent UUID, "Write" mode, revoke button (X icon).
- Add-user form: a single text input expecting a user UUID, plus an "Add" button. Validate it looks like a UUID before submitting.
- Loading and error states for both list and mutations.
- After grant/revoke, the list re-fetches via `invalidateQueries`.

UX deferred to v2: username search (currently UUID-only is acceptable per plan §12).

### 3. Wire into ShExMapPage and CreatePairingPage

- `frontend/src/pages/ShExMapPage.tsx`: add the panel as a collapsible section, visible alongside the existing "Edit metadata" button. Keep existing `isOwner` logic untouched — pass it to the panel.
- `frontend/src/pages/CreatePairingPage.tsx`: same, in the metadata column. Use the existing `isOwner` for pairings (line ~1043).

Both pages already have `isOwner` derived; reuse that variable.

### 4. Playwright e2e

Extend `frontend/e2e/shexmap-page.spec.ts` (and add `pairing-page.spec.ts` if convenient):

- Mock `/api/v1/shexmaps/:id/acl` returning an empty list.
- Owner sees the Manage Access panel; non-owners and anonymous users do not.
- Filling the input and clicking Add issues a POST to `.../acl/grant` with the right body.
- After grant, the list refetches and shows the new entry.
- Revoke button calls `.../acl/revoke`.

Use the existing `mockApi(page, opts)` helper in `frontend/e2e/fixtures/api-mocks.ts` — extend it to support ACL routes via overrides.

Add the same test pattern for pairings.

## Acceptance

```bash
cd frontend && npm test                  # vitest — frontend unit tests
cd frontend && npm run test:e2e          # Playwright; should be green
```

Manual smoke test (with full stack running):
- Sign in as user A.
- Visit a map you own. Manage Access panel is visible.
- Add user B's UUID. List updates.
- Sign out, sign in as user B.
- Visit the same map. The Edit metadata button is now visible (was Fork before).
- Sign in as user A again, revoke. Sign in as B, see Fork.

If full-stack manual testing is friction, document the e2e Playwright coverage as the primary signal.

## Git workflow (CRITICAL)

- **Branch off `feature/svc-pairing-acl-integration`** (the latest in the chain).
- Create branch `feature/acl-frontend-ui`.
- The working tree still has uncommitted changes from earlier sessions. The Playwright tests directory `frontend/e2e/` and `frontend/playwright.config.ts` are untracked but **were created in an earlier session and contain real tests we want to keep**. You will want to add new Playwright specs alongside them. **Be specific about which files you stage:** stage only the new ACL-related additions, NOT the orthogonal pre-existing untracked Playwright files (which belong to a different change set).
- Stage ONLY: `frontend/src/api/` additions, `frontend/src/components/acl/`, modified `frontend/src/pages/ShExMapPage.tsx` and `CreatePairingPage.tsx` (only the ACL panel wiring), and any new e2e specs you create (e.g. `frontend/e2e/acl.spec.ts`).
- Do NOT touch the existing untracked `frontend/e2e/*.spec.ts` (`browse.spec.ts`, `home.spec.ts`, etc.) — leave them as-is.
- **NEVER** `git add .`, `git add -A`, or `git add -u`. Use explicit paths only.
- `git status` check before commit.
- Commit message: `feat(frontend): manage access UI for ShExMaps and pairings`. Co-Authored-By trailer.
- Do NOT merge, do NOT push.

## What to return

≤400-word report:
1. Branch name + commit SHA
2. Files added/modified
3. Test results: vitest counts + Playwright counts
4. Manual smoke test outcome (or "deferred — verified via Playwright")
5. Anything surprising
6. `git status` clean confirmation
7. **Final summary of the entire 5-branch feature**: what works end-to-end, any rough edges, anything the reviewer should know before merging the chain

This is the last branch. After this, the original Claude session reviews the whole chain.
