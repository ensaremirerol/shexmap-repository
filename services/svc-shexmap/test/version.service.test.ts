import { SimpleClient } from 'sparql-http-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal() as object;
  return { ...mod, sparqlSelect: vi.fn(), sparqlUpdate: vi.fn() };
});

import { buildPrefixes, sparqlSelect, sparqlUpdate } from '@shexmap/shared';
import {
  getVersion,
  getVersionContent,
  listVersions,
  saveNewVersion,
} from '../src/services/version.service.js';

const mockClient = {} as SimpleClient;
const prefixes = buildPrefixes('https://w3id.org/shexmap/');

beforeEach(() => {
  vi.mocked(sparqlSelect).mockReset();
  vi.mocked(sparqlUpdate).mockReset();
});

describe('listVersions', () => {
  it('returns empty array when no versions', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    expect(await listVersions(mockClient, prefixes, 'map-1')).toEqual([]);
  });

  it('maps rows to ShExMapVersion', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      versionNumber: { value: '1', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      authorName: { value: 'Alice', type: 'literal' },
      createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
      commitMessage: { value: 'Initial', type: 'literal' },
    }]);

    const versions = await listVersions(mockClient, prefixes, 'map-1');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe('map-1-v1');
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[0]!.commitMessage).toBe('Initial');
  });

  it('defaults authorName to Unknown when missing', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      versionNumber: { value: '1', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
    }]);

    const versions = await listVersions(mockClient, prefixes, 'map-1');
    expect(versions[0]!.authorName).toBe('Unknown');
    expect(versions[0]!.commitMessage).toBeUndefined();
  });

  it('applies ?? defaults when required row fields are absent', async () => {
    // Empty row — all optional chaining returns undefined → fallbacks kick in
    vi.mocked(sparqlSelect).mockResolvedValue([{}]);

    const versions = await listVersions(mockClient, prefixes, 'map-1');
    expect(versions[0]!.versionNumber).toBe(0);
    expect(versions[0]!.authorId).toBe('');
    expect(versions[0]!.authorName).toBe('Unknown');
    expect(versions[0]!.createdAt).toBe('');
  });

  it('rejects invalid mapId', async () => {
    await expect(listVersions(mockClient, prefixes, 'bad/id')).rejects.toThrow('Invalid mapId');
  });
});

describe('getVersion', () => {
  it('returns null when not found', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    expect(await getVersion(mockClient, prefixes, 'map-1', 99)).toBeNull();
  });

  it('returns version when found', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      versionNumber: { value: '2', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      authorName: { value: 'Alice', type: 'literal' },
      createdAt: { value: '2024-06-01T00:00:00Z', type: 'literal' },
      commitMessage: { value: 'Fix typo', type: 'literal' },
    }]);

    const v = await getVersion(mockClient, prefixes, 'map-1', 2);
    expect(v).not.toBeNull();
    expect(v!.versionNumber).toBe(2);
    expect(v!.id).toBe('map-1-v2');
    expect(v!.commitMessage).toBe('Fix typo');
  });
});

describe('getVersionContent', () => {
  it('throws when content not found', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    await expect(getVersionContent(mockClient, prefixes, 'map-1', 1)).rejects.toThrow('Content not found');
  });

  it('throws when content value is empty string', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ content: { value: '', type: 'literal' } }]);
    await expect(getVersionContent(mockClient, prefixes, 'map-1', 1)).rejects.toThrow('Content not found');
  });

  it('returns content', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      content: { value: 'PREFIX ex: <http://example.org/>', type: 'literal' },
    }]);
    const content = await getVersionContent(mockClient, prefixes, 'map-1', 1);
    expect(content).toBe('PREFIX ex: <http://example.org/>');
  });
});

describe('saveNewVersion', () => {
  it('numbers versions sequentially', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: '3', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const v = await saveNewVersion(mockClient, prefixes, 'map-1', 'u1', 'content');
    expect(v.versionNumber).toBe(4);
    expect(v.id).toBe('map-1-v4');
  });

  it('starts at 1 when no existing versions', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: 'NaN', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const v = await saveNewVersion(mockClient, prefixes, 'map-1', 'u1', 'content', 'First');
    expect(v.versionNumber).toBe(1);
    expect(v.commitMessage).toBe('First');
  });

  it('starts at 1 when sparqlSelect returns no rows', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const v = await saveNewVersion(mockClient, prefixes, 'map-1', 'u1', 'content');
    expect(v.versionNumber).toBe(1);
  });

  it('includes mapVariable triples when content has Map annotations', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{ maxN: { value: '1', type: 'literal' } }]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const v = await saveNewVersion(mockClient, prefixes, 'map-1', 'u1', '%Map:{ ex:foo %} %Map:{ ex:bar %}', 'Add vars');
    expect(v.versionNumber).toBe(2);
    const insertVarsCall = vi.mocked(sparqlUpdate).mock.calls[3]![2];
    expect(insertVarsCall).toContain('ex:foo');
    expect(insertVarsCall).toContain('ex:bar');
  });

  it('rejects invalid mapId', async () => {
    await expect(saveNewVersion(mockClient, prefixes, 'bad/id', 'u1', '')).rejects.toThrow('Invalid mapId');
  });
});
