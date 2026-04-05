import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client.js';

// ─── Individual ShExMap ───────────────────────────────────────────────────────

export interface ShExFile {
  fileName: string;
  title?: string;
  fileFormat: string;
  sourceUrl?: string;
}

export interface ShExMap {
  id: string;
  title: string;
  description?: string;
  content?: string;
  fileName?: string;
  fileFormat: string;
  sourceUrl?: string;
  schemaUrl?: string;
  sourceSchemaUrl?: string;
  targetSchemaUrl?: string;
  sourceFiles?: ShExFile[];
  targetFiles?: ShExFile[];
  tags: string[];
  version: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  modifiedAt: string;
  stars: number;
}

export interface ShExMapListResult {
  items: ShExMap[];
  total: number;
}

export interface ShExMapFilters {
  q?: string;
  tag?: string;
  author?: string;
  schemaUrl?: string;
  page?: number;
  limit?: number;
  sort?: 'created' | 'modified' | 'title' | 'stars';
  order?: 'asc' | 'desc';
}

export function useShExMaps(filters: ShExMapFilters = {}) {
  return useQuery<ShExMapListResult>({
    queryKey: ['shexmaps', filters],
    queryFn: () => apiClient.get('/shexmaps', { params: filters }).then((r) => r.data),
  });
}

export function useShExMap(id: string) {
  return useQuery<ShExMap>({
    queryKey: ['shexmap', id],
    queryFn: () => apiClient.get(`/shexmaps/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateShExMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      content: string;
      sourceSchemaUrl?: string;
      targetSchemaUrl?: string;
      tags: string[];
      version: string;
      license?: string;
    }) => apiClient.post('/shexmaps', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shexmaps'] }),
  });
}

export function useUpdateShExMap(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title?: string;
      description?: string;
      tags?: string[];
      version?: string;
      sourceUrl?: string;
      schemaUrl?: string;
    }) => apiClient.patch(`/shexmaps/${id}`, data).then((r) => r.data as ShExMap),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shexmap', id] });
      qc.invalidateQueries({ queryKey: ['shexmaps'] });
    },
  });
}

export function useDeleteShExMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/shexmaps/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shexmaps'] }),
  });
}

// ─── ShExMap Versions ─────────────────────────────────────────────────────────

export interface ShExMapVersion {
  id: string;
  mapId: string;
  versionNumber: number;
  filePath: string;
  commitMessage?: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface ShExMapVersionWithContent extends ShExMapVersion {
  content: string;
}

export function useShExMapVersions(mapId: string) {
  return useQuery<ShExMapVersion[]>({
    queryKey: ['shexmap-versions', mapId],
    queryFn: () => apiClient.get(`/shexmaps/${mapId}/versions`).then((r) => r.data),
    enabled: !!mapId,
  });
}

export function useShExMapVersion(mapId: string, versionNumber: number | null) {
  return useQuery<ShExMapVersionWithContent>({
    queryKey: ['shexmap-version', mapId, versionNumber],
    queryFn: () =>
      apiClient.get(`/shexmaps/${mapId}/versions/${versionNumber}`).then((r) => r.data),
    enabled: !!mapId && versionNumber !== null,
  });
}

export function useSaveShExMapVersion(mapId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string; commitMessage?: string }) =>
      apiClient.post(`/shexmaps/${mapId}/versions`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shexmap-versions', mapId] });
      qc.invalidateQueries({ queryKey: ['shexmap', mapId] });
    },
  });
}

// ─── ShExMap Pairing ──────────────────────────────────────────────────────────

export interface ShExMapPairing {
  id: string;
  title: string;
  description?: string;
  sourceMap: ShExMap;
  targetMap: ShExMap;
  sourceFocusIri?: string;
  targetFocusIri?: string;
  tags: string[];
  license?: string;
  version: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  modifiedAt: string;
  stars: number;
}

export interface ShExMapPairingListResult {
  items: ShExMapPairing[];
  total: number;
}

export interface PairingFilters {
  q?: string;
  tag?: string;
  author?: string;
  sourceMapId?: string;
  targetMapId?: string;
  page?: number;
  limit?: number;
  sort?: 'created' | 'modified' | 'title' | 'stars';
  order?: 'asc' | 'desc';
}

export function useShExMapPairings(filters: PairingFilters = {}) {
  return useQuery<ShExMapPairingListResult>({
    queryKey: ['pairings', filters],
    queryFn: () => apiClient.get('/pairings', { params: filters }).then((r) => r.data),
  });
}

export function useShExMapPairing(id: string) {
  return useQuery<ShExMapPairing>({
    queryKey: ['pairing', id],
    queryFn: () => apiClient.get(`/pairings/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateShExMapPairing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      sourceMapId: string;
      targetMapId: string;
      sourceFocusIri?: string;
      targetFocusIri?: string;
      tags: string[];
      license?: string;
      version: string;
    }) => apiClient.post('/pairings', data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pairings'] }),
  });
}

// ─── ShExMap Pairing Versions ─────────────────────────────────────────────────

export interface ShExMapPairingVersion {
  id: string;
  pairingId: string;
  versionNumber: number;
  commitMessage?: string;
  sourceMapId: string;
  sourceVersionNumber?: number;
  targetMapId: string;
  targetVersionNumber?: number;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export function useShExMapPairingVersions(pairingId: string) {
  return useQuery<ShExMapPairingVersion[]>({
    queryKey: ['pairing-versions', pairingId],
    queryFn: () => apiClient.get(`/pairings/${pairingId}/versions`).then((r) => r.data),
    enabled: !!pairingId,
  });
}

export function useSaveShExMapPairingVersion(pairingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      commitMessage?: string;
      sourceMapVersionNumber?: number;
      targetMapVersionNumber?: number;
    }) => apiClient.post(`/pairings/${pairingId}/versions`, data).then((r) => r.data as ShExMapPairingVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pairing-versions', pairingId] });
      qc.invalidateQueries({ queryKey: ['pairing', pairingId] });
    },
  });
}

export function useUpdateShExMapPairing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title?: string;
      description?: string;
      tags?: string[];
      version?: string;
      license?: string;
      sourceMapId?: string;
      targetMapId?: string;
      sourceFocusIri?: string;
      targetFocusIri?: string;
    }) => apiClient.patch(`/pairings/${id}`, data).then((r) => r.data as ShExMapPairing),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pairing', id] });
      qc.invalidateQueries({ queryKey: ['pairings'] });
    },
  });
}

export function useDeleteShExMapPairing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/pairings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pairings'] }),
  });
}

// ─── ShExSchema ───────────────────────────────────────────────────────────────

export interface ShExSchema {
  id: string;
  url: string;
  title: string;
  description?: string;
  sourceUrl?: string;
  shexMapIds: string[];
}

export function useSchemas() {
  return useQuery<ShExSchema[]>({
    queryKey: ['schemas'],
    queryFn: () => apiClient.get('/schemas').then((r) => r.data),
  });
}
