# Proposal: Add Grant/Revoke/List write-access RPCs to ShexMapService

**Requesting service:** svc-shexmap
**Date:** 2026-04-29
**STATUS:** APPROVED (implemented in this branch — Branch 3 of svc-acl introduction)

## What change is needed

Three new RPC methods on `shexmap.map.ShexMapService` (`services/shared/proto/shexmap.proto`) that expose ACL write-access management to the gateway/frontend, plus the supporting message types.

## Why it belongs in shared

The gateway (`svc-gateway`) needs the ShexMapService client surface to include these RPCs so it can translate `POST /api/v1/shexmaps/:id/acl/grant` etc. into gRPC calls. Both svc-shexmap and svc-gateway load `shexmap.proto` from `shared/proto`, so the contract must live here.

## Proposed change

```proto
// In shexmap.proto, service ShexMapService — append:
rpc GrantWriteAccess   (AccessRequest)     returns (AccessGrantResponse);
rpc RevokeWriteAccess  (AccessRequest)     returns (AccessRevokeResponse);
rpc ListWriteAccess    (ListAccessRequest) returns (ListAccessResponse);

message AccessRequest        { string map_id = 1; string agent_user_id = 2; }
message AccessGrantResponse  { string authorization_iri = 1; }
message AccessRevokeResponse { int32 deleted_count = 1; }
message ListAccessRequest    { string map_id = 1; }
message ListAccessResponse   { repeated AccessEntry items = 1; }
message AccessEntry {
  string authorization_iri = 1;
  string agent_user_id     = 2;
  string mode              = 3;
}
```

## Impact on other services

- **svc-shexmap** — implements the three new handlers. Delegates to svc-acl (`GrantMode`/`RevokeMode`/`ListAuthorizations`) after performing the owner check.
- **svc-gateway** — gains three HTTP routes that proxy to these RPCs. No proto-level breakage since these are additive RPCs.
- **svc-pairing** — unaffected by this change (Branch 4 will add the analogous trio to PairingService via a separate proposal).
- **frontend** — Branch 5 will add hooks; not affected by the proto change directly.

Additive, no field-number reuse. Backwards compatible.
