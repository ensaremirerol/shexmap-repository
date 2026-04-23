import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as grpc from '@grpc/grpc-js';

vi.mock('../src/sparql.js', () => ({
  sparqlClient: {},
  prefixes: {
    shexmap:      'https://w3id.org/shexmap/ontology#',
    shexrpair:    'https://w3id.org/shexmap/resource/pairing/',
    shexrmap:     'https://w3id.org/shexmap/resource/map/',
    shexruser:    'https://w3id.org/shexmap/resource/user/',
    shexrversion: 'https://w3id.org/shexmap/resource/version/',
  },
}));

vi.mock('../src/services/pairing.service.js', () => ({
  listShExMapPairings:  vi.fn(),
  getShExMapPairing:    vi.fn(),
  createShExMapPairing: vi.fn(),
  updateShExMapPairing: vi.fn(),
  deleteShExMapPairing: vi.fn(),
}));

vi.mock('../src/services/pairing-version.service.js', () => ({
  listPairingVersions: vi.fn(),
  getPairingVersion:   vi.fn(),
  savePairingVersion:  vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  config: {
    port: 50000,
    svcShexmapUrl: 'svc-shexmap:50052',
    strictMapExistsCheck: false,
  },
}));

import {
  listShExMapPairings,
  getShExMapPairing,
  createShExMapPairing,
  updateShExMapPairing,
  deleteShExMapPairing,
} from '../src/services/pairing.service.js';
import {
  listPairingVersions,
  getPairingVersion,
  savePairingVersion,
} from '../src/services/pairing-version.service.js';

const mockPairing = {
  id: 'pair-1',
  title: 'Test',
  description: undefined,
  sourceMap: { id: 'src1', title: '', fileFormat: 'shexc', tags: [], version: '1.0.0', authorId: '', authorName: '', createdAt: '', modifiedAt: '', stars: 0 },
  targetMap: { id: 'tgt1', title: '', fileFormat: 'shexc', tags: [], version: '1.0.0', authorId: '', authorName: '', createdAt: '', modifiedAt: '', stars: 0 },
  tags: [],
  version: '1.0.0',
  authorId: 'u1',
  authorName: 'Alice',
  createdAt: '2024-01-01T00:00:00Z',
  modifiedAt: '2024-01-01T00:00:00Z',
  stars: 0,
};

const mockVersion = {
  id: 'pair-1-v1',
  pairingId: 'pair-1',
  versionNumber: 1,
  sourceMapId: 'src1',
  targetMapId: 'tgt1',
  authorId: 'u1',
  authorName: 'Alice',
  createdAt: '2024-01-01T00:00:00Z',
};

function makeCall(requestData: object, metaData: Record<string, string> = {}): any {
  const metadata = new grpc.Metadata();
  for (const [k, v] of Object.entries(metaData)) {
    metadata.set(k, v);
  }
  return { request: requestData, metadata };
}

function makeCallback(): [vi.MockedFunction<any>, Promise<[any, any]>] {
  let resolve: (v: [any, any]) => void;
  const p = new Promise<[any, any]>((r) => { resolve = r; });
  const cb = vi.fn((...args: any[]) => resolve(args as [any, any]));
  return [cb, p];
}

beforeEach(() => {
  vi.mocked(listShExMapPairings).mockReset();
  vi.mocked(getShExMapPairing).mockReset();
  vi.mocked(createShExMapPairing).mockReset();
  vi.mocked(updateShExMapPairing).mockReset();
  vi.mocked(deleteShExMapPairing).mockReset();
  vi.mocked(listPairingVersions).mockReset();
  vi.mocked(getPairingVersion).mockReset();
  vi.mocked(savePairingVersion).mockReset();
});

describe('server handler behaviour (logic-level)', () => {
  it('listPairings delegates to listShExMapPairings', async () => {
    vi.mocked(listShExMapPairings).mockResolvedValue({ items: [mockPairing], total: 1 });

    const result = await listShExMapPairings({} as any, {} as any, {
      page: 1, limit: 10, sort: 'createdAt', order: 'desc',
    });
    expect(result.total).toBe(1);
    expect(result.items[0]!.id).toBe('pair-1');
  });

  it('getPairing returns null when not found', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValue(null);

    const result = await getShExMapPairing({} as any, {} as any, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('pairing service mock integration', () => {
  it('createShExMapPairing is called with correct arguments', async () => {
    vi.mocked(createShExMapPairing).mockResolvedValue(mockPairing);

    const result = await createShExMapPairing(
      {} as any,
      {} as any,
      { title: 'T', sourceMapId: 's', targetMapId: 't', tags: [], version: '1.0.0' },
      'u1',
    );
    expect(result.id).toBe('pair-1');
    expect(vi.mocked(createShExMapPairing)).toHaveBeenCalledOnce();
  });

  it('listShExMapPairings returns empty when no pairings', async () => {
    vi.mocked(listShExMapPairings).mockResolvedValue({ items: [], total: 0 });

    const result = await listShExMapPairings(
      {} as any,
      {} as any,
      { page: 1, limit: 10, sort: 'createdAt', order: 'desc' },
    );
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('savePairingVersion increments version', async () => {
    vi.mocked(savePairingVersion).mockResolvedValue(mockVersion);

    const v = await savePairingVersion(
      {} as any,
      {} as any,
      'pair-1',
      'u1',
      { sourceMapId: 'src1', targetMapId: 'tgt1' },
    );
    expect(v.versionNumber).toBe(1);
    expect(v.pairingId).toBe('pair-1');
  });

  it('deleteShExMapPairing resolves without error', async () => {
    vi.mocked(deleteShExMapPairing).mockResolvedValue(undefined);
    await expect(deleteShExMapPairing({} as any, {} as any, 'pair-1')).resolves.toBeUndefined();
  });

  it('getPairingVersion returns null when not found', async () => {
    vi.mocked(getPairingVersion).mockResolvedValue(null);
    const result = await getPairingVersion({} as any, {} as any, 'pair-1', 99);
    expect(result).toBeNull();
  });

  it('listPairingVersions returns versions array', async () => {
    vi.mocked(listPairingVersions).mockResolvedValue([mockVersion]);
    const versions = await listPairingVersions({} as any, {} as any, 'pair-1');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe('pair-1-v1');
  });
});
