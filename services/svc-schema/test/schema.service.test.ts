import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal() as object;
  return { ...mod, sparqlSelect: vi.fn() };
});

import { buildPrefixes, sparqlSelect, createSparqlClient } from '@shexmap/shared';
import { listSchemas } from '../src/services/schema.service.js';

const mockClient = {} as ReturnType<typeof createSparqlClient>;
const prefixes = buildPrefixes('https://w3id.org/shexmap/');

beforeEach(() => {
  vi.mocked(sparqlSelect).mockReset();
});

describe('listSchemas', () => {
  it('returns empty array when SPARQL returns no rows', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result).toEqual([]);
  });

  it('maps a single row to a Schema with no map IDs', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema:      { value: 'https://w3id.org/shexmap/resource/schema/s1', type: 'uri' },
        title:       { value: 'FHIR R4', type: 'literal' },
        description: { value: 'FHIR Release 4', type: 'literal' },
        source:      { value: 'https://hl7.org/fhir', type: 'uri' },
      },
    ]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id:          's1',
      url:         'https://w3id.org/shexmap/resource/schema/s1',
      title:       'FHIR R4',
      description: 'FHIR Release 4',
      sourceUrl:   'https://hl7.org/fhir',
      shexMapIds:  [],
    });
  });

  it('collects shexMapIds from multiple rows for the same schema', async () => {
    const schemaUri = 'https://w3id.org/shexmap/resource/schema/s1';
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: schemaUri, type: 'uri' },
        title:  { value: 'FHIR R4', type: 'literal' },
        mapId:  { value: 'https://w3id.org/shexmap/resource/map/abc', type: 'uri' },
      },
      {
        schema: { value: schemaUri, type: 'uri' },
        title:  { value: 'FHIR R4', type: 'literal' },
        mapId:  { value: 'https://w3id.org/shexmap/resource/map/def', type: 'uri' },
      },
    ]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result).toHaveLength(1);
    expect(result[0].shexMapIds).toContain('abc');
    expect(result[0].shexMapIds).toContain('def');
    expect(result[0].shexMapIds).toHaveLength(2);
  });

  it('deduplicates shexMapIds', async () => {
    const schemaUri = 'https://w3id.org/shexmap/resource/schema/s1';
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: schemaUri, type: 'uri' },
        mapId:  { value: 'https://w3id.org/shexmap/resource/map/abc', type: 'uri' },
      },
      {
        schema: { value: schemaUri, type: 'uri' },
        mapId:  { value: 'https://w3id.org/shexmap/resource/map/abc', type: 'uri' },
      },
    ]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result[0].shexMapIds).toHaveLength(1);
  });

  it('handles multiple distinct schemas', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: 'https://w3id.org/shexmap/resource/schema/s1', type: 'uri' },
        title:  { value: 'Schema A', type: 'literal' },
      },
      {
        schema: { value: 'https://w3id.org/shexmap/resource/schema/s2', type: 'uri' },
        title:  { value: 'Schema B', type: 'literal' },
      },
    ]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result).toHaveLength(2);
    const ids = result.map(s => s.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
  });

  it('uses last path segment as id for non-standard IRIs', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: 'https://example.org/schemas/MySchema', type: 'uri' },
        title:  { value: 'My Schema', type: 'literal' },
      },
    ]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result[0].id).toBe('MySchema');
  });

  it('uses schema IRI as title when title is absent', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: 'https://w3id.org/shexmap/resource/schema/s99', type: 'uri' },
      },
    ]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result[0].title).toBe('s99');
  });

  it('omits optional fields when absent', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: 'https://w3id.org/shexmap/resource/schema/s1', type: 'uri' },
        title:  { value: 'Schema', type: 'literal' },
      },
    ]);
    const result = await listSchemas(mockClient, prefixes);
    expect(result[0].description).toBeUndefined();
    expect(result[0].sourceUrl).toBeUndefined();
  });
});
