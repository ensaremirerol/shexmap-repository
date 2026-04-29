# Agent prompts — svc-acl Branches 3-5

These prompts continue execution of `plans/svc-acl-introduction.md`. Branches 1 and 2 were completed in a previous Claude session.

## Status snapshot (as of handoff)

| Branch | Status | Branch name | Last commit |
|---|---|---|---|
| 1 | ✅ Merged onto its branch | `feature/acl-shared-additions` | `7f386ec` |
| 2 | ✅ Merged onto its branch | `feature/svc-acl-skeleton` | `4f5bc43` |
| 3 | ⏳ TODO | `feature/svc-shexmap-acl-integration` | — |
| 4 | ⏳ TODO | `feature/svc-pairing-acl-integration` | — |
| 5 | ⏳ TODO | `feature/acl-frontend-ui` | — |

Branches are stacked (each off the previous), not all off `master`. Branch 3 must branch from `feature/svc-acl-skeleton` to inherit the new svc-acl service and the shared package additions.

## How to run these

Run **one at a time, sequentially**. Each prompt is self-contained — paste it into a fresh agent session. Do NOT run Branches 3 and 4 in parallel: they both touch `services/svc-gateway/src/routes/` files and `package.json`, which causes merge headaches.

### Order

1. `branch-3-svc-shexmap-integration.md`
2. `branch-4-svc-pairing-integration.md`
3. `branch-5-frontend-ui.md`

### Provider/agent notes

- Each agent should have full file system + bash access (general-purpose).
- The repo is at `/home/ensar/workspace/03_ids/shexmap-repository`.
- The working tree has uncommitted changes from earlier sessions (plan file, Playwright tests, CLAUDE.md edits, probe script). Each prompt explicitly tells the agent to **not stage them**. Verify the agent obeys.
- After each agent completes, do a quick `git log --oneline -5` and `git status` sanity check before kicking off the next.

## Verification at the end

After all 3 branches are done, the original Claude session can resume to:

1. Confirm all 5 branches exist with sane commit histories
2. Run the full test suite across services + frontend Playwright e2e
3. Manually exercise the full grant/revoke flow against the running stack
4. Update root `CLAUDE.md` if anything substantial drifted

## What to send back to me when reviewing

- `git log --oneline feature/acl-shared-additions..feature/acl-frontend-ui` (entire chain)
- Test results from each branch's report
- Any deviations or blockers each agent reported

## Common pitfalls to watch for

- **Wrong base branch.** Each branch MUST branch off the previous, not `master`.
- **`git add .`** — strictly forbidden; orthogonal uncommitted work must stay untouched.
- **Proto changes without proposal.** Adding RPCs to `services/shared/proto/shexmap.proto` or `pairing.proto` requires a proposal file in `services/shared/proposals/` per the shared governance.
- **IRI vs ID confusion.** `ctx.userId` is a UUID string; svc-acl wants the full IRI (`${prefixes.shexruser}${userId}`). The same applies to resource IRIs (`${prefixes.shexrmap}${mapId}`, `${prefixes.shexrpair}${pairingId}`).
- **Missing `proto/acl.proto` copy.** svc-shexmap and svc-pairing's build steps must add `cp -r ../shared/proto/acl.proto ./proto/` (alongside their existing proto copies).
