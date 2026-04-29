# Proposal: Add Grant/Revoke/List write-access RPCs to PairingService

**Requesting service:** svc-pairing
**Date:** 2026-04-29
**STATUS:** APPROVED (implemented in this branch — Branch 4 of svc-acl introduction)

## What change is needed

Three new RPC methods on `shexmap.pairing.PairingService` (`services/shared/proto/pairing.proto`) that expose ACL write-access management to the gateway/frontend, plus the supporting message types. Mirrors the trio added to `ShexMapService` in Branch 3.

## Why it belongs in shared

The gateway (`svc-gateway`) needs the PairingService client surface to include these RPCs so it can translate `POST /api/v1/pairings/:id/acl/grant` etc. into gRPC calls. Both svc-pairing and svc-gateway load `pairing.proto` from `shared/proto`, so the contract must live here.

## Proposed change

```proto
// In pairing.proto, service PairingService — append:
rpc GrantWriteAccess     (AccessRequest)     returns (AccessGrantResponse);
rpc RevokeWriteAccess    (AccessRequest)     returns (AccessRevokeResponse);
rpc ListWriteAccess      (ListAccessRequest) returns (ListAccessResponse);

message AccessRequest        { string pairing_id = 1; string agent_user_id = 2; }
message AccessGrantResponse  { string authorization_iri = 1; }
message AccessRevokeResponse { int32 deleted_count = 1; }
message ListAccessRequest    { string pairing_id = 1; }
message ListAccessResponse   { repeated AccessEntry items = 1; }
message AccessEntry {
  string authorization_iri = 1;
  string agent_user_id     = 2;
  string mode              = 3;
}
```

Note: the request message is named `AccessRequest` (with `pairing_id`, not `map_id`) so it does not collide with the analogous types in `shexmap.proto` — the two services live in separate proto packages (`shexmap.pairing` vs `shexmap.map`).

## Impact on other services

- **svc-pairing** — implements the three new handlers. Delegates to svc-acl (`GrantMode`/`RevokeMode`/`ListAuthorizations`) after performing the owner check.
- **svc-gateway** — gains three HTTP routes that proxy to these RPCs. No proto-level breakage since these are additive RPCs.
- **svc-shexmap** — unaffected by this change.
- **frontend** — Branch 5 will add hooks; not affected by the proto change directly.

Additive, no field-number reuse. Backwards compatible.
