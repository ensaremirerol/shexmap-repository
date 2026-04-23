import { SimpleClient } from 'sparql-http-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal() as object;
  return { ...mod, sparqlSelect: vi.fn(), sparqlUpdate: vi.fn() };
});

import { buildPrefixes, sparqlSelect, sparqlUpdate } from '@shexmap/shared';
import {
  listShExMapPairings,
  getShExMapPairing,
  createShExMapPairing,
  updateShExMapPairing,
  deleteShExMapPairing,
} from '../src/services/pairing.service.js';

const mockClient = {} as SimpleClient;
const prefixes = buildPrefixes('https://w3id.org/shexmap/');

beforeEach(() => {
  vi.mocked(sparqlSelect).mockReset();
  vi.mocked(sparqlUpdate).mockReset();
});

const basePairingRow = {
  title: { value: 'Test Pairing', type: 'literal' },
  version: { value: '1.0.0', type: 'literal' },
  authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
  authorName: { value: 'Alice', type: 'literal' },
  createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
  modifiedAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
  stars: { value: '0', type: 'literal' },
  srcId: { value: 'https://w3id.org/shexmap/resource/map/src1', type: 'uri' },
  tgtId: { value: 'https://w3id.org/shexmap/resource/map/tgt1', type: 'uri' },
};

describe('getShExMapPairing', () => {
  it('returns null when SPARQL returns empty', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    expect(await getShExMapPairing(mockClient, prefixes, 'nonexistent')).toBeNull();
  });

  it('maps SPARQL row to ShExMapPairing', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([basePairingRow]);

    const result = await getShExMapPairing(mockClient, prefixes, 'pair-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('pair-1');
    expect(result!.title).toBe('Test Pairing');
    expect(result!.authorId).toBe('u1');
    expect(result!.sourceMap.id).toBe('src1');
    expect(result!.targetMap.id).toBe('tgt1');
  });

  it('populates optional fields when present', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      ...basePairingRow,
      description: { value: 'A pairing', type: 'literal' },
      license: { value: 'https://creativecommons.org/licenses/by/4.0/', type: 'uri' },
      sourceFocusIri: { value: 'https://example.org/subject1', type: 'uri' },
      targetFocusIri: { value: 'https://example.org/subject2', type: 'uri' },
      tag: { value: 'rdf', type: 'literal' },
    }]);

    const result = await getShExMapPairing(mockClient, prefixes, 'pair-1');
    expect(result!.description).toBe('A pairing');
    expect(result!.sourceFocusIri).toBe('https://example.org/subject1');
    expect(result!.targetFocusIri).toBe('https://example.org/subject2');
    expect(result!.tags).toContain('rdf');
  });

  it('collects unique tags from multiple rows', async () => {
    const base = basePairingRow;
    vi.mocked(sparqlSelect).mockResolvedValue([
      { ...base, tag: { value: 'rdf', type: 'literal' } },
      { ...base, tag: { value: 'shex', type: 'literal' } },
      { ...base, tag: { value: 'rdf', type: 'literal' } },
    ]);

    const result = await getShExMapPairing(mockClient, prefixes, 'pair-1');
    expect(result!.tags).toEqual(['rdf', 'shex']);
  });

  it('applies ?? defaults when optional fields are absent', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{}]);

    const result = await getShExMapPairing(mockClient, prefixes, 'pair-1');
    expect(result!.title).toBe('');
    expect(result!.version).toBe('1.0.0');
    expect(result!.authorName).toBe('Unknown');
    expect(result!.stars).toBe(0);
    expect(result!.tags).toEqual([]);
  });
});

