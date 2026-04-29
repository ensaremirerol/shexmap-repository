import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AclEntry {
  authorizationIri: string;
  agentUserId: string;
  mode: string;
}

// ─── ShExMap ACL hooks ────────────────────────────────────────────────────────

export function useShExMapAcl(mapId: string) {
  return useQuery<AclEntry[]>({
    queryKey: ['shexmap-acl', mapId],
    queryFn: () =>
      apiClient.get(`/shexmaps/${mapId}/acl`).then((r) => r.data as AclEntry[]),
    enabled: !!mapId,
  });
}

export function useGrantShExMapAcl(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentUserId: string) =>
      apiClient
        .post(`/shexmaps/${mapId}/acl/grant`, { agentUserId })
        .then((r) => r.data as AclEntry),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shexmap-acl', mapId] });
    },
  });
}

export function useRevokeShExMapAcl(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentUserId: string) =>
      apiClient
        .post(`/shexmaps/${mapId}/acl/revoke`, { agentUserId })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shexmap-acl', mapId] });
    },
  });
}

// ─── Pairing ACL hooks ────────────────────────────────────────────────────────

export function usePairingAcl(pairingId: string) {
  return useQuery<AclEntry[]>({
    queryKey: ['pairing-acl', pairingId],
    queryFn: () =>
      apiClient.get(`/pairings/${pairingId}/acl`).then((r) => r.data as AclEntry[]),
    enabled: !!pairingId,
  });
}

export function useGrantPairingAcl(pairingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentUserId: string) =>
      apiClient
        .post(`/pairings/${pairingId}/acl/grant`, { agentUserId })
        .then((r) => r.data as AclEntry),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pairing-acl', pairingId] });
    },
  });
}

export function useRevokePairingAcl(pairingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentUserId: string) =>
      apiClient
        .post(`/pairings/${pairingId}/acl/revoke`, { agentUserId })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pairing-acl', pairingId] });
    },
  });
}
