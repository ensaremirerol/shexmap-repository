import { SimpleClient } from 'sparql-http-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal() as object;
  return { ...mod, sparqlSelect: vi.fn(), sparqlUpdate: vi.fn() };
});

import { buildPrefixes, sparqlSelect, sparqlUpdate } from '@shexmap/shared';
import {
  createShExMap,
  deleteShExMap,
  extractMapVariables,
  getShExMap,
  listShExMaps,
  updateShExMap,
} from '../src/services/shexmap.service.js';

const mockClient = {} as SimpleClient;
const prefixes = buildPrefixes('https://w3id.org/shexmap/');

beforeEach(() => {
  vi.mocked(sparqlSelect).mockReset();
  vi.mocked(sparqlUpdate).mockReset();
});

describe('extractMapVariables', () => {
  it('returns empty array when no content', () => {
    expect(extractMapVariables(undefined)).toEqual([]);
  });

  it('extracts unique variables', () => {
    const content = `PREFIX Map: <http://shex.io/extensions/Map/#>
<Shape> { :name xsd:string %Map:{ ex:name %}; :age xsd:integer %Map:{ ex:age %} }`;
    expect(extractMapVariables(content)).toEqual(['ex:name', 'ex:age']);
  });

  it('deduplicates repeated variables', () => {
    const content = `%Map:{ ex:foo %} %Map:{ ex:foo %}`;
    expect(extractMapVariables(content)).toEqual(['ex:foo']);
  });
});

describe('getShExMap', () => {
  it('returns null when SPARQL returns empty', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    expect(await getShExMap(mockClient, prefixes, 'nonexistent')).toBeNull();
  });

  it('maps SPARQL row to ShExMap', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      title: { value: 'My Map', type: 'literal' },
      fileFormat: { value: 'shexc', type: 'literal' },
      version: { value: '1.0.0', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      authorName: { value: 'Alice', type: 'literal' },
      createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
      modifiedAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
      stars: { value: '3', type: 'literal' },
      hasMapAnnotations: { value: 'true', type: 'literal' },
    }]);

    const result = await getShExMap(mockClient, prefixes, 'map-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('map-1');
    expect(result!.title).toBe('My Map');
    expect(result!.authorId).toBe('u1');
    expect(result!.stars).toBe(3);
    expect(result!.hasMapAnnotations).toBe(true);
  });
});

describe('listShExMaps', () => {
  it('returns items and total', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([{
        id: { value: 'https://w3id.org/shexmap/resource/map/abc', type: 'uri' },
        title: { value: 'Test', type: 'literal' },
        fileFormat: { value: 'shexc', type: 'literal' },
        version: { value: '1.0.0', type: 'literal' },
        authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
        createdAt: { value: '', type: 'literal' },
        modifiedAt: { value: '', type: 'literal' },
        stars: { value: '0', type: 'literal' },
      }])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    const result = await listShExMaps(mockClient, prefixes, {
      page: 1, limit: 10, sort: 'createdAt', order: 'desc',
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('abc');
  });

  it('defaults total to 0 when count query returns empty', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listShExMaps(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});

describe('createShExMap', () => {
  it('inserts triples and returns the created map', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([{
      title: { value: 'New Map', type: 'literal' },
      fileFormat: { value: 'shexc', type: 'literal' },
      version: { value: '1.0.0', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      authorName: { value: 'Bob', type: 'literal' },
      createdAt: { value: '', type: 'literal' },
      modifiedAt: { value: '', type: 'literal' },
      stars: { value: '0', type: 'literal' },
    }]);

    const result = await createShExMap(mockClient, prefixes, {
      title: 'New Map', tags: [], version: '1.0.0',
    }, 'u1');

    expect(vi.mocked(sparqlUpdate)).toHaveBeenCalledOnce();
    expect(result.title).toBe('New Map');
  });

  it('falls back to inline data when getShExMap returns null', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([]);

    const result = await createShExMap(mockClient, prefixes, {
      title: 'Fallback Map',
      description: 'desc',
      content: 'PREFIX ex: <http://example.org/>',
      sampleTurtleData: '<x> a <y> .',
      fileName: 'test.shex',
      fileFormat: 'shexc',
      sourceUrl: 'https://example.org/src',
      schemaUrl: 'https://example.org/schema',
      tags: ['t1'],
      version: '1.0.0',
    }, 'u1');

    expect(result.title).toBe('Fallback Map');
    expect(result.authorId).toBe('u1');
    expect(result.hasMapAnnotations).toBe(false);
  });

  it('sets hasMapAnnotations=true when content has map variables', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([]);

    const result = await createShExMap(mockClient, prefixes, {
      title: 'Map with vars',
      content: '%Map:{ ex:name %}',
      tags: [],
      version: '1.0.0',
    }, 'u1');

    expect(result.hasMapAnnotations).toBe(true);
    expect(result.mapVariables).toContain('ex:name');
  });

  it('includes optional fields in INSERT when provided', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue([]);

    await createShExMap(mockClient, prefixes, {
      title: 'T', tags: [], version: '1.0.0',
      description: 'my desc',
      sourceUrl: 'https://example.org/',
      schemaUrl: 'https://schema.example.org/',
    }, 'u1');

    const insertQuery = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    expect(insertQuery).toContain('my desc');
    expect(insertQuery).toContain('https://example.org/');
    expect(insertQuery).toContain('https://schema.example.org/');
  });
});

