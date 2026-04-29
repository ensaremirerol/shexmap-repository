# svc-gateway — API Gateway

**Protocol:** HTTP/REST inbound (port 50000), gRPC outbound to backend services, HTTP outbound to svc-auth and svc-sparql-proxy
**Dependencies:** all backend services

## Responsibility

Single entry point for all browser traffic. Verifies JWTs, builds `AuthContext`, injects it as gRPC metadata, translates HTTP ↔ gRPC, and serves as the CORS boundary.

```
Browser (HTTP + JWT)
  └── svc-gateway:50000
        ├── verify JWT → AuthContext metadata
        ├── POST /api/v1/validate    → gRPC svc-validate:50000
        ├── /api/v1/shexmaps/*       → gRPC svc-shexmap:50000
        ├── /api/v1/pairings/*       → gRPC svc-pairing:50000
        ├── /api/v1/coverage/*       → gRPC svc-coverage:50000
        ├── /api/v1/schemas          → gRPC svc-schema:50000
        ├── /api/v1/auth/*           → HTTP  svc-auth:50000
        ├── /api/v1/users/*          → HTTP  svc-auth:50000
        └── /sparql                  → HTTP  svc-sparql-proxy:50000 (+ x-auth-user-id header)
```

## Coarse AuthZ (gateway level)

The gateway enforces route-level rules **before** forwarding:

| Method | Path pattern | Rule |
|--------|-------------|------|
| GET    | any | Always forward (public reads) |
| POST/PATCH/DELETE | `/api/v1/shexmaps/*` | Require non-empty userId when authEnabled |
| POST/PATCH/DELETE | `/api/v1/pairings/*` | Require non-empty userId when authEnabled |
| POST   | `/sparql` | Forward `x-auth-user-id` header to svc-sparql-proxy |
| POST/GET | `/api/v1/auth/*` | Always forward (auth service handles its own rules) |

Return HTTP 401 when auth required but JWT missing/invalid. Fine-grained ownership checks (403) happen inside each backend service.

## JWT verification

```ts
// plugins/auth.ts
import jwt from '@fastify/jwt';
// Register with JWT_SECRET — same secret used by svc-auth to issue tokens
// fastify.decorate('extractAuth', ...) — returns AuthContext from request
```

`svc-gateway` **verifies** but never **issues** JWTs. JWT issuance is svc-auth's job.

### Token sources accepted by `extractAuth`

The gateway accepts the JWT from either of these sources (cookie used as fallback when no Bearer header):

1. `Authorization: Bearer <jwt>` header
2. `auth_token` cookie (httpOnly, set by svc-auth on OAuth callback)

```ts
const cookieHeader = (request.headers['cookie'] as string) ?? '';
const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
rawToken = bearer ?? match?.[1];
```

### Cookie → Bearer injection when proxying to svc-auth

The `/api/v1/auth/*` and `/api/v1/users/*` routes proxy to svc-auth via `undici.request()`. svc-auth uses `@fastify/jwt` and calls `request.jwtVerify()`, which only reads the `Authorization` header. So before forwarding, the gateway extracts the JWT from the `auth_token` cookie and synthesises an `Authorization: Bearer` header. It also forwards `Set-Cookie` from svc-auth back to the browser (so login/logout cookie writes propagate).

## gRPC client setup

```ts
// grpc/clients.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_DIR = join(__dirname, '../../../shared/proto');

export const validateClient = loadClient('validate.proto', 'shexmap.validate.ValidateService', 'svc-validate:50000');
export const shexmapClient  = loadClient('shexmap.proto',  'shexmap.map.ShexMapService',       'svc-shexmap:50000');
export const pairingClient  = loadClient('pairing.proto',  'shexmap.pairing.PairingService',   'svc-pairing:50000');
export const coverageClient = loadClient('coverage.proto', 'shexmap.coverage.CoverageService', 'svc-coverage:50000');
export const schemaClient   = loadClient('schema.proto',   'shexmap.schema.SchemaService',     'svc-schema:50000');

function buildAuthMeta(ctx: AuthContext): grpc.Metadata {
  const md = new grpc.Metadata();
  md.set('x-auth-user-id',    ctx.userId);
  md.set('x-auth-role',       ctx.role);
  md.set('x-auth-enabled',    String(ctx.authEnabled));
  return md;
}
```

