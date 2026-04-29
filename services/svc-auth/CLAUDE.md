# svc-auth — Authentication + User Management

**Protocol:** HTTP/REST (port 50000) — must be HTTP because OAuth2 callbacks are HTTP redirects
**Dependencies:** QLever (user upsert, API key storage), OAuth2 providers

## Responsibility

Handle OAuth2 login flow (currently **GitHub only** — ORCID and Google are intended future providers but not wired), issue JWTs, manage API keys, and serve user profile/dashboard queries. This is the **only** service that issues JWTs — all other services only verify them (via svc-gateway, which injects AuthContext into gRPC metadata).

**Auth-enabled toggle**: there is no `AUTH_ENABLED` env var. Auth is considered enabled iff `OAUTH_GITHUB_CLIENT_ID` is non-empty.

## HTTP API surface

```
GET  /auth/status                 — is auth enabled? is current JWT valid? returns hydrated user profile from SPARQL
GET  /auth/login/github           — redirect to GitHub OAuth (auth enabled only)
GET  /auth/callback?provider=...  — exchange code, upsert user, issue JWT, set httpOnly cookie, redirect to SPA /auth/callback
POST /auth/logout                 — clears the auth_token cookie server-side
GET  /users/:userId/dashboard     — user's contributions + starred (auth required)
GET  /users/:userId/shexmaps      — user's public ShExMap list
GET  /health
```

## Cookie-based JWT delivery

After OAuth callback, the issued JWT is set as an `auth_token` cookie:

```ts
reply.setCookie('auth_token', token, {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: config.jwt.expiry,
});
```

The browser sends it automatically on every same-origin request — the SPA never sees the token in JS. svc-gateway reads it (and falls back to `Authorization: Bearer`) when building AuthContext. **Logout** clears the cookie via `reply.clearCookie('auth_token', { path: '/' })`.

`GET /auth/status` hydrates the response with the full user profile (name, email) by looking up `sub` against the SPARQL store via `getUserById` — the JWT itself only carries `sub` and `role`.

## OAuth CSRF state — server-side Map

The original cookie-based CSRF state in `@fastify/oauth2` was unreliable behind nginx + cookies in some environments. svc-auth replaces it with a server-side `pendingStates: Map<string, number>` plus TTL pruning. `generateStateFunction` inserts a random hex token; `checkStateFunction` validates and deletes it. See `src/plugins/oauth.ts`.

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
  config.ts              PORT=50000, JWT_SECRET, JWT_EXPIRY,
                         OAUTH_CALLBACK_BASE_URL, OAUTH_GITHUB_CLIENT_ID/SECRET,
                         SQLITE_PATH (for API key storage),
                         QLEVER_SPARQL_URL, QLEVER_UPDATE_URL, QLEVER_ACCESS_TOKEN,
                         BASE_NAMESPACE
                         (no AUTH_ENABLED — auth is on iff OAUTH_GITHUB_CLIENT_ID is set;
                          ORCID/Google providers are not currently wired)
  server.ts              Fastify HTTP server (NOT gRPC)
  sparql.ts
  plugins/
    jwt.ts               @fastify/jwt registration; exposes fastify.signToken(payload)
    oauth.ts             @fastify/oauth2 (GitHub) + server-side state Map for CSRF protection
    cookie.ts            @fastify/cookie registration (must be registered BEFORE oauth.ts)
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
  "@fastify/cookie": "^11.0.0",
  "@fastify/cors": "^11.0.0",
  "@fastify/sensible": "^6.0.0",
  "@shexmap/shared": "*",
  "sparql-http-client": "^3.0.0",
  "uuid": "^11.0.0",
  "dotenv": "^16.0.0"
}
```

**Plugin registration order matters**: `@fastify/cookie` must be registered before `@fastify/oauth2`, otherwise OAuth's cookie-based fallback paths fail at startup.


---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-auth-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