describe('updateShExMap', () => {
  const returnRow = [{
    title: { value: 'Updated', type: 'literal' },
    fileFormat: { value: 'shexc', type: 'literal' },
    version: { value: '2.0.0', type: 'literal' },
    authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
    createdAt: { value: '', type: 'literal' },
    modifiedAt: { value: '', type: 'literal' },
    stars: { value: '0', type: 'literal' },
  }];

  it('issues delete + insert and returns updated map', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    const result = await updateShExMap(mockClient, prefixes, 'map-1', { title: 'Updated', version: '2.0.0' });
    expect(vi.mocked(sparqlUpdate)).toHaveBeenCalledTimes(2);
    expect(result!.title).toBe('Updated');
  });

  it('includes description triple when non-empty', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { description: 'A desc' });
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertCall).toContain('description');
    expect(insertCall).toContain('A desc');
  });

  it('omits description triple when set to empty string', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { description: '' });
    const deleteCall = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(deleteCall).toContain('description');
    expect(insertCall).not.toContain('description');
  });

  it('includes tag triples when tags provided', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { tags: ['rdf', 'shex'] });
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertCall).toContain('rdf');
    expect(insertCall).toContain('shex');
  });

  it('clears tags when empty array provided', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { tags: [] });
    const deleteCall = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    expect(deleteCall).toContain('keyword');
  });

  it('includes sourceUrl triple when non-empty', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { sourceUrl: 'https://example.org/src' });
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertCall).toContain('https://example.org/src');
  });

  it('omits sourceUrl triple when set to empty string', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { sourceUrl: '' });
    const deleteCall = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(deleteCall).toContain('dc/terms/source');
    expect(insertCall).not.toContain('dc/terms/source');
  });

  it('includes schemaUrl triple when non-empty', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { schemaUrl: 'https://example.org/schema' });
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertCall).toContain('https://example.org/schema');
  });

  it('omits schemaUrl triple when set to empty string', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { schemaUrl: '' });
    const deleteCall = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(deleteCall).toContain('hasSchema');
    expect(insertCall).not.toContain('hasSchema');
  });

  it('includes sampleTurtleData triple when non-empty', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { sampleTurtleData: '<x> a <y> .' });
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(insertCall).toContain('<x> a <y> .');
  });

  it('omits sampleTurtleData triple when set to empty string', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    vi.mocked(sparqlSelect).mockResolvedValue(returnRow);

    await updateShExMap(mockClient, prefixes, 'map-1', { sampleTurtleData: '' });
    const deleteCall = vi.mocked(sparqlUpdate).mock.calls[0]![2];
    const insertCall = vi.mocked(sparqlUpdate).mock.calls[1]![2];
    expect(deleteCall).toContain('sampleTurtleData');
    expect(insertCall).not.toContain('sampleTurtleData');
  });
});

