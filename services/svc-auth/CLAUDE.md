# svc-auth — Authentication + User Management

**Protocol:** HTTP/REST (port 50000) — must be HTTP because OAuth2 callbacks are HTTP redirects
**Dependencies:** QLever (user upsert, API key storage), OAuth2 providers

## Responsibility

Handle OAuth2 login flows (GitHub, ORCID, Google), issue JWTs, manage API keys, and serve user profile/dashboard queries. This is the **only** service that issues JWTs — all other services only verify them (via svc-gateway, which injects AuthContext into gRPC metadata).

## HTTP API surface

```
GET  /auth/status                 — is auth enabled? is current JWT valid?
GET  /auth/login?provider=github  — redirect to OAuth provider (auth enabled only)
GET  /auth/callback               — exchange code, upsert user, issue JWT, redirect SPA
POST /auth/logout                 — confirm logout (client drops JWT)
GET  /users/:userId/dashboard     — user's contributions + starred (auth required)
GET  /users/:userId/shexmaps      — user's public ShExMap list
GET  /health
```

## JWT format

```json
{
  "sub": "<userId>",
  "role": "user",
  "iat": 1700000000,
  "exp": 1700086400
}
```

JWT secret: `JWT_SECRET` env var (shared with svc-gateway, which verifies but never issues).

## Directory layout to create

```
src/
  index.ts
  config.ts              PORT=50000, JWT_SECRET, JWT_EXPIRY, AUTH_ENABLED,
                         OAUTH_CALLBACK_BASE_URL, OAUTH_GITHUB_CLIENT_ID/SECRET,
                         OAUTH_ORCID_CLIENT_ID/SECRET, OAUTH_GOOGLE_CLIENT_ID/SECRET,
                         QLEVER_SPARQL_URL, QLEVER_UPDATE_URL, QLEVER_ACCESS_TOKEN,
                         BASE_NAMESPACE
  server.ts              Fastify HTTP server (NOT gRPC)
  sparql.ts
  plugins/
    jwt.ts               @fastify/jwt registration; exposes fastify.signToken(payload)
    oauth.ts             @fastify/oauth2 for each provider (conditional on AUTH_ENABLED)
  routes/
    auth.ts              /auth/* routes
    users.ts             /users/* routes
    health.ts
  services/
    user.service.ts      upsertUser, getUserById (SPARQL)
    apikey.service.ts    createApiKey, listApiKeys, revokeApiKey (SPARQL)
test/
  auth.route.test.ts     fastify.inject(); mock SPARQL + OAuth2 provider
  user.service.test.ts   vi.mock sparqlSelect/sparqlUpdate
```

## Source to migrate

- `api/src/routes/v1/auth.ts` → `src/routes/auth.ts`
- `api/src/routes/v1/users.ts` → `src/routes/users.ts`
- `api/src/plugins/auth.ts` → `src/plugins/jwt.ts` (JWT issue only; verification stays in gateway)

## User SPARQL model

```sparql
INSERT DATA {
  <shexruser:uuid> a schema:Person ;
    schema:name "Alice" ;
    schema:email "alice@example.com" ;
    dct:identifier "github:12345" ;
    dct:created "2024-01-01T00:00:00Z"^^xsd:dateTime .
}
```

## AuthZ

- `/auth/status`, `/auth/login`, `/auth/callback` — always public
- `/auth/logout` — requires valid JWT
- `/users/:id/dashboard` — requires JWT AND `sub === userId` OR `role === 'admin'`
- `/users/:id/shexmaps` — public

## Dependencies

```json
{
  "fastify": "^5.0.0",
  "fastify-plugin": "^5.0.0",
  "@fastify/jwt": "^9.0.0",
  "@fastify/oauth2": "^8.0.0",
  "@fastify/cors": "^11.0.0",
  "@fastify/sensible": "^6.0.0",
  "@shexmap/shared": "*",
  "sparql-http-client": "^3.0.0",
  "uuid": "^11.0.0",
  "dotenv": "^16.0.0"
}
```


---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-auth-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
