# svc-pairing — ShExMap Pairing CRUD + Versioning

**Protocol:** gRPC (port 50000)
**Dependencies:** QLever (SPARQL), svc-shexmap (optional existence check via gRPC)

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
```

Note: `pairing.proto` imports `shexmap.proto` for the embedded `ShexMap` message type.

## AuthContext & AuthZ

Same pattern as svc-shexmap:

| Operation | Rule |
|-----------|------|
| List / Get | Public |
| Create | Requires authenticated user when `authEnabled=true` |
| Update / Delete / SaveVersion | Owner or admin |

## Directory layout to create

```
src/
  index.ts
  config.ts              PORT=500, QLEVER_*, BASE_NAMESPACE,
                         SVC_SHEXMAP_URL (gRPC address for existence check),
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
