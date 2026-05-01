# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An online repository platform for **ShExMaps** — mappings between RDF shapes defined by ShEx (Shape Expressions). See [REQUIREMENTS.md](REQUIREMENTS.md) for full requirements.

## Repository status

This repository is being migrated from a **monolith** (`api/`) to a **microservices architecture** (`services/`). The monolith in `api/` remains the reference implementation and is still functional. New development should happen in `services/`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend (new) | Node.js microservices in `services/` (gRPC + HTTP) |
| Backend (legacy) | Node.js with Fastify (`api/`) — reference only |
| Triplestore / SPARQL | QLever (`docker/qlever/`) |
| Frontend | React SPA with Vite (`frontend/`) |
| Auth | Optional — GitHub OAuth2 + httpOnly cookie JWT (auto-enabled when `OAUTH_GITHUB_CLIENT_ID` is set) |
| Deployment | Docker + Docker Compose |
| Inter-service | gRPC (`@grpc/grpc-js` + `@grpc/proto-loader`) for compute/data services |
| ShEx processing | `@shexjs/parser`, `@shexjs/core` |
| Visualization | ReactFlow (mapping graphs), Recharts (coverage heatmaps) |

## Commands

```bash
# Start everything (new microservices architecture)
cp .env.example .env
docker compose up --build

# Run individual services in dev mode (every backend service binds :50000 internally)
cd services/svc-validate && npm install && npm run dev
cd services/svc-gateway  && npm install && npm run dev

# Run frontend dev server
cd frontend && npm install && npm run dev

# Run tests for a service
cd services/svc-validate && npm test

# Frontend e2e (Playwright, mocked API)
cd frontend && npm run test:e2e          # headless
cd frontend && npm run test:e2e:ui       # interactive UI mode

# Force full QLever index rebuild (wipes volume, rebuilds from sparql/seed/ + ontology)
./scripts/rebuild-index.sh

# Backup the live triplestore to a Turtle file
./scripts/backup-db.sh                        # → sparql/backup/YYYY-MM-DDTHH-MM-SS.ttl
./scripts/backup-db.sh path/to/output.ttl     # custom output path

# Restore the triplestore from a Turtle backup (destructive — prompts for confirmation)
./scripts/restore-db.sh sparql/backup/YYYY-MM-DDTHH-MM-SS.ttl
```

## Architecture — Microservices

All services communicate over the private `shexmap-svc-net` Docker bridge network. Every backend service listens internally on **port 50000** — uniform inside Docker, distinguished by service hostname (set via `SVC_*_ADDR` env vars on the gateway). Only nginx is exposed to the host (mapped `8090:80`).

```
Browser
  └── nginx (host :8090 → :80)
        ├── /api/*   → svc-gateway:50000  (HTTP — JWT verify + gRPC fan-out)
        ├── /sparql  → svc-gateway:50000  (proxied to svc-sparql-proxy)
        └── /*       → static             (React SPA)

svc-gateway:50000 (HTTP in, gRPC out)
  ├── POST /api/v1/validate    → svc-validate:50000      (gRPC)
  ├── /api/v1/shexmaps/*       → svc-shexmap:50000       (gRPC)
  ├── /api/v1/pairings/*       → svc-pairing:50000       (gRPC)
  ├── /api/v1/coverage/*       → svc-coverage:50000      (gRPC)
  ├── /api/v1/schemas          → svc-schema:50000        (gRPC)
  ├── /api/v1/auth/*           → svc-auth:50000          (HTTP — OAuth2 callbacks need HTTP)
  ├── /api/v1/users/*          → svc-auth:50000          (HTTP)
  └── /sparql                  → svc-sparql-proxy:50000  (HTTP — SPARQL protocol is HTTP)

All gRPC services → qlever:7001 (SPARQL SELECT/UPDATE)
svc-validate      → no external deps (pure CPU)
svc-shexmap       → svc-validate:50000 (ShEx content validation on create)
svc-shexmap       → svc-acl:50000      (AuthZ checks + Grant/Revoke/List RPCs)
svc-pairing       → svc-acl:50000      (AuthZ checks + Grant/Revoke/List RPCs)
```