## HTTP→gRPC translation helpers

```ts
// Promisify unary gRPC call
function grpcCall<Req, Res>(
  client: grpc.Client,
  method: string,
  request: Req,
  meta: grpc.Metadata,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    (client as any)[method](request, meta, (err: any, res: Res) => {
      if (err) reject(err); else resolve(res);
    });
  });
}
```

## gRPC error → HTTP status mapping

| gRPC status | HTTP status |
|-------------|-------------|
| NOT_FOUND (5) | 404 |
| UNAUTHENTICATED (16) | 401 |
| PERMISSION_DENIED (7) | 403 |
| INVALID_ARGUMENT (3) | 400 |
| INTERNAL (13) | 500 |

## Directory layout to create

```
src/
  index.ts
  config.ts              PORT=50000, JWT_SECRET, AUTH_ENABLED,
                         SVC_VALIDATE_ADDR, SVC_SHEXMAP_ADDR, SVC_PAIRING_ADDR,
                         SVC_COVERAGE_ADDR, SVC_SCHEMA_ADDR,
                         SVC_AUTH_URL, SVC_SPARQL_PROXY_URL
  server.ts              Fastify HTTP server
  plugins/
    auth.ts              JWT verify + fastify.decorate('extractAuth', ...)
    cors.ts
    grpcError.ts         gRPC status → HTTP status helper
  grpc/
    clients.ts           all gRPC client instances
    meta.ts              buildAuthMeta(ctx: AuthContext) → grpc.Metadata
    call.ts              promisified grpcCall helper
  routes/
    validate.ts          POST /api/v1/validate → validateClient
    shexmaps.ts          /api/v1/shexmaps/* → shexmapClient
    pairings.ts          /api/v1/pairings/* → pairingClient
    coverage.ts          /api/v1/coverage/* → coverageClient
    schemas.ts           /api/v1/schemas → schemaClient
    auth.ts              /api/v1/auth/* + /api/v1/users/* → HTTP svc-auth
    sparql.ts            /sparql → HTTP svc-sparql-proxy
    health.ts
test/
  validate.route.test.ts  fastify.inject(); mock grpcCall
  shexmaps.route.test.ts  fastify.inject(); mock grpcCall
  auth.plugin.test.ts     JWT verify with real @fastify/jwt
```

## Route translation example

```ts
// routes/validate.ts
fastify.post('/api/v1/validate', async (request, reply) => {
  const ctx = fastify.extractAuth(request);
  const { sourceShEx, sourceRdf, sourceNode, targetShEx, targetNode } = request.body;
  const meta = buildAuthMeta(ctx);
  const result = await grpcCall(validateClient, 'validate', {
    source_shex: sourceShEx,
    source_rdf:  sourceRdf  ?? '',
    source_node: sourceNode ?? '',
    target_shex: targetShEx ?? '',
    target_node: targetNode ?? '',
  }, meta);
  return reply.send(camelCaseResult(result));
});
```

The gateway translates `snake_case` proto field names → `camelCase` JSON for the frontend. A helper `snakeToCamel(obj)` recursively converts keys.

## Dependencies

```json
{
  "fastify": "^5.0.0",
  "fastify-plugin": "^5.0.0",
  "@fastify/jwt": "^9.0.0",
  "@fastify/cors": "^11.0.0",
  "@fastify/sensible": "^6.0.0",
  "@fastify/http-proxy": "^10.0.0",
  "@grpc/grpc-js": "^1.10.0",
  "@grpc/proto-loader": "^0.7.0",
  "dotenv": "^16.0.0",
  "zod": "^3.23.0"
}
```


---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-gateway-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
