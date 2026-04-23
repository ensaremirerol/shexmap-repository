# svc-shexmap

gRPC service (port 50052) for ShExMap CRUD and versioning. Stores data in QLever via SPARQL UPDATE; calls `svc-validate` over gRPC to validate ShEx content on create.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `50052` | gRPC listen port |
| `QLEVER_SPARQL_URL` | `http://qlever:7001/api/` | QLever SELECT endpoint |
| `QLEVER_UPDATE_URL` | `http://qlever:7001/api/` | QLever UPDATE endpoint |
| `QLEVER_ACCESS_TOKEN` | _(empty)_ | Bearer token for QLever |
| `BASE_NAMESPACE` | `https://w3id.org/shexmap/` | RDF namespace base |
| `SVC_VALIDATE_URL` | `svc-validate:50051` | gRPC address of svc-validate |
| `LOG_LEVEL` | `info` | Log verbosity |

Copy `.env.example` (repo root) to `.env` and adjust values.

## Local development

```bash
# From the repo root — installs all workspace deps
npm install

# Run in watch mode (requires QLever + svc-validate to be reachable)
cd services/svc-shexmap
npm run dev
```

The service loads `proto/shexmap.proto` and `proto/validate.proto` at runtime from the `proto/` directory next to `src/`. In dev mode (`npm run dev`) these are copied from `services/shared/proto/` automatically during the build step; if running directly with `tsx` without building, create the symlink or copy manually:

```bash
cp -r ../shared/proto ./proto
```

## Running tests

```bash
cd services/svc-shexmap
npm test
```

Tests mock `sparqlSelect` / `sparqlUpdate` from `@shexmap/shared` — no live QLever required.

## Building

```bash
npm run build        # compiles TypeScript → dist/ and copies proto files
```

## Docker

Build from the `services/` directory (build context must include `shared/`):

```bash
# Production image
docker build -f svc-shexmap/Dockerfile -t svc-shexmap .

# Development image (tsx hot-reload)
docker build -f svc-shexmap/Dockerfile --target dev -t svc-shexmap:dev .
```

Or use Docker Compose from the repo root:

```bash
docker compose up --build svc-shexmap
```

## gRPC API

Defined in `services/shared/proto/shexmap.proto` — service `shexmap.map.ShexMapService`.

| RPC | Description |
|-----|-------------|
| `ListShexMaps` | Paginated list with full-text / tag / author filters |
| `GetShexMap` | Fetch single map by ID |
| `CreateShexMap` | Create map; validates ShEx content via svc-validate |
| `UpdateShexMap` | Patch scalar fields (uses `has_*` booleans as field masks) |
| `DeleteShexMap` | Hard-delete from QLever |
| `ListVersions` | All version metadata for a map |
| `GetVersion` | Single version metadata |
| `GetVersionContent` | Version metadata + ShEx content |
| `SaveVersion` | Snapshot current content as a new immutable version |

## AuthContext

The gateway injects auth as gRPC metadata headers. This service reads:

- `x-auth-user-id` — user ID (empty = anonymous)
- `x-auth-role` — `"anonymous"` | `"user"` | `"admin"`
- `x-auth-enabled` — `"true"` | `"false"`

Write operations require a non-empty `userId` when `authEnabled=true`. Update/Delete/SaveVersion additionally check ownership (`authorId === userId`) unless the caller is `admin`.