### Services at a glance

All services bind to internal port **50000**. The public ingress is nginx on host port **8090**.

| Service | Internal port | Protocol | CLAUDE.md |
|---------|---------------|----------|-----------|
| `services/shared` | — | npm workspace pkg | [CLAUDE.md](services/shared/CLAUDE.md) |
| `services/svc-validate` | 50000 | gRPC | [CLAUDE.md](services/svc-validate/CLAUDE.md) |
| `services/svc-shexmap` | 50000 | gRPC | [CLAUDE.md](services/svc-shexmap/CLAUDE.md) |
| `services/svc-pairing` | 50000 | gRPC | [CLAUDE.md](services/svc-pairing/CLAUDE.md) |
| `services/svc-coverage` | 50000 | gRPC | [CLAUDE.md](services/svc-coverage/CLAUDE.md) |
| `services/svc-schema` | 50000 | gRPC | [CLAUDE.md](services/svc-schema/CLAUDE.md) |
| `services/svc-acl` | 50000 | gRPC | [CLAUDE.md](services/svc-acl/CLAUDE.md) |
| `services/svc-auth` | 50000 | HTTP | [CLAUDE.md](services/svc-auth/CLAUDE.md) |
| `services/svc-sparql-proxy` | 50000 | HTTP | [CLAUDE.md](services/svc-sparql-proxy/CLAUDE.md) |
| `services/svc-gateway` | 50000 | HTTP | [CLAUDE.md](services/svc-gateway/CLAUDE.md) |

### AuthContext flow

The gateway verifies the JWT **once** and injects `AuthContext` as gRPC metadata into every downstream call. Backend services never handle JWTs directly — they read trusted metadata.

The JWT is delivered as an `auth_token` httpOnly cookie set by svc-auth on OAuth callback. The gateway accepts the cookie OR an `Authorization: Bearer <token>` header (cookie used as fallback when no Bearer header). When proxying `/api/v1/auth/*` to svc-auth (which uses `@fastify/jwt` itself), the gateway also injects `Authorization: Bearer` from the cookie so `request.jwtVerify()` works upstream.

```
auth_token cookie (httpOnly, SameSite=Lax)  ── or ──  Authorization: Bearer <jwt>
  └── svc-gateway: extractAuth() → AuthContext
        ├── x-auth-user-id    (string, empty = anonymous)
        ├── x-auth-role       ("anonymous" | "user" | "admin")
        └── x-auth-enabled    ("true" | "false")
              └── forwarded as gRPC Metadata to every backend call
```

**Coarse AuthZ** (gateway): anonymous user hitting a write endpoint → HTTP 401.
**Fine AuthZ** (each service): authenticated user not owning the resource → gRPC PERMISSION_DENIED → HTTP 403. svc-shexmap and svc-pairing also consult **svc-acl** (`HasMode` RPC) to allow non-owners who have been explicitly granted `acl:Write` access to edit/delete/version resources.

**ACL model** (svc-acl): W3C WAC `acl:Authorization` triples stored in a dedicated named graph `<https://w3id.org/shexmap/acl>` in QLever. Owners call `GrantWriteAccess`/`RevokeWriteAccess`/`ListWriteAccess` RPCs (exposed via `POST /api/v1/{shexmaps,pairings}/:id/acl/grant`, `/revoke`, `GET .../acl`). `acl:Write` grants let collaborators edit but do **not** allow them to manage access — only the owner can grant/revoke.

**Anonymous-claim rule** (svc-shexmap, svc-pairing): if a resource's `authorId` is empty or `'anonymous'` (i.e. created before auth was turned on), any authenticated user may edit/delete/version it. The frontend mirrors this rule when rendering Edit-vs-Fork UI. This avoids a destructive migration of legacy data when auth is enabled later.

### Proto contracts

