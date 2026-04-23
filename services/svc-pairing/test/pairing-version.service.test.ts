import { SimpleClient } from 'sparql-http-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal() as object;
  return { ...mod, sparqlSelect: vi.fn(), sparqlUpdate: vi.fn() };
});

import { buildPrefixes, sparqlSelect, sparqlUpdate } from '@shexmap/shared';
import {
  listPairingVersions,
  getPairingVersion,
  savePairingVersion,
} from '../src/services/pairing-version.service.js';

const mockClient = {} as SimpleClient;
const prefixes = buildPrefixes('https://w3id.org/shexmap/');

beforeEach(() => {
  vi.mocked(sparqlSelect).mockReset();
  vi.mocked(sparqlUpdate).mockReset();
});

describe('listPairingVersions', () => {
  it('returns empty array when no versions', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    expect(await listPairingVersions(mockClient, prefixes, 'pair-1')).toEqual([]);
  });

  it('maps rows to ShExMapPairingVersion', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      versionNumber: { value: '1', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      authorName: { value: 'Alice', type: 'literal' },
      createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
      commitMessage: { value: 'Initial', type: 'literal' },
      sourceMapId: { value: 'https://w3id.org/shexmap/resource/map/src1', type: 'uri' },
      targetMapId: { value: 'https://w3id.org/shexmap/resource/map/tgt1', type: 'uri' },
    }]);

    const versions = await listPairingVersions(mockClient, prefixes, 'pair-1');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe('pair-1-v1');
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[0]!.commitMessage).toBe('Initial');
    expect(versions[0]!.sourceMapId).toBe('src1');
    expect(versions[0]!.targetMapId).toBe('tgt1');
  });

  it('defaults authorName to Unknown when missing', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      versionNumber: { value: '1', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
    }]);

    const versions = await listPairingVersions(mockClient, prefixes, 'pair-1');
    expect(versions[0]!.authorName).toBe('Unknown');
    expect(versions[0]!.commitMessage).toBeUndefined();
  });

  it('applies ?? defaults when required row fields are absent', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{}]);

    const versions = await listPairingVersions(mockClient, prefixes, 'pair-1');
    expect(versions[0]!.versionNumber).toBe(0);
    expect(versions[0]!.authorId).toBe('');
    expect(versions[0]!.authorName).toBe('Unknown');
    expect(versions[0]!.createdAt).toBe('');
  });

  it('rejects invalid pairingId', async () => {
    await expect(listPairingVersions(mockClient, prefixes, 'bad/id')).rejects.toThrow('Invalid pairingId');
  });

  it('populates sourceVersionNumber and targetVersionNumber when present', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      versionNumber: { value: '2', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
      sourceVersionNumber: { value: '3', type: 'literal' },
      targetVersionNumber: { value: '5', type: 'literal' },
    }]);

    const versions = await listPairingVersions(mockClient, prefixes, 'pair-1');
    expect(versions[0]!.sourceVersionNumber).toBe(3);
    expect(versions[0]!.targetVersionNumber).toBe(5);
  });
});

describe('getPairingVersion', () => {
  it('returns null when not found', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    expect(await getPairingVersion(mockClient, prefixes, 'pair-1', 99)).toBeNull();
  });

  it('returns version when found', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      versionNumber: { value: '2', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      authorName: { value: 'Alice', type: 'literal' },
      createdAt: { value: '2024-06-01T00:00:00Z', type: 'literal' },
      commitMessage: { value: 'Fix mapping', type: 'literal' },
    }]);

    const v = await getPairingVersion(mockClient, prefixes, 'pair-1', 2);
    expect(v).not.toBeNull();
    expect(v!.versionNumber).toBe(2);
    expect(v!.id).toBe('pair-1-v2');
    expect(v!.commitMessage).toBe('Fix mapping');
  });

  it('rejects invalid pairingId', async () => {
    await expect(getPairingVersion(mockClient, prefixes, 'bad/id', 1)).rejects.toThrow('Invalid pairingId');
  });
});

describe('savePairingVersion', () => {
  it('numbers versions sequentially', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: '3', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const v = await savePairingVersion(mockClient, prefixes, 'pair-1', 'u1', {
      sourceMapId: 'src1',
      targetMapId: 'tgt1',
    });
    expect(v.versionNumber).toBe(4);
    expect(v.id).toBe('pair-1-v4');
  });

  it('starts at 1 when no existing versions', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: 'NaN', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const v = await savePairingVersion(mockClient, prefixes, 'pair-1', 'u1', {
      commitMessage: 'First',
      sourceMapId: 'src1',
      targetMapId: 'tgt1',
    });
    expect(v.versionNumber).toBe(1);
    expect(v.commitMessage).toBe('First');
  });

  it('starts at 1 when sparqlSelect returns no rows', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const v = await savePairingVersion(mockClient, prefixes, 'pair-1', 'u1', {
      sourceMapId: 'src1',
      targetMapId: 'tgt1',
    });
    expect(v.versionNumber).toBe(1);
  });

  it('includes source/target version IRIs when version numbers provided', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: '1', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    await savePairingVersion(mockClient, prefixes, 'pair-1', 'u1', {
      sourceMapId: 'src1',
      sourceVersionNumber: 3,
      targetMapId: 'tgt1',
      targetVersionNumber: 5,
    });

    const insertCall = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    expect(insertCall).toContain('src1-v3');
    expect(insertCall).toContain('tgt1-v5');
  });

  it('omits version IRIs when version numbers not provided', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: '1', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    await savePairingVersion(mockClient, prefixes, 'pair-1', 'u1', {
      sourceMapId: 'src1',
      targetMapId: 'tgt1',
    });

    const insertCall = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    expect(insertCall).not.toContain('sourceMapVersion');
    expect(insertCall).not.toContain('targetMapVersion');
  });

  it('updates currentPairingVersion on parent pairing', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: '0', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    await savePairingVersion(mockClient, prefixes, 'pair-1', 'u1', {
      sourceMapId: 'src1',
      targetMapId: 'tgt1',
    });

    expect(vi.mocked(sparqlUpdate)).toHaveBeenCalledTimes(2);
    const updateParentCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(updateParentCall).toContain('currentPairingVersion');
  });

  it('rejects invalid pairingId', async () => {
    await expect(
      savePairingVersion(mockClient, prefixes, 'bad/id', 'u1', { sourceMapId: 's', targetMapId: 't' })
    ).rejects.toThrow('Invalid pairingId');
  });
});
