import { sparqlSelect, createSparqlClient } from '@shexmap/shared';
import type { Prefixes, CoverageOverview, CoverageReport, ShapeGap } from '@shexmap/shared';

type SparqlClient = ReturnType<typeof createSparqlClient>;

export async function getCoverageOverview(
  client: SparqlClient,
  prefixes: Prefixes,
): Promise<CoverageOverview> {
  const SM = prefixes.shexmap;

  const sparql = `
    SELECT ?schema ?schemaTitle (COUNT(DISTINCT ?shape) AS ?totalShapes)
           (COUNT(DISTINCT ?map) AS ?mappingCount)
    WHERE {
      ?schema a <${SM}ShExSchema> .
      OPTIONAL { ?schema <${prefixes.dct}title> ?schemaTitle }
      OPTIONAL { ?shape <${SM}belongsToSchema> ?schema }
      OPTIONAL {
        ?map a <${SM}ShExMap> ;
             <${SM}sourceSchema> ?schema .
      }
    }
    GROUP BY ?schema ?schemaTitle
    ORDER BY DESC(?mappingCount)
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);

  let totalShapes = 0;
  let totalMappedShapes = 0;

  const bySchema: CoverageReport[] = rows.map((r) => {
    const total = parseInt(r['totalShapes']?.value ?? '0', 10);
    const mapped = Math.min(parseInt(r['mappingCount']?.value ?? '0', 10), total);
    totalShapes += total;
    totalMappedShapes += mapped;

    return {
      schemaUrl:       r['schema']?.value ?? '',
      schemaTitle:     r['schemaTitle']?.value ?? r['schema']?.value ?? '',
      totalShapes:     total,
      mappedShapes:    mapped,
      coveragePercent: total > 0 ? Math.round((mapped / total) * 100) : 0,
      computedAt:      new Date().toISOString(),
    };
  });

  const totalsQuery = `
    SELECT (COUNT(DISTINCT ?schema) AS ?schemas) (COUNT(DISTINCT ?map) AS ?maps)
    WHERE {
      ?schema a <${SM}ShExSchema> .
      OPTIONAL { ?map a <${SM}ShExMap> }
    }
  `;
  const totalsRows = await sparqlSelect(client, prefixes, totalsQuery);
  const totalSchemas = parseInt(totalsRows[0]?.['schemas']?.value ?? '0', 10);
  const totalShexMaps = parseInt(totalsRows[0]?.['maps']?.value ?? '0', 10);

  return {
    totalSchemas,
    totalShexMaps,
    totalShapes,
    totalMappedShapes,
    overallCoveragePercent: totalShapes > 0
      ? Math.round((totalMappedShapes / totalShapes) * 100)
      : 0,
    bySchema,
    computedAt: new Date().toISOString(),
  };
}

export async function getGapAnalysis(
  client: SparqlClient,
  prefixes: Prefixes,
  schemaUrl?: string,
): Promise<ShapeGap[]> {
  const SM = prefixes.shexmap;
  const schemaFilter = schemaUrl ? `FILTER(?schema = <${schemaUrl}>)` : '';

  const sparql = `
    SELECT ?schema ?shape ?shapeLabel (COUNT(DISTINCT ?map) AS ?mappingCount)
    WHERE {
      ?shape <${SM}belongsToSchema> ?schema .
      OPTIONAL { ?shape <${prefixes.rdfs}label> ?shapeLabel }
      OPTIONAL {
        ?map a <${SM}ShExMap> ;
             <${SM}sourceSchema> ?schema .
      }
      ${schemaFilter}
    }
    GROUP BY ?schema ?shape ?shapeLabel
    HAVING (COUNT(DISTINCT ?map) = 0)
    ORDER BY ?schema ?shape
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);

  return rows.map((r) => ({
    schemaUrl:    r['schema']?.value ?? '',
    shapeUrl:     r['shape']?.value ?? '',
    shapeLabel:   r['shapeLabel']?.value ?? r['shape']?.value ?? '',
    hasMappings:  false,
    mappingCount: 0,
  }));
}
