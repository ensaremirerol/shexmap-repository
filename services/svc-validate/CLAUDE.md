# svc-validate — ShEx Validation Engine

**Protocol:** gRPC (port 50051)
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
test/
  validate.test.ts          pure unit tests, zero mocks needed
```

## Implementation notes

`svc-validate` has **already been scaffolded** as a reference implementation. See the existing files in `src/`. All business logic is migrated from `api/src/services/shexmap-validate.service.ts`.

The only config this service reads: `PORT` (default 50051), `BASE_NAMESPACE` (used as ShEx `shapeBase`).

## TDD

Tests need **zero mocks** because the service has zero I/O:

```ts
import { validate } from '../src/services/validate.service.js';
const result = await validate(shexString, shapeBase, rdfString, focusNode);
expect(result.bindings['http://...#given']).toBe('Alice');
```

Run: `npm test` inside this directory.

## Dependencies

```json
{
  "@grpc/grpc-js": "^1.10.0",
  "@grpc/proto-loader": "^0.7.0",
  "@shexjs/parser": "^1.0.0-alpha.28",
  "n3": "^1.17.0",
  "dotenv": "^16.0.0"
}
```


---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-validate-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