describe('listShExMapPairings', () => {
  const listRow = {
    id: { value: 'https://w3id.org/shexmap/resource/pairing/pair-1', type: 'uri' },
    ...basePairingRow,
  };

  it('returns items and total', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    const result = await listShExMapPairings(mockClient, prefixes, {
      page: 1, limit: 10, sort: 'createdAt', order: 'desc',
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('pair-1');
  });

  it('defaults total to 0 when count query returns empty', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listShExMapPairings(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('includes CONTAINS filter when q is provided', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { q: 'hello', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('CONTAINS');
    expect(query).toContain('hello');
  });

  it('includes keyword filter when tag is provided', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { tag: 'rdf', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('keyword');
    expect(query).toContain('rdf');
  });

  it('includes author filter when author is provided', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { author: 'u1', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('authorId');
    expect(query).toContain('u1');
  });

  it('includes sourceMapId filter when sourceMapId is provided', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { sourceMapId: 'src1', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('srcId');
    expect(query).toContain('src1');
  });

  it('includes targetMapId filter when targetMapId is provided', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { targetMapId: 'tgt1', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('tgtId');
    expect(query).toContain('tgt1');
  });

  it('uses DESC order when order is desc', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('DESC(?createdAt)');
  });

  it('uses ASC order when order is asc', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'asc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('ASC(?createdAt)');
  });

  it('uses stars sort variable when sort is stars', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    await listShExMapPairings(mockClient, prefixes, { page: 1, limit: 10, sort: 'stars', order: 'asc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('ASC(?stars)');
  });

  it('deduplicates items by id', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([listRow, listRow])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    const result = await listShExMapPairings(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    expect(result.items).toHaveLength(1);
  });
});

describe('createShExMapPairing', () => {
  it('issues INSERT DATA and returns created pairing', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([basePairingRow]);

    const result = await createShExMapPairing(mockClient, prefixes, {
      title: 'New Pairing',
      sourceMapId: 'src1',
      targetMapId: 'tgt1',
      tags: [],
      version: '1.0.0',
    }, 'u1');

    expect(vi.mocked(sparqlUpdate)).toHaveBeenCalledOnce();
    const insertQuery = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    expect(insertQuery).toContain('INSERT DATA');
    expect(insertQuery).toContain('ShExMapPairing');
    expect(result.title).toBe('Test Pairing');
  });

  it('includes optional fields when provided', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([basePairingRow]);

    await createShExMapPairing(mockClient, prefixes, {
      title: 'Pairing',
      description: 'A description',
      sourceMapId: 'src1',
      targetMapId: 'tgt1',
      sourceFocusIri: 'https://example.org/focus1',
      targetFocusIri: 'https://example.org/focus2',
      tags: ['rdf'],
      license: 'https://creativecommons.org/licenses/by/4.0/',
      version: '1.0.0',
    }, 'u1');

    const insertQuery = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    expect(insertQuery).toContain('A description');
    expect(insertQuery).toContain('https://example.org/focus1');
    expect(insertQuery).toContain('https://example.org/focus2');
    expect(insertQuery).toContain('rdf');
    expect(insertQuery).toContain('creativecommons.org');
  });
});

describe('updateShExMapPairing', () => {
  it('issues DELETE + INSERT and returns updated pairing', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([basePairingRow]);

    const result = await updateShExMapPairing(mockClient, prefixes, 'pair-1', { title: 'Updated' });
    expect(vi.mocked(sparqlUpdate)).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
  });

  it('includes title in INSERT when provided', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([basePairingRow]);

    await updateShExMapPairing(mockClient, prefixes, 'pair-1', { title: 'My New Title' });
    const insertQuery = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertQuery).toContain('My New Title');
  });

  it('includes tag triples when tags provided', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([basePairingRow]);

    await updateShExMapPairing(mockClient, prefixes, 'pair-1', { tags: ['rdf', 'shex'] });
    const insertQuery = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertQuery).toContain('rdf');
    expect(insertQuery).toContain('shex');
  });

  it('always updates modified timestamp', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([basePairingRow]);

    await updateShExMapPairing(mockClient, prefixes, 'pair-1', {});
    const insertQuery = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertQuery).toContain('modified');
  });
});

describe('deleteShExMapPairing', () => {
  it('issues DELETE WHERE', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    await deleteShExMapPairing(mockClient, prefixes, 'pair-1');
    expect(vi.mocked(sparqlUpdate)).toHaveBeenCalledOnce();
    const query = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    expect(query).toContain('DELETE WHERE');
    expect(query).toContain('pair-1');
  });
});