All service APIs are defined as Protocol Buffer files in `services/shared/proto/`. These are the source of truth — the TypeScript interfaces in `services/shared/src/types/index.ts` mirror them manually.

Proto files are loaded **dynamically at runtime** with `@grpc/proto-loader` (no protoc/code-gen step required).

### Monorepo workspace

```
package.json          root workspace (npm workspaces: ["services/*"])
services/
  shared/             @shexmap/shared — internal, never deployed
  svc-validate/       @shexmap/svc-validate
  svc-shexmap/        @shexmap/svc-shexmap
  ...
```

Install all: `npm install` at root. Install single service: `npm install --workspace=services/svc-validate`.

### Key Directories

- [api/src/](api/src/) — Fastify server; all `process.env` reads live in [api/src/config.ts](api/src/config.ts)
- [api/src/plugins/](api/src/plugins/) — Fastify plugins (cors, auth, sparqlClient, swagger)
- [api/src/routes/v1/](api/src/routes/v1/) — REST API routes (`/api/v1/shexmaps`, `/coverage`, `/users`, `/auth`)
- [api/src/routes/sparqlProxy.ts](api/src/routes/sparqlProxy.ts) — transparent proxy from `/sparql` to QLever
- [api/src/services/](api/src/services/) — business logic (shexmap CRUD, ShEx validation, SPARQL helpers, coverage)
- [api/src/rdf/](api/src/rdf/) — RDF prefix map and SPARQL query helpers
- [frontend/src/api/](frontend/src/api/) — typed React Query hooks for all API endpoints
- [frontend/src/store/authStore.ts](frontend/src/store/authStore.ts) — Zustand auth state (in-memory; the JWT lives in the httpOnly `auth_token` cookie, not in localStorage)
- [frontend/e2e/](frontend/e2e/) — Playwright e2e tests with mocked `/api/v1/*` routes; covers ownership UI, fork flow, schemas-tab regression. Run with `npm run test:e2e` from `frontend/`.
- [frontend/src/pages/CreatePairingPage.tsx](frontend/src/pages/CreatePairingPage.tsx) — full pairing create/edit workflow (see below)
- [frontend/src/components/graph/](frontend/src/components/graph/) — ReactFlow mapping visualisation
- [frontend/src/components/coverage/](frontend/src/components/coverage/) — Recharts coverage heatmap
- [sparql/ontology/shexmap.ttl](sparql/ontology/shexmap.ttl) — RDF ontology; defines all vocabulary used in the triplestore
- [sparql/seed/](sparql/seed/) — optional seed Turtle files loaded into QLever on first start (subdirs: `shexmaps/`, `pairings/`); starts empty — add `.ttl` files here to pre-populate
- [sparql/backup/](sparql/backup/) — Turtle backups written by `scripts/backup-db.sh`
- [sparql/queries/](sparql/queries/) — reference SPARQL queries (`.rq` = SELECT, `.ru` = UPDATE)
- [docker/nginx/nginx.conf](docker/nginx/nginx.conf) — reverse proxy routing for all services

### Create Pairing Page (`/pairings/create`)

`CreatePairingPage.tsx` is the main authoring UI. Key behaviours:

**Side panels (source & target)**
- Each panel has a ShExMap selector, a versioned Monaco ShEx editor, a Sample Turtle Data editor, and a Focus IRI input.
- Turtle data and focus IRI are persisted to `localStorage` keyed by `mapId` (`shexmap-turtle-data` and `shexmap-focus-iri` keys) and restored automatically when a map is selected.
- When a pairing is loaded (`?id=`), the stored `sourceFocusIri` and `targetFocusIri` are also restored from the SPARQL pairing record.
- Each panel has its own **Validate** button (in the Focus IRI row) that POSTs just that side's ShEx + Turtle + focus node to `POST /api/v1/validate` and shows a compact binding summary inline. Enabled only when all three inputs are present.

**Shared variable highlighting**
- `buildVarColorMap` computes which `%Map:{ variable %}` names appear in both ShExMaps; matched variables are colour-coded, unmatched are greyed.

