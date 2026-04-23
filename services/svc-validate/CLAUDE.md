# svc-validate — ShEx Validation Engine

**Protocol:** gRPC (port 50000)
**Dependencies:** none — pure CPU computation, no QLever, no auth

## Responsibility

Parse ShEx schemas, validate RDF graphs against them, extract `%Map:{ variable %}` bindings, and materialise target RDF. Stateless: every request is independent.

## Proto contract

`services/shared/proto/validate.proto` → service `shexmap.validate.ValidateService`

```
rpc Validate(ValidateRequest) returns (ValidateResponse)
```

Input fields (all strings, empty string = not provided):
- `source_shex` — ShEx schema for source shape (required)
- `source_rdf`  — Turtle RDF for source data (optional)
- `source_node` — focus node IRI or `IRI@ShapeLabel` (optional)
- `target_shex` — ShEx schema for target shape (optional, enables materialisation)
- `target_node` — target focus node IRI (optional)

Output: `ValidateResponse` with `shex_valid`, `rdf_valid`, `valid`, `bindings` map, `binding_tree`, `target_rdf`, `errors`.

## AuthContext

Read from gRPC metadata (see `services/shared/CLAUDE.md`). This service does **not** enforce any auth — it is a pure compute engine called only by `svc-gateway`, which has already verified the JWT. There is no private data here.

## Directory layout

```
src/
  index.ts                  entry point — calls startServer()
  config.ts                 reads PORT, LOG_LEVEL, BASE_NAMESPACE
  server.ts                 creates grpc.Server, registers ValidateService handler
  types.ts                  local TS interfaces (BindingEntry, BindingNode, ValidationResult)
  services/
    shex.service.ts         parseShEx(content, shapeBase) — wraps @shexjs/parser
    validate.service.ts     validate(sourceShEx, shapeBase, ...) — full validation pipeline
proto/
  validate.proto            copied from services/shared/proto/ at build time
test/
  validate.test.ts          pure unit tests, zero mocks needed
Dockerfile                  multi-stage (dev / builder / production); build from services/ context
```

## Running locally

```bash
# Install deps and copy proto files
npm install
cp -r ../shared/proto ./proto

# Hot-reload dev mode
npm run dev

# Build (compiles TS + copies protos to ./proto)
npm run build

# Run production build
npm start

# Tests
npm test
```

## Docker

```bash
# From the services/ directory:
docker build -f svc-validate/Dockerfile -t svc-validate .             # production
docker build -f svc-validate/Dockerfile --target dev -t svc-validate:dev .  # dev (tsx watch)
```

The proto file is resolved at runtime from `./proto/validate.proto` (next to the service root). The `dev` Docker stage mounts source at `/app/src` and uses `tsx watch` for hot-reload; the production stage contains only compiled `dist/` and `node_modules`.

## Config

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | `50000` | gRPC listen port |
| `LOG_LEVEL` | `info` | Log verbosity |
| `BASE_NAMESPACE` | `https://w3id.org/shexmap/` | ShEx shapeBase prefix |

## Tests

Zero mocks needed because the service has zero I/O:

```ts
import { validate } from '../src/services/validate.service.js';
const result = await validate(shexString, shapeBase, rdfString, focusNode);
expect(result.bindings['http://...#given']).toBe('Alice');
```

---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-validate-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
