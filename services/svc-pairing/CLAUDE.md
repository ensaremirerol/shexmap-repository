# svc-pairing — ShExMap Pairing CRUD + Versioning

**Protocol:** gRPC (port 50000 — uniform internal port across all backend services)
**Dependencies:** QLever (SPARQL), svc-shexmap (optional existence check via gRPC), svc-acl (gRPC — write-access checks + manage-access RPCs)

## Responsibility

Create, read, update, delete ShExMapPairings (which link two ShExMaps) and snapshot pairing versions.

## Proto contract

`services/shared/proto/pairing.proto` → service `shexmap.pairing.PairingService`

```
rpc ListPairings        (ListPairingsRequest) returns (ListPairingsResponse)
rpc GetPairing          (GetPairingRequest)   returns (PairingResponse)
rpc CreatePairing       (CreatePairingRequest) returns (PairingResponse)
rpc UpdatePairing       (UpdatePairingRequest) returns (PairingResponse)
rpc DeletePairing       (DeletePairingRequest) returns (DeletePairingResponse)
rpc ListPairingVersions (ListPVRequest)        returns (ListPVResponse)
rpc GetPairingVersion   (GetPVRequest)         returns (PVResponse)
rpc SavePairingVersion  (SavePVRequest)        returns (PVResponse)
rpc GrantWriteAccess    (AccessRequest)        returns (AccessGrantResponse)
rpc RevokeWriteAccess   (AccessRequest)        returns (AccessRevokeResponse)
rpc ListWriteAccess     (ListAccessRequest)    returns (ListAccessResponse)
```

Note: `pairing.proto` imports `shexmap.proto` for the embedded `ShexMap` message type.

## Manage Access RPCs

`GrantWriteAccess`, `RevokeWriteAccess`, and `ListWriteAccess` expose the per-pairing ACL surface to the gateway. Internally they:

1. Read `AuthContext` from gRPC metadata.
2. `getShExMapPairing(pairing_id)` — `NOT_FOUND` if absent.
3. Owner check (owner / admin / unclaimed). `acl:Write` grants do **not** confer manage-access privileges. Returns `PERMISSION_DENIED` otherwise.
4. Derive `resourceIri = ${prefixes.shexrpair}${id}` and `agentIri = ${prefixes.shexruser}${agent_user_id}`.
5. Forward to svc-acl (`GrantMode` / `RevokeMode` / `ListAuthorizations`) with the caller's AuthContext attached as gRPC metadata.
6. Translate svc-acl's wire shape into PairingService responses. For `ListWriteAccess`, the user UUID is extracted from the agent IRI by stripping `prefixes.shexruser`.

The gateway exposes them at:

```
POST /api/v1/pairings/:id/acl/grant   { agentUserId }
POST /api/v1/pairings/:id/acl/revoke  { agentUserId }
GET  /api/v1/pairings/:id/acl
```

`POST` requires authentication; `GET` is public so collaborators can see who has access.

## AuthContext & AuthZ

Same pattern as svc-shexmap:

| Operation | Rule |
|-----------|------|
| List / Get | Public |
| Create | Requires authenticated user when `authEnabled=true` |
| Update | Owner OR admin OR unclaimed OR svc-acl `acl:Write` grant for `(pairing, ctx.userId)` |
| Delete | Owner OR admin OR unclaimed OR svc-acl `acl:Write` grant; on success, best-effort `PurgeResource` is fired and any failure is logged but does not roll back the delete |
| SaveVersion | Same rule as Update (owner / admin / unclaimed / acl:Write grant) |
| GrantWriteAccess / RevokeWriteAccess / ListWriteAccess | Owner OR admin OR unclaimed (List is also public). An `acl:Write` grant alone does **not** confer the right to manage access — only the owner can grant/revoke. |

A pairing is **unclaimed** when its `authorId` is empty or equal to `'anonymous'` — i.e. created before auth was enabled.

## Directory layout to create

```
src/
  index.ts
  config.ts              PORT=50000, QLEVER_*, BASE_NAMESPACE,
                         SVC_SHEXMAP_URL (gRPC address for existence check),
                         SVC_ACL_URL (gRPC address for ACL service),
                         STRICT_MAP_EXISTS_CHECK=true/false
  server.ts
  sparql.ts
  services/
    pairing.service.ts   listShExMapPairings, getShExMapPairing,
                         createShExMapPairing, updateShExMapPairing, deleteShExMapPairing
    pairing-version.service.ts  savePairingVersion, listPairingVersions, getPairingVersion
test/
  pairing.service.test.ts
  pairing-version.service.test.ts
  pairing.handler.test.ts
```

## Source to migrate

- `api/src/services/shexmap.service.ts` → pairing functions (lines 307–597) → `src/services/pairing.service.ts`
- `api/src/services/pairing-version.service.ts` → `src/services/pairing-version.service.ts` (unchanged)

Replace `FastifyInstance` with `SimpleClient`.

## Optional existence check

When `STRICT_MAP_EXISTS_CHECK=true`, on `createPairing`, call svc-shexmap:

```ts
const mapClient = createGrpcClient('svc-shexmap:50052', shexmapProto);
const res = await mapClient.GetShexMap({ id: data.sourceMapId });
if (!res.found) throw grpcError(status.NOT_FOUND, 'Source ShExMap not found');
```

When `STRICT_MAP_EXISTS_CHECK=false` (default), skip the check and rely on RDF graph semantics.

## SPARQL IRI prefixes

```
Pairing IRI: shexrpair:<uuid>
Version IRI: shexrversion:<pairingId>-v<n>
```

## TDD

Mock `sparqlSelect` and `sparqlUpdate`. Test that:
- `listShExMapPairings` builds correct FILTER clauses
- `createShExMapPairing` emits an `INSERT DATA` with all required triples
- `savePairingVersion` increments version number correctly

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

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-pairing-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
