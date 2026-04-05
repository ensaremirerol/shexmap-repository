# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An online repository platform for **ShExMaps** — mappings between RDF shapes defined by ShEx (Shape Expressions). See [REQUIREMENTS.md](REQUIREMENTS.md) for full requirements.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js with Fastify (`api/`) |
| Triplestore / SPARQL | QLever (`docker/qlever/`) |
| Frontend | React SPA with Vite (`frontend/`) |
| Auth | Optional — OAuth2/OIDC + API keys (`AUTH_ENABLED` env var) |
| Deployment | Docker + Docker Compose |
| ShEx processing | `@shexjs/parser`, `@shexjs/core` |
| Visualization | ReactFlow (mapping graphs), Recharts (coverage heatmaps) |

## Commands

```bash
# Start everything
cp .env.example .env
docker compose up --build

# Development (hot reload — starts api + qlever + nginx)
docker compose up

# Run API in dev mode (outside Docker, requires QLever running separately)
cd api && npm install && npm run dev

# Run frontend dev server
cd frontend && npm install && npm run dev

# Type-check API
cd api && npm run typecheck

# Run tests
cd api && npm test
cd frontend && npm test

# Force full QLever index rebuild (wipes volume, rebuilds from sparql/seed/ + ontology)
./scripts/rebuild-index.sh

# Validate a ShExMap file
npx tsx scripts/validate-shexmap.ts path/to/map.shexmap
```

## Architecture

Services are orchestrated with Docker Compose and communicate over a private `shexmap-net` bridge network. Only nginx is exposed to the host on port 80.

```
Browser → nginx:80
           ├── /api/v1/*  → api:3000   (Fastify REST API)
           ├── /sparql    → api:3000   (proxied to QLever with optional auth)
           └── /*         → static     (React SPA)

api:3000 → qlever:7001  (direct SPARQL queries, not through nginx)
```

### Key Directories

- [api/src/](api/src/) — Fastify server; all `process.env` reads live in [api/src/config.ts](api/src/config.ts)
- [api/src/plugins/](api/src/plugins/) — Fastify plugins (cors, auth, sparqlClient, swagger)
- [api/src/routes/v1/](api/src/routes/v1/) — REST API routes (`/api/v1/shexmaps`, `/coverage`, `/users`, `/auth`)
- [api/src/routes/sparqlProxy.ts](api/src/routes/sparqlProxy.ts) — transparent proxy from `/sparql` to QLever
- [api/src/services/](api/src/services/) — business logic (shexmap CRUD, ShEx validation, SPARQL helpers, coverage)
- [api/src/rdf/](api/src/rdf/) — RDF prefix map and SPARQL query helpers
- [frontend/src/api/](frontend/src/api/) — typed React Query hooks for all API endpoints
- [frontend/src/store/authStore.ts](frontend/src/store/authStore.ts) — Zustand auth state (persisted to localStorage)
- [frontend/src/pages/CreatePairingPage.tsx](frontend/src/pages/CreatePairingPage.tsx) — full pairing create/edit workflow (see below)
- [frontend/src/components/graph/](frontend/src/components/graph/) — ReactFlow mapping visualisation
- [frontend/src/components/coverage/](frontend/src/components/coverage/) — Recharts coverage heatmap
- [sparql/ontology/shexmap.ttl](sparql/ontology/shexmap.ttl) — RDF ontology; defines all vocabulary used in the triplestore
- [sparql/seed/](sparql/seed/) — optional seed Turtle files loaded into QLever on first start (subdirs: `shexmaps/`, `pairings/`); starts empty — add `.ttl` files here to pre-populate
- [sparql/files/](sparql/files/) — versioned ShExMap file store; each map gets a subdirectory `{id}/v{n}.shex`
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
- ShExMap: `https://shexmap.example.org/resource/{uuid}`
- User: `https://shexmap.example.org/resource/user/{id}`
- Schema: `https://shexmap.example.org/resource/schema/{id}`

### Authentication

Auth is entirely behind the `AUTH_ENABLED` environment variable (default: `false`).
When disabled, `requireAuth` preHandlers are no-ops and the platform is fully public read+write.
When enabled, the API supports JWT (Bearer token) and API keys (`X-API-Key` header).
OAuth providers: GitHub, ORCID, Google (wired via `@fastify/oauth2`).

### QLever Notes

QLever builds an on-disk index at startup from Turtle files — it is **not** a live-append store like Fuseki. Updates go through SPARQL UPDATE via `config.qlever.updateUrl`. If QLever's UPDATE endpoint is unavailable, the index must be rebuilt via `./scripts/rebuild-index.sh`.

The index build runs in the `qlever-init` init-container and gates all other services via `depends_on: condition: service_completed_successfully`.

**Index builder**: `init-index.sh` calls `/qlever/qlever-index` directly (not the `qlever` CLI wrapper, which requires a Qleverfile and fails in headless mode).

**Rebuild script**: `scripts/rebuild-index.sh` bypasses the `qlever-perms`/`qlever-init` compose dependency chain entirely — it uses a plain `docker run` as root to clear the volume and rebuild, avoiding a persistent docker volume permission issue where `qlever-perms` (chmod 777) does not take effect for the subsequent `qlever-init` container mount.

**No sample data by default**: `sparql/seed/` directories are empty. The QLever index starts with only the ontology triples. Add `.ttl` files under `sparql/seed/shexmaps/` or `sparql/seed/pairings/` to pre-populate on fresh index builds.
