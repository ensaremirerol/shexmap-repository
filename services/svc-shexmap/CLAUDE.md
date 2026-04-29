# svc-shexmap — ShExMap CRUD + Versioning

**Protocol:** gRPC (port 50000)
**Dependencies:** QLever (SPARQL), svc-validate (HTTP call on create if content provided)

## Responsibility

Create, read, update, delete ShExMaps and their immutable version snapshots. Owns the ShExMap resource lifecycle in QLever.

## Proto contract

`services/shared/proto/shexmap.proto` → service `shexmap.map.ShexMapService`

```
rpc ListShexMaps      (ListShexMapsRequest)  returns (ListShexMapsResponse)
rpc GetShexMap        (GetShexMapRequest)    returns (ShexMapResponse)
rpc CreateShexMap     (CreateShexMapRequest) returns (ShexMapResponse)
rpc UpdateShexMap     (UpdateShexMapRequest) returns (ShexMapResponse)
rpc DeleteShexMap     (DeleteShexMapRequest) returns (DeleteResponse)
rpc ListVersions      (ListVersionsRequest)  returns (ListVersionsResponse)
rpc GetVersion        (GetVersionRequest)    returns (VersionResponse)
rpc GetVersionContent (GetVersionRequest)    returns (VersionContentResponse)
rpc SaveVersion       (SaveVersionRequest)   returns (VersionResponse)
rpc GrantWriteAccess  (AccessRequest)        returns (AccessGrantResponse)
rpc RevokeWriteAccess (AccessRequest)        returns (AccessRevokeResponse)
rpc ListWriteAccess   (ListAccessRequest)    returns (ListAccessResponse)
```

## Manage Access RPCs

`GrantWriteAccess`, `RevokeWriteAccess`, and `ListWriteAccess` expose the per-map ACL surface to the gateway. Internally they:

1. Read `AuthContext` from gRPC metadata.
2. `getShExMap(map_id)` — `NOT_FOUND` if absent.
3. Owner check (owner / admin / unclaimed). `acl:Write` grants do **not** confer manage-access privileges. Returns `PERMISSION_DENIED` otherwise.
4. Derive `resourceIri = ${prefixes.shexrmap}${id}` and `agentIri = ${prefixes.shexruser}${agent_user_id}`.
5. Forward to svc-acl (`GrantMode` / `RevokeMode` / `ListAuthorizations`) with the caller's AuthContext attached as gRPC metadata.
6. Translate svc-acl's wire shape into ShexMapService responses. For `ListWriteAccess`, the user UUID is extracted from the agent IRI by stripping `prefixes.shexruser`.

The gateway exposes them at:

```
POST /api/v1/shexmaps/:id/acl/grant   { agentUserId }
POST /api/v1/shexmaps/:id/acl/revoke  { agentUserId }
GET  /api/v1/shexmaps/:id/acl
```

`POST` requires authentication; `GET` is public so collaborators can see who has access.

## AuthContext & AuthZ

Read from gRPC metadata (`x-auth-user-id`, `x-auth-role`, `x-auth-enabled`). Rules:

| Operation | Rule |
|-----------|------|
| List / Get | Always allowed (public) |
| Create | Requires `authEnabled=false` OR non-empty `userId` |
| Update | Owner OR admin OR unclaimed OR svc-acl `acl:Write` grant for `(map, ctx.userId)` |
| Delete | Owner OR admin OR unclaimed OR svc-acl `acl:Write` grant; on success, best-effort `PurgeResource` is fired and any failure is logged but does not roll back the delete |
| SaveVersion | Same rule as Update (owner / admin / unclaimed / acl:Write grant) |
| GrantWriteAccess / RevokeWriteAccess / ListWriteAccess | Owner OR admin OR unclaimed (List is also public). An `acl:Write` grant alone does **not** confer the right to manage access — only the owner can grant/revoke. |

A map is **unclaimed** when its `authorId` is empty or equal to `'anonymous'` — i.e. created before auth was enabled. Any authenticated user may edit/delete/version an unclaimed map (they effectively claim it on first edit). The frontend mirrors this rule when deciding whether to render Edit-vs-Fork UI on `/maps/:id`.

Return `grpc.status.UNAUTHENTICATED` (code 16) when auth required but no user. Return `grpc.status.PERMISSION_DENIED` (code 7) when user is not the owner.

## Directory layout to create

```
src/
  index.ts               entry point
  config.ts              PORT=50000, QLEVER_SPARQL_URL, QLEVER_UPDATE_URL,
                         QLEVER_ACCESS_TOKEN, BASE_NAMESPACE, SVC_VALIDATE_URL
  server.ts              grpc.Server + ShexMapService handler
  sparql.ts              createSparqlClient + buildPrefixes (wires config → shared)
  services/
    shexmap.service.ts   listShExMaps, getShExMap, createShExMap, updateShExMap, deleteShExMap
    version.service.ts   listVersions, getVersion, getVersionContent, saveNewVersion
test/
  shexmap.service.test.ts  vi.mock sparqlSelect/sparqlUpdate; test SPARQL query shapes
  version.service.test.ts  vi.mock sparqlSelect/sparqlUpdate; test version numbering
  shexmap.handler.test.ts  gRPC handler integration with mocked services
```

## Source to migrate

- `api/src/services/shexmap.service.ts` → `src/services/shexmap.service.ts` (ShExMap functions only — remove pairing functions)
- `api/src/services/version.service.ts` → `src/services/version.service.ts` (unchanged)

Replace `FastifyInstance` parameter with `SimpleClient` from `@shexmap/shared`. Replace `sparqlSelect(fastify, ...)` calls with `sparqlSelect(client, prefixes, ...)`.

On `createShExMap` with `content`: call `SVC_VALIDATE_URL` (HTTP POST to `http://svc-validate-http:3080/validate` — note: svc-validate also exposes a thin HTTP wrapper for this, OR call gRPC client directly).

**Simpler approach:** expose a gRPC client to `svc-validate` inside `svc-shexmap` and call `validate()` via gRPC for content validation on create.

## SPARQL IRI prefixes

```
ShExMap IRI: shexrmap:<uuid>  (e.g. https://w3id.org/shexmap/resource/map/<uuid>)
Version IRI: shexrversion:<mapId>-v<n>
User IRI:    shexruser:<userId>
```

Use `buildPrefixes(config.baseNamespace)` from `@shexmap/shared`.

## TDD

```ts
// shexmap.service.test.ts
vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, sparqlSelect: vi.fn(), sparqlUpdate: vi.fn() };
});

test('getShExMap returns null when SPARQL returns empty', async () => {
  vi.mocked(sparqlSelect).mockResolvedValue([]);
  expect(await getShExMap(mockClient, prefixes, 'nonexistent-id')).toBeNull();
});
```

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

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-shexmap-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
