# svc-sparql-proxy — Public SPARQL Endpoint

**Protocol:** HTTP/REST (port 50000) — must be HTTP; SPARQL protocol is HTTP by spec
**Dependencies:** QLever (transparent relay)

## Responsibility

Relay SPARQL GET (SELECT/CONSTRUCT/ASK) and POST (UPDATE) requests to QLever. The proxy adds the `access-token` auth header that QLever requires. POST (UPDATE) is protected when `AUTH_ENABLED=true` — svc-gateway has already verified the JWT and injects `x-auth-user-id`; this service trusts that header.

## HTTP API surface

```
GET  /sparql          — proxy SPARQL SELECT/CONSTRUCT/ASK to QLever (public)
POST /sparql          — proxy SPARQL UPDATE to QLever (requires auth header when auth enabled)
GET  /health
```

## AuthZ

This service does **not** verify JWTs itself. The gateway has already done so and passes `x-forwarded-user` (or `x-auth-user-id`) as a trusted header. On POST, check that the header is non-empty when `AUTH_ENABLED=true`:

```ts
if (config.authEnabled && !request.headers['x-auth-user-id']) {
  return reply.unauthorized('Authentication required for SPARQL updates');
}
```

Because this service sits behind svc-gateway on the internal Docker network, trusting internal headers is safe — external callers cannot reach this service directly.

## Directory layout to create

```
src/
  index.ts
  config.ts              PORT=50000, QLEVER_SPARQL_URL, QLEVER_UPDATE_URL,
                         QLEVER_ACCESS_TOKEN, AUTH_ENABLED
  server.ts              Fastify HTTP server
  routes/
    sparql.ts            GET + POST handlers
    health.ts
test/
  sparql.route.test.ts   fastify.inject(); vi.mock fetch
```

## Source to migrate

`api/src/routes/sparqlProxy.ts` → `src/routes/sparql.ts`

Remove `fastify.requireAuth` preHandler (auth is enforced by reading `x-auth-user-id` from gateway-injected trusted headers instead of verifying JWT locally).

## Dependencies

```json
{
  "fastify": "^5.0.0",
  "fastify-plugin": "^5.0.0",
  "@fastify/cors": "^11.0.0",
  "@fastify/sensible": "^6.0.0",
  "dotenv": "^16.0.0"
}
```


---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-sparql-proxy-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