**Paired validation (section 3)**
- Direction toggle: Source→Target or Target→Source.
- **Validate** extracts bindings from the active source side.
- **Validate & Materialise** additionally generates target RDF using the target ShEx.

**Save / version**
- "Save Pairing" (new) or "Update Pairing" (edit) saves pairing metadata to QLever. On update, it also creates a `ShExMapPairingVersion` snapshot atomically. An optional change-note input appears next to the button when editing.
- Saving also stores `sourceFocusIri` and `targetFocusIri` in the pairing record in QLever.
- A separate **↓ Download** button exports the full pairing (metadata + both ShEx contents + focus IRIs) as a JSON file. It is enabled only after the pairing has been saved at least once.
- Version history is shown via a **History (n)** button that appears once snapshots exist.

**Pairing data model additions**
- `shexmap:sourceFocusIri` and `shexmap:targetFocusIri` datatype properties added to `ShExMapPairing` in the ontology, model, service (GET/create/update), and frontend types. Requires a QLever index rebuild (`./scripts/rebuild-index.sh`) to take effect on the ontology.

### Data Model (RDF)

All ShExMap data is stored as RDF in QLever. The ontology is at [sparql/ontology/shexmap.ttl](sparql/ontology/shexmap.ttl).

Core IRI patterns:
- ShExMap: `https://w3id.org/shexmap/resource/{uuid}`
- User: `https://w3id.org/shexmap/resource/user/{id}`
- Schema: `https://w3id.org/shexmap/resource/schema/{id}`

### Authentication

Auth is auto-enabled when `OAUTH_GITHUB_CLIENT_ID` is present in svc-auth's environment; otherwise the platform is fully public read+write.
The session token is a JWT delivered via an httpOnly `auth_token` cookie (set by svc-auth on OAuth callback, cleared on `POST /auth/logout`). Bearer-header tokens are also accepted as a fallback.
**OAuth providers: GitHub only.** ORCID and Google are *not* currently wired up in svc-auth (they're listed in the original CLAUDE.md as future targets but have no implementation yet).

### QLever Notes

QLever builds an on-disk index at startup from Turtle files — it is **not** a live-append store like Fuseki. Updates go through SPARQL UPDATE via `config.qlever.updateUrl`. If QLever's UPDATE endpoint is unavailable, the index must be rebuilt via `./scripts/rebuild-index.sh`.

The index build runs in the `qlever-init` init-container and gates all other services via `depends_on: condition: service_completed_successfully`.

**Index builder**: `init-index.sh` calls `/qlever/qlever-index` directly (not the `qlever` CLI wrapper, which requires a Qleverfile and fails in headless mode).

**Rebuild script** (`scripts/rebuild-index.sh`): bypasses the `qlever-perms`/`qlever-init` compose dependency chain entirely — it uses a plain `docker run` as root to clear the volume and rebuild, avoiding a persistent docker volume permission issue where `qlever-perms` (chmod 777) does not take effect for the subsequent `qlever-init` container mount. Seed files from `sparql/seed/` and the ontology from `sparql/ontology/` are merged and indexed. **Wipes all runtime data.**

**Backup script** (`scripts/backup-db.sh`): issues a `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }` query against the live QLever SPARQL endpoint and saves the result as Turtle to `sparql/backup/`. Requires QLever to be running.

**Restore script** (`scripts/restore-db.sh`): stops QLever, rebuilds the index from a Turtle backup file, and restarts QLever. Prompts for confirmation before proceeding. Use this to recover from a rebuild that wiped needed data.

**No sample data by default**: `sparql/seed/` directories are empty. The QLever index starts with only the ontology triples. Add `.ttl` files under `sparql/seed/shexmaps/` or `sparql/seed/pairings/` to pre-populate on fresh index builds.

**ShEx version content**: ShExMap version content is stored directly in SPARQL as the `shexmap:versionContent` literal on each `ShExMapVersion` node — there is no filesystem file store.
