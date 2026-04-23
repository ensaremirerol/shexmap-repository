import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal() as object;
  return { ...mod, sparqlSelect: vi.fn(), sparqlUpdate: vi.fn() };
});

import { buildPrefixes, sparqlSelect, createSparqlClient } from '@shexmap/shared';
import { getCoverageOverview, getGapAnalysis } from '../src/services/coverage.service.js';

const mockClient = {} as ReturnType<typeof createSparqlClient>;
const prefixes = buildPrefixes('https://w3id.org/shexmap/');

beforeEach(() => {
  vi.mocked(sparqlSelect).mockReset();
});

describe('getCoverageOverview', () => {
  it('returns zeros when SPARQL returns no rows', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ schemas: { value: '0', type: 'literal' }, maps: { value: '0', type: 'literal' } }]);

    const result = await getCoverageOverview(mockClient, prefixes);

    expect(result.totalSchemas).toBe(0);
    expect(result.totalShexMaps).toBe(0);
    expect(result.totalShapes).toBe(0);
    expect(result.totalMappedShapes).toBe(0);
    expect(result.overallCoveragePercent).toBe(0);
    expect(result.bySchema).toEqual([]);
  });

  it('computes coveragePercent correctly', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([
        {
          schema:       { value: 'https://ex.org/schema1', type: 'uri' },
          totalShapes:  { value: '10', type: 'literal' },
          mappingCount: { value: '3', type: 'literal' },
        },
      ])
      .mockResolvedValueOnce([
        { schemas: { value: '1', type: 'literal' }, maps: { value: '3', type: 'literal' } },
      ]);

    const result = await getCoverageOverview(mockClient, prefixes);

    expect(result.bySchema).toHaveLength(1);
    expect(result.bySchema[0].coveragePercent).toBe(30);
    expect(result.bySchema[0].schemaUrl).toBe('https://ex.org/schema1');
    expect(result.bySchema[0].mappedShapes).toBe(3);
    expect(result.bySchema[0].totalShapes).toBe(10);
  });

  it('clamps mappedShapes to totalShapes', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([
        {
          schema:       { value: 'https://ex.org/schema1', type: 'uri' },
          totalShapes:  { value: '5', type: 'literal' },
          mappingCount: { value: '20', type: 'literal' },
        },
      ])
      .mockResolvedValueOnce([
        { schemas: { value: '1', type: 'literal' }, maps: { value: '20', type: 'literal' } },
      ]);

    const result = await getCoverageOverview(mockClient, prefixes);

    expect(result.bySchema[0].mappedShapes).toBe(5);
    expect(result.bySchema[0].coveragePercent).toBe(100);
  });

  it('uses schema IRI as title when schemaTitle is absent', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([
        {
          schema:       { value: 'https://ex.org/schema1', type: 'uri' },
          totalShapes:  { value: '2', type: 'literal' },
          mappingCount: { value: '1', type: 'literal' },
        },
      ])
      .mockResolvedValueOnce([
        { schemas: { value: '1', type: 'literal' }, maps: { value: '1', type: 'literal' } },
      ]);

    const result = await getCoverageOverview(mockClient, prefixes);

    expect(result.bySchema[0].schemaTitle).toBe('https://ex.org/schema1');
  });

  it('aggregates totals across multiple schemas', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([
        {
          schema:       { value: 'https://ex.org/schema1', type: 'uri' },
          schemaTitle:  { value: 'Schema A', type: 'literal' },
          totalShapes:  { value: '4', type: 'literal' },
          mappingCount: { value: '2', type: 'literal' },
        },
        {
          schema:       { value: 'https://ex.org/schema2', type: 'uri' },
          schemaTitle:  { value: 'Schema B', type: 'literal' },
          totalShapes:  { value: '6', type: 'literal' },
          mappingCount: { value: '3', type: 'literal' },
        },
      ])
      .mockResolvedValueOnce([
        { schemas: { value: '2', type: 'literal' }, maps: { value: '5', type: 'literal' } },
      ]);

    const result = await getCoverageOverview(mockClient, prefixes);

    expect(result.totalShapes).toBe(10);
    expect(result.totalMappedShapes).toBe(5);
    expect(result.overallCoveragePercent).toBe(50);
    expect(result.totalSchemas).toBe(2);
    expect(result.totalShexMaps).toBe(5);
  });

  it('returns 0 coveragePercent when totalShapes is 0', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([
        {
          schema:       { value: 'https://ex.org/schema1', type: 'uri' },
          totalShapes:  { value: '0', type: 'literal' },
          mappingCount: { value: '0', type: 'literal' },
        },
      ])
      .mockResolvedValueOnce([
        { schemas: { value: '1', type: 'literal' }, maps: { value: '0', type: 'literal' } },
      ]);

    const result = await getCoverageOverview(mockClient, prefixes);

    expect(result.bySchema[0].coveragePercent).toBe(0);
    expect(result.overallCoveragePercent).toBe(0);
  });

  it('includes computedAt timestamp', async () => {
    vi.mocked(sparqlSelect)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { schemas: { value: '0', type: 'literal' }, maps: { value: '0', type: 'literal' } },
      ]);

    const result = await getCoverageOverview(mockClient, prefixes);

    expect(result.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('getGapAnalysis', () => {
  it('returns empty array when SPARQL returns no rows', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    const result = await getGapAnalysis(mockClient, prefixes);
    expect(result).toEqual([]);
  });

  it('maps rows to ShapeGap objects', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema:     { value: 'https://ex.org/schema1', type: 'uri' },
        shape:      { value: 'https://ex.org/shape1', type: 'uri' },
        shapeLabel: { value: 'Patient', type: 'literal' },
      },
    ]);

    const result = await getGapAnalysis(mockClient, prefixes);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      schemaUrl:    'https://ex.org/schema1',
      shapeUrl:     'https://ex.org/shape1',
      shapeLabel:   'Patient',
      hasMappings:  false,
      mappingCount: 0,
    });
  });

  it('uses shape IRI as label when shapeLabel is absent', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: 'https://ex.org/schema1', type: 'uri' },
        shape:  { value: 'https://ex.org/shape1', type: 'uri' },
      },
    ]);

    const result = await getGapAnalysis(mockClient, prefixes);

    expect(result[0].shapeLabel).toBe('https://ex.org/shape1');
  });

  it('passes schemaUrl filter when provided', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);

    await getGapAnalysis(mockClient, prefixes, 'https://ex.org/schema1');

    const calledQuery = vi.mocked(sparqlSelect).mock.calls[0][2];
    expect(calledQuery).toContain('FILTER(?schema = <https://ex.org/schema1>)');
  });

  it('omits schemaUrl filter when not provided', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);

    await getGapAnalysis(mockClient, prefixes);

    const calledQuery = vi.mocked(sparqlSelect).mock.calls[0][2];
    expect(calledQuery).not.toContain('FILTER');
  });

  it('omits schemaUrl filter when empty string', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);

    await getGapAnalysis(mockClient, prefixes, '');

    const calledQuery = vi.mocked(sparqlSelect).mock.calls[0][2];
    expect(calledQuery).not.toContain('FILTER');
  });

  it('returns multiple gaps', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        schema: { value: 'https://ex.org/schema1', type: 'uri' },
        shape:  { value: 'https://ex.org/shape1', type: 'uri' },
      },
      {
        schema: { value: 'https://ex.org/schema1', type: 'uri' },
        shape:  { value: 'https://ex.org/shape2', type: 'uri' },
      },
    ]);

    const result = await getGapAnalysis(mockClient, prefixes);

    expect(result).toHaveLength(2);
    expect(result[0].shapeUrl).toBe('https://ex.org/shape1');
    expect(result[1].shapeUrl).toBe('https://ex.org/shape2');
  });
});