describe('deleteShExMap', () => {
  it('issues DELETE WHERE', async () => {
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);
    await deleteShExMap(mockClient, prefixes, 'map-1');
    expect(vi.mocked(sparqlUpdate)).toHaveBeenCalledOnce();
    const call = vi.mocked(sparqlUpdate).mock.calls[0]!;
    expect(call[2]).toContain('DELETE WHERE');
  });
});

describe('listShExMaps – filters and sort', () => {
  const baseRow = {
    id: { value: 'https://w3id.org/shexmap/resource/map/abc', type: 'uri' },
    title: { value: 'Test', type: 'literal' },
    fileFormat: { value: 'shexc', type: 'literal' },
    version: { value: '1.0.0', type: 'literal' },
    authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
    createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
    modifiedAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
    stars: { value: '0', type: 'literal' },
  };

  function setupMocks(row = baseRow) {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);
  }

  it('includes CONTAINS filter when q is provided', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { q: 'hello', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('CONTAINS');
    expect(query).toContain('hello');
  });

  it('includes keyword filter when tag is provided', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { tag: 'rdf', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('keyword');
    expect(query).toContain('rdf');
  });

  it('includes author filter when author is provided', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { author: 'u1', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('authorId');
    expect(query).toContain('u1');
  });

  it('includes schemaUrl filter when schemaUrl is provided', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { schemaUrl: 'https://schema.example.org/', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('schemaUrl');
  });

  it('includes hasMapAnnotations filter when provided', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { hasMapAnnotations: false, page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('hasMapAnnotations');
  });

  it('includes mapVariable filter when provided', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { mapVariable: 'ex:name', page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('mapVariable');
    expect(query).toContain('ex:name');
  });

  it('uses stars sort variable when sort is stars', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { page: 1, limit: 10, sort: 'stars', order: 'asc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('ASC(?stars)');
  });

  it('uses ASC order when order is asc', async () => {
    setupMocks();
    await listShExMaps(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'asc' });
    const query = vi.mocked(sparqlSelect).mock.calls[0]![2];
    expect(query).toContain('ASC(?createdAt)');
  });

  it('maps optional row fields (authorName, description, hasMapAnnotations=true)', async () => {
    setupMocks({
      ...baseRow,
      authorName: { value: 'Alice', type: 'literal' },
      description: { value: 'A nice map', type: 'literal' },
      hasMapAnnotations: { value: 'true', type: 'literal' },
      fileName: { value: 'map.shex', type: 'literal' },
      sourceUrl: { value: 'https://example.org/src', type: 'literal' },
      schemaUrl: { value: 'https://example.org/schema', type: 'literal' },
    });
    const result = await listShExMaps(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    expect(result.items[0]!.authorName).toBe('Alice');
    expect(result.items[0]!.hasMapAnnotations).toBe(true);
    expect(result.items[0]!.fileName).toBe('map.shex');
    expect(result.items[0]!.sourceUrl).toBe('https://example.org/src');
    expect(result.items[0]!.schemaUrl).toBe('https://example.org/schema');
  });

  it('collects mapVariables from multiple rows and deduplicates', async () => {
    const rowWithMv = (mv: string) => ({ ...baseRow, mapVariable: { value: mv, type: 'literal' } });
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([rowWithMv('ex:foo'), rowWithMv('ex:bar'), rowWithMv('ex:foo')])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    const result = await listShExMaps(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    expect(result.items[0]!.mapVariables).toEqual(['ex:foo', 'ex:bar']);
  });

  it('applies ?? defaults when optional fields are absent in row', async () => {
    // Minimal row: only the bare ID, no title/fileFormat/version/authorId/stars etc.
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([{ id: { value: 'https://w3id.org/shexmap/resource/map/xyz', type: 'uri' } }])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    const result = await listShExMaps(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const item = result.items[0]!;
    expect(item.title).toBe('');
    expect(item.fileFormat).toBe('shexc');
    expect(item.version).toBe('1.0.0');
    expect(item.authorName).toBe('Unknown');
    expect(item.stars).toBe(0);
    expect(item.hasMapAnnotations).toBe(false);
    expect(item.createdAt).toBe('');
    expect(item.modifiedAt).toBe('');
  });

  it('applies ?? id fallback when id field is absent in row', async () => {
    // Row with no id field — triggers r['id']?.value ?? '' and title ?? ''
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ total: { value: '1', type: 'literal' } }]);

    const result = await listShExMaps(mockClient, prefixes, { page: 1, limit: 10, sort: 'createdAt', order: 'desc' });
    const item = result.items[0]!;
    expect(item.id).toBe('');
    expect(item.title).toBe('');
  });
});

