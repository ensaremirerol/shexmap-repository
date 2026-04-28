# svc-acl — WAC Authorization Catalogue

**Protocol:** gRPC (port 50000)
**Dependencies:** QLever (SPARQL SELECT / ASK / UPDATE)

## Responsibility

Owns the W3C Web Access Control authorization records for ShExMap resources. Stores `acl:Authorization` instances in a single dedicated SPARQL named graph and exposes Has/Grant/Revoke/List/Purge RPCs. **No auth enforcement at this layer** — svc-acl trusts its callers (services on the internal Docker network). Callers (svc-shexmap, svc-pairing) perform the owner check before forwarding.

## Proto contract

`services/shared/proto/acl.proto` → service `shexmap.acl.AclService`

```
rpc HasMode            (HasModeRequest)            returns (HasModeResponse)
rpc GrantMode          (GrantModeRequest)          returns (GrantModeResponse)
rpc RevokeMode         (RevokeModeRequest)         returns (RevokeModeResponse)
rpc ListAuthorizations (ListAuthorizationsRequest) returns (ListAuthorizationsResponse)
rpc PurgeResource      (PurgeResourceRequest)      returns (PurgeResourceResponse)
```

Field shapes (snake_case wire / camelCase service-layer):

```
HasModeRequest        { resource_iri, agent_iri, mode }
HasModeResponse       { allowed }
GrantModeRequest      { resource_iri, agent_iri, mode }
GrantModeResponse     { authorization_iri }
RevokeModeRequest     { resource_iri, agent_iri, mode }
RevokeModeResponse    { deleted_count }
ListAuthorizationsResponse { items: [{ authorization_iri, resource_iri, agent_iri, mode }] }
PurgeResourceResponse { deleted_count }
```

## Storage layout

All triples live in **one** named graph:

```
GRAPH <https://w3id.org/shexmap/acl> {
  shexrauth:<uuid>
      a            acl:Authorization ;
      acl:accessTo <resource-iri> ;
      acl:agent    <user-iri> ;
      acl:mode     acl:Write .
}
```

Rationale for one graph (not one-per-resource):

- A single `DROP GRAPH` rolls back the entire ACL feature without touching content data.
- Cross-resource queries (e.g. "all resources user X can write") become trivial.
- QLever's SPARQL UPDATE support is treated as experimental; minimising graph churn keeps the surface small.

Authorization nodes get stable UUID IRIs under `shexrauth:` rather than blank nodes, which keeps revocation queries simple. The `dct:creator` ownership triple in the resource service is **additional** to ACL — ACL is a "who else" grant, not a replacement for ownership.

## Supported modes

`SUPPORTED_MODES = ['Write']`. Any other mode value (e.g. `Read`, `Append`, `Control`) is rejected with `INVALID_ARGUMENT`. The mode is a string in the proto so future modes can be added without a schema change.

## Trust model

| Layer | Responsibility |
|---|---|
| Gateway | JWT verification, AuthContext injection |
| Resource service (svc-shexmap, svc-pairing) | **Owner check** — only the resource owner (or admin) may call `GrantMode`/`RevokeMode` for that resource. svc-acl does not re-verify this. |
| svc-acl | Mode-vocabulary validation only. Reads `AuthContext` from gRPC metadata (`x-auth-user-id`, `x-auth-role`, `x-auth-enabled`) for **logging only**. |

This is intentional. Putting ownership logic in svc-acl would force it to know about every resource type's ownership predicate — a concern that already lives in the resource services.

## Idempotency

`GrantMode` does an internal `listAuthorizations` lookup first. If an `acl:Authorization` node already matches `(resource, agent, mode)`, its existing IRI is returned and no INSERT is issued. This makes the RPC safe to retry and prevents duplicate authorization nodes for the same triple-set.

## Lifecycle

- When a resource is deleted, the resource service calls `PurgeResource(resourceIri)` to clean up dangling authorizations. svc-acl never observes resource lifecycle events itself.
- A failure of `PurgeResource` is non-fatal for the caller — dangling ACL triples are harmless because the resource IRI no longer matches anything.

## Directory layout

```
src/
  index.ts
  config.ts             PORT=50000, QLEVER_*, BASE_NAMESPACE
  server.ts             grpc.Server + AclService handlers; mode validation, auth-metadata logging
  sparql.ts             createSparqlClient + buildPrefixes wiring
  services/
    acl.service.ts      hasMode, grantMode, revokeMode, listAuthorizations, purgeResource
test/
  acl.service.test.ts   service-level unit tests (mock sparqlAsk/sparqlSelect/sparqlUpdate)
  acl.handler.test.ts   gRPC handler tests (mock service layer)
```

## SPARQL templates

See `src/services/acl.service.ts` for the source of truth. Summary:

| Operation | Shape |
|---|---|
| `hasMode` | `ASK { GRAPH <…/acl> { ?auth a acl:Authorization ; acl:accessTo <…> ; acl:agent <…> ; acl:mode acl:Write } }` |
| `grantMode` | `INSERT DATA { GRAPH <…/acl> { <newIri> a acl:Authorization ; acl:accessTo <…> ; acl:agent <…> ; acl:mode acl:Write } }` |
| `revokeMode` | `DELETE { GRAPH <…/acl> { ?auth ?p ?o } } WHERE { GRAPH <…/acl> { ?auth a acl:Authorization ; acl:accessTo <…> ; acl:agent <…> ; acl:mode acl:Write ; ?p ?o } }` |
| `listAuthorizations` | `SELECT ?auth ?agent ?mode WHERE { GRAPH <…/acl> { ?auth a acl:Authorization ; acl:accessTo <…> ; acl:agent ?agent ; acl:mode ?mode } }` |
| `purgeResource` | `DELETE { GRAPH <…/acl> { ?auth ?p ?o } } WHERE { GRAPH <…/acl> { ?auth a acl:Authorization ; acl:accessTo <…> ; ?p ?o } }` |

## Known limitations

- **Backups don't preserve named graphs.** `scripts/backup-db.sh` issues a default `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }` and writes Turtle, which loses graph names. The ACL graph round-trips into the *default* graph on restore. Acceptable for v1; a future enhancement would emit TriG.
- **No audit log of grant/revoke events.** Caller `userId` is logged at INFO when `authEnabled=true`, but there is no persisted audit trail.
- **Only `acl:Write`.** Read visibility, Append, Control, agentClass, agentGroup are out of scope until Branch 5.

## Dependencies

```json
{
  "@grpc/grpc-js": "^1.10.0",
  "@grpc/proto-loader": "^0.7.0",
  "@shexmap/shared": "*",
  "sparql-http-client": "^3.0.0",
  "uuid": "^11.0.0",
  "dotenv": "^16.0.0"
}
```

---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-acl-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