describe('getShExMap – optional fields', () => {
  it('populates all optional fields when present in row', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([{
      title: { value: 'My Map', type: 'literal' },
      fileFormat: { value: 'shexc', type: 'literal' },
      version: { value: '1.0.0', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      authorName: { value: 'Alice', type: 'literal' },
      createdAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
      modifiedAt: { value: '2024-01-01T00:00:00Z', type: 'literal' },
      stars: { value: '5', type: 'literal' },
      hasMapAnnotations: { value: 'true', type: 'literal' },
      description: { value: 'A nice map', type: 'literal' },
      content: { value: 'PREFIX ex: <http://example.org/>', type: 'literal' },
      sampleTurtleData: { value: '<x> a <y> .', type: 'literal' },
      fileName: { value: 'map.shex', type: 'literal' },
      sourceUrl: { value: 'https://example.org/src', type: 'literal' },
      schemaUrl: { value: 'https://example.org/schema', type: 'literal' },
      tag: { value: 'rdf', type: 'literal' },
      mapVariable: { value: 'ex:name', type: 'literal' },
    }]);

    const result = await getShExMap(mockClient, prefixes, 'map-1');
    expect(result!.description).toBe('A nice map');
    expect(result!.content).toBe('PREFIX ex: <http://example.org/>');
    expect(result!.sampleTurtleData).toBe('<x> a <y> .');
    expect(result!.fileName).toBe('map.shex');
    expect(result!.sourceUrl).toBe('https://example.org/src');
    expect(result!.schemaUrl).toBe('https://example.org/schema');
    expect(result!.tags).toContain('rdf');
    expect(result!.mapVariables).toContain('ex:name');
  });

  it('applies ?? defaults when optional fields are absent', async () => {
    // Minimal row with only required fields absent/undefined
    vi.mocked(sparqlSelect).mockResolvedValue([{}]);

    const result = await getShExMap(mockClient, prefixes, 'map-1');
    expect(result!.title).toBe('');
    expect(result!.fileFormat).toBe('shexc');
    expect(result!.version).toBe('1.0.0');
    expect(result!.authorName).toBe('Unknown');
    expect(result!.stars).toBe(0);
    expect(result!.hasMapAnnotations).toBe(false);
    expect(result!.tags).toEqual([]);
    expect(result!.mapVariables).toEqual([]);
  });

  it('collects unique tags and mapVariables from multiple rows', async () => {
    const base = {
      title: { value: 'T', type: 'literal' },
      fileFormat: { value: 'shexc', type: 'literal' },
      version: { value: '1.0.0', type: 'literal' },
      authorId: { value: 'https://w3id.org/shexmap/resource/user/u1', type: 'uri' },
      createdAt: { value: '', type: 'literal' },
      modifiedAt: { value: '', type: 'literal' },
      stars: { value: '0', type: 'literal' },
    };
    vi.mocked(sparqlSelect).mockResolvedValue([
      { ...base, tag: { value: 'rdf', type: 'literal' }, mapVariable: { value: 'ex:foo', type: 'literal' } },
      { ...base, tag: { value: 'shex', type: 'literal' }, mapVariable: { value: 'ex:bar', type: 'literal' } },
      { ...base, tag: { value: 'rdf', type: 'literal' }, mapVariable: { value: 'ex:foo', type: 'literal' } },
    ]);

    const result = await getShExMap(mockClient, prefixes, 'map-1');
    expect(result!.tags).toEqual(['rdf', 'shex']);
    expect(result!.mapVariables).toEqual(['ex:foo', 'ex:bar']);
  });
});
