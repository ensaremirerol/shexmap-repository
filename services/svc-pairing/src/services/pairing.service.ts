import { v4 as uuidv4 } from 'uuid';
import { sparqlSelect, sparqlUpdate, createSparqlClient } from '@shexmap/shared';
import type { Prefixes } from '@shexmap/shared';
import type { ShExMapPairing, ShExMap } from '@shexmap/shared';

type SparqlClient = ReturnType<typeof createSparqlClient>;
type SparqlRow = Record<string, { value: string } | undefined>;

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function extractLocalId(iri: string): string {
  const parts = iri.split('/');
  return parts[parts.length - 1] ?? iri;
}

function rowToShExMap(r: SparqlRow, prefix: 'src' | 'tgt'): ShExMap {
  return {
    id: extractLocalId(r[`${prefix}Id`]?.value ?? ''),
    title: r[`${prefix}Title`]?.value ?? '',
    fileName: r[`${prefix}FileName`]?.value,
    fileFormat: r[`${prefix}FileFormat`]?.value ?? 'shexc',
    sourceUrl: r[`${prefix}SourceUrl`]?.value,
    schemaUrl: r[`${prefix}SchemaUrl`]?.value,
    tags: [],
    version: '1.0.0',
    authorId: '',
    authorName: '',
    createdAt: '',
    modifiedAt: '',
    stars: 0,
  };
}

export interface ListPairingsQuery {
  q?: string;
  tag?: string;
  author?: string;
  sourceMapId?: string;
  targetMapId?: string;
  page: number;
  limit: number;
  sort: string;
  order: string;
}

export async function listShExMapPairings(
  client: SparqlClient,
  prefixes: Prefixes,
  query: ListPairingsQuery,
): Promise<{ items: ShExMapPairing[]; total: number }> {
  const SM = prefixes.shexmap;
  const RM = prefixes.shexrmap;
  const RU = prefixes.shexruser;
  const offset = (query.page - 1) * query.limit;

  const filters: string[] = [];
  if (query.q)           filters.push(`FILTER(CONTAINS(LCASE(?title), LCASE("${escapeStr(query.q)}")))`);
  if (query.tag)         filters.push(`FILTER(EXISTS { ?id <http://www.w3.org/ns/dcat#keyword> "${escapeStr(query.tag)}" })`);
  if (query.author)      filters.push(`FILTER(?authorId = <${RU}${escapeStr(query.author)}>)`);
  if (query.sourceMapId) filters.push(`FILTER(?srcId = <${RM}${escapeStr(query.sourceMapId)}>)`);
  if (query.targetMapId) filters.push(`FILTER(?tgtId = <${RM}${escapeStr(query.targetMapId)}>)`);

  const filterBlock = filters.join('\n  ');
  const sortVar = query.sort === 'stars' ? 'stars' : query.sort;
  const orderBy = `ORDER BY ${query.order === 'desc' ? 'DESC' : 'ASC'}(?${sortVar})`;

  const pairingWhereBlock = `
    WHERE {
      ?id a <${SM}ShExMapPairing> ;
          <http://purl.org/dc/terms/title> ?title ;
          <${SM}sourceMap> ?srcId ;
          <${SM}targetMap> ?tgtId ;
          <http://purl.org/dc/terms/creator> ?authorId ;
          <http://purl.org/dc/terms/created> ?createdAt ;
          <http://purl.org/dc/terms/modified> ?modifiedAt ;
          <https://schema.org/version> ?version .
      OPTIONAL { ?id <http://purl.org/dc/terms/description> ?description }
      OPTIONAL { ?id <http://purl.org/dc/terms/license> ?license }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
      OPTIONAL { ?id <${SM}stars> ?stars }
      OPTIONAL { ?srcId <http://purl.org/dc/terms/title> ?srcTitle }
      OPTIONAL { ?srcId <${SM}fileName> ?srcFileName }
      OPTIONAL { ?srcId <${SM}fileFormat> ?srcFileFormat }
      OPTIONAL { ?srcId <http://purl.org/dc/terms/source> ?srcSourceUrl }
      OPTIONAL { ?tgtId <http://purl.org/dc/terms/title> ?tgtTitle }
      OPTIONAL { ?tgtId <${SM}fileName> ?tgtFileName }
      OPTIONAL { ?tgtId <${SM}fileFormat> ?tgtFileFormat }
      OPTIONAL { ?tgtId <http://purl.org/dc/terms/source> ?tgtSourceUrl }
      OPTIONAL { ?srcId <${SM}hasSchema> ?srcSchemaUrl }
      OPTIONAL { ?tgtId <${SM}hasSchema> ?tgtSchemaUrl }
      ${filterBlock}
    }`;

  const sparql = `
    SELECT ?id ?title ?description ?license
           ?authorId ?authorName ?createdAt ?modifiedAt ?version ?stars
           ?srcId ?srcTitle ?srcFileName ?srcFileFormat ?srcSourceUrl ?srcSchemaUrl
           ?tgtId ?tgtTitle ?tgtFileName ?tgtFileFormat ?tgtSourceUrl ?tgtSchemaUrl
    ${pairingWhereBlock}
    ${orderBy}
    LIMIT ${query.limit}
    OFFSET ${offset}
  `;

  const countSparql = `SELECT (COUNT(DISTINCT ?id) AS ?total) ${pairingWhereBlock}`;

  const [rows, countRows] = await Promise.all([
    sparqlSelect(client, prefixes, sparql),
    sparqlSelect(client, prefixes, countSparql),
  ]);
  const total = parseInt(countRows[0]?.['total']?.value ?? '0', 10);

  const seen = new Set<string>();
  const items: ShExMapPairing[] = [];
  for (const r of rows) {
    const id = extractLocalId(r['id']?.value ?? '');
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title: r['title']?.value ?? '',
      description: r['description']?.value,
      sourceMap: rowToShExMap(r, 'src'),
      targetMap: rowToShExMap(r, 'tgt'),
      tags: [],
      license: r['license']?.value,
      version: r['version']?.value ?? '1.0.0',
      authorId: extractLocalId(r['authorId']?.value ?? ''),
      authorName: r['authorName']?.value ?? 'Unknown',
      createdAt: r['createdAt']?.value ?? '',
      modifiedAt: r['modifiedAt']?.value ?? '',
      stars: parseInt(r['stars']?.value ?? '0', 10),
    });
  }

  return { items, total };
}

export async function getShExMapPairing(
  client: SparqlClient,
  prefixes: Prefixes,
  id: string,
): Promise<ShExMapPairing | null> {
  const SM  = prefixes.shexmap;
  const RP  = prefixes.shexrpair;
  const iri = `${RP}${id}`;

  const sparql = `
    SELECT ?title ?description ?version ?license ?stars ?tag
           ?authorId ?authorName ?createdAt ?modifiedAt
           ?sourceFocusIri ?targetFocusIri
           ?srcId ?srcTitle ?srcDesc ?srcContent ?srcSampleTurtle ?srcFileName ?srcFileFormat ?srcSourceUrl ?srcSchemaUrl
           ?tgtId ?tgtTitle ?tgtDesc ?tgtContent ?tgtSampleTurtle ?tgtFileName ?tgtFileFormat ?tgtSourceUrl ?tgtSchemaUrl
    WHERE {
      <${iri}> a <${SM}ShExMapPairing> ;
          <http://purl.org/dc/terms/title> ?title ;
          <${SM}sourceMap> ?srcId ;
          <${SM}targetMap> ?tgtId ;
          <http://purl.org/dc/terms/creator> ?authorId ;
          <http://purl.org/dc/terms/created> ?createdAt ;
          <http://purl.org/dc/terms/modified> ?modifiedAt ;
          <https://schema.org/version> ?version .
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/description> ?description }
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/license> ?license }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
      OPTIONAL { <${iri}> <${SM}stars> ?stars }
      OPTIONAL { <${iri}> <http://www.w3.org/ns/dcat#keyword> ?tag }
      OPTIONAL { <${iri}> <${SM}sourceFocusIri> ?sourceFocusIri }
      OPTIONAL { <${iri}> <${SM}targetFocusIri> ?targetFocusIri }
      OPTIONAL { ?srcId <http://purl.org/dc/terms/title> ?srcTitle }
      OPTIONAL { ?srcId <http://purl.org/dc/terms/description> ?srcDesc }
      OPTIONAL { ?srcId <${SM}mappingContent> ?srcContent }
      OPTIONAL { ?srcId <${SM}sampleTurtleData> ?srcSampleTurtle }
      OPTIONAL { ?srcId <${SM}fileName> ?srcFileName }
      OPTIONAL { ?srcId <${SM}fileFormat> ?srcFileFormat }
      OPTIONAL { ?srcId <http://purl.org/dc/terms/source> ?srcSourceUrl }
      OPTIONAL { ?srcId <${SM}hasSchema> ?srcSchemaUrl }
      OPTIONAL { ?tgtId <http://purl.org/dc/terms/title> ?tgtTitle }
      OPTIONAL { ?tgtId <http://purl.org/dc/terms/description> ?tgtDesc }
      OPTIONAL { ?tgtId <${SM}mappingContent> ?tgtContent }
      OPTIONAL { ?tgtId <${SM}sampleTurtleData> ?tgtSampleTurtle }
      OPTIONAL { ?tgtId <${SM}fileName> ?tgtFileName }
      OPTIONAL { ?tgtId <${SM}fileFormat> ?tgtFileFormat }
      OPTIONAL { ?tgtId <http://purl.org/dc/terms/source> ?tgtSourceUrl }
      OPTIONAL { ?tgtId <${SM}hasSchema> ?tgtSchemaUrl }
    }
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);
  if (!rows.length) return null;

  const r = rows[0]!;
  const tags = [...new Set(rows.map((row) => row['tag']?.value).filter(Boolean) as string[])];

  return {
    id,
    title: r['title']?.value ?? '',
    description: r['description']?.value,
    sourceMap: {
      id: extractLocalId(r['srcId']?.value ?? ''),
      title: r['srcTitle']?.value ?? '',
      description: r['srcDesc']?.value,
      content: r['srcContent']?.value,
      sampleTurtleData: r['srcSampleTurtle']?.value,
      fileName: r['srcFileName']?.value,
      fileFormat: r['srcFileFormat']?.value ?? 'shexc',
      sourceUrl: r['srcSourceUrl']?.value,
      schemaUrl: r['srcSchemaUrl']?.value,
      tags: [],
      version: '1.0.0',
      authorId: '',
      authorName: '',
      createdAt: '',
      modifiedAt: '',
      stars: 0,
    },
    targetMap: {
      id: extractLocalId(r['tgtId']?.value ?? ''),
      title: r['tgtTitle']?.value ?? '',
      description: r['tgtDesc']?.value,
      content: r['tgtContent']?.value,
      sampleTurtleData: r['tgtSampleTurtle']?.value,
      fileName: r['tgtFileName']?.value,
      fileFormat: r['tgtFileFormat']?.value ?? 'shexc',
      sourceUrl: r['tgtSourceUrl']?.value,
      schemaUrl: r['tgtSchemaUrl']?.value,
      tags: [],
      version: '1.0.0',
      authorId: '',
      authorName: '',
      createdAt: '',
      modifiedAt: '',
      stars: 0,
    },
    sourceFocusIri: r['sourceFocusIri']?.value,
    targetFocusIri: r['targetFocusIri']?.value,
    tags,
    license: r['license']?.value,
    version: r['version']?.value ?? '1.0.0',
    authorId: extractLocalId(r['authorId']?.value ?? ''),
    authorName: r['authorName']?.value ?? 'Unknown',
    createdAt: r['createdAt']?.value ?? '',
    modifiedAt: r['modifiedAt']?.value ?? '',
    stars: parseInt(r['stars']?.value ?? '0', 10),
  };
}

export interface CreatePairingInput {
  title: string;
  description?: string;
  sourceMapId: string;
  targetMapId: string;
  sourceFocusIri?: string;
  targetFocusIri?: string;
  tags: string[];
  license?: string;
  version: string;
}

export async function createShExMapPairing(
  client: SparqlClient,
  prefixes: Prefixes,
  data: CreatePairingInput,
  authorId: string,
): Promise<ShExMapPairing> {
  const SM       = prefixes.shexmap;
  const RP       = prefixes.shexrpair;
  const RM       = prefixes.shexrmap;
  const RU       = prefixes.shexruser;

  const id       = uuidv4();
  const iri      = `${RP}${id}`;
  const now      = new Date().toISOString();
  const authorIri = `${RU}${authorId}`;
  const srcIri   = `${RM}${data.sourceMapId}`;
  const tgtIri   = `${RM}${data.targetMapId}`;

  const tagTriples = data.tags.map((t) => `<${iri}> <http://www.w3.org/ns/dcat#keyword> "${escapeStr(t)}" .`).join('\n  ');

  const update = `
    INSERT DATA {
      <${iri}> a <${SM}ShExMapPairing> ;
        <http://purl.org/dc/terms/identifier> "${id}" ;
        <http://purl.org/dc/terms/title> "${escapeStr(data.title)}" ;
        ${data.description    ? `<http://purl.org/dc/terms/description> "${escapeStr(data.description)}" ;` : ''}
        <${SM}sourceMap> <${srcIri}> ;
        <${SM}targetMap> <${tgtIri}> ;
        ${data.sourceFocusIri ? `<${SM}sourceFocusIri> "${escapeStr(data.sourceFocusIri)}" ;` : ''}
        ${data.targetFocusIri ? `<${SM}targetFocusIri> "${escapeStr(data.targetFocusIri)}" ;` : ''}
        ${data.license        ? `<http://purl.org/dc/terms/license> <${data.license}> ;` : ''}
        <https://schema.org/version> "${data.version}" ;
        <http://purl.org/dc/terms/creator> <${authorIri}> ;
        <http://purl.org/dc/terms/created> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
        <http://purl.org/dc/terms/modified> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
        <${SM}stars> 0 .
      ${tagTriples}
    }
  `;

  await sparqlUpdate(client, prefixes, update);
  return (await getShExMapPairing(client, prefixes, id))!;
}

export interface UpdatePairingInput {
  title?: string;
  description?: string;
  sourceMapId?: string;
  targetMapId?: string;
  sourceFocusIri?: string;
  targetFocusIri?: string;
  tags?: string[];
  license?: string;
  version?: string;
}

export async function updateShExMapPairing(
  client: SparqlClient,
  prefixes: Prefixes,
  id: string,
  data: UpdatePairingInput,
): Promise<ShExMapPairing | null> {
  const SM  = prefixes.shexmap;
  const RP  = prefixes.shexrpair;
  const RM  = prefixes.shexrmap;
  const iri = `${RP}${id}`;
  const now = new Date().toISOString();

  await sparqlUpdate(client, prefixes, `
    DELETE {
      <${iri}> <http://purl.org/dc/terms/title> ?title .
      <${iri}> <http://purl.org/dc/terms/description> ?description .
      <${iri}> <http://www.w3.org/ns/dcat#keyword> ?tag .
      <${iri}> <https://schema.org/version> ?version .
      <${iri}> <http://purl.org/dc/terms/modified> ?modified .
      <${iri}> <http://purl.org/dc/terms/license> ?license .
      <${iri}> <${SM}sourceMap> ?srcMap .
      <${iri}> <${SM}targetMap> ?tgtMap .
      <${iri}> <${SM}sourceFocusIri> ?srcFocus .
      <${iri}> <${SM}targetFocusIri> ?tgtFocus .
    }
    WHERE {
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/title> ?title }
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/description> ?description }
      OPTIONAL { <${iri}> <http://www.w3.org/ns/dcat#keyword> ?tag }
      OPTIONAL { <${iri}> <https://schema.org/version> ?version }
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/modified> ?modified }
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/license> ?license }
      OPTIONAL { <${iri}> <${SM}sourceMap> ?srcMap }
      OPTIONAL { <${iri}> <${SM}targetMap> ?tgtMap }
      OPTIONAL { <${iri}> <${SM}sourceFocusIri> ?srcFocus }
      OPTIONAL { <${iri}> <${SM}targetFocusIri> ?tgtFocus }
    }
  `);

  const tagTriples = (data.tags ?? []).map((t) => `<${iri}> <http://www.w3.org/ns/dcat#keyword> "${escapeStr(t)}" .`).join('\n    ');
  const lines = [
    data.title !== undefined           ? `<${iri}> <http://purl.org/dc/terms/title> "${escapeStr(data.title)}" .` : '',
    data.description !== undefined     ? `<${iri}> <http://purl.org/dc/terms/description> "${escapeStr(data.description)}" .` : '',
    data.version !== undefined         ? `<${iri}> <https://schema.org/version> "${data.version}" .` : '',
    data.license !== undefined         ? `<${iri}> <http://purl.org/dc/terms/license> <${data.license}> .` : '',
    data.sourceMapId !== undefined     ? `<${iri}> <${SM}sourceMap> <${RM}${data.sourceMapId}> .` : '',
    data.targetMapId !== undefined     ? `<${iri}> <${SM}targetMap> <${RM}${data.targetMapId}> .` : '',
    data.sourceFocusIri !== undefined  ? `<${iri}> <${SM}sourceFocusIri> "${escapeStr(data.sourceFocusIri)}" .` : '',
    data.targetFocusIri !== undefined  ? `<${iri}> <${SM}targetFocusIri> "${escapeStr(data.targetFocusIri)}" .` : '',
    `<${iri}> <http://purl.org/dc/terms/modified> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
    tagTriples,
  ].filter(Boolean).join('\n    ');

  await sparqlUpdate(client, prefixes, `INSERT DATA { ${lines} }`);
  return getShExMapPairing(client, prefixes, id);
}

export async function deleteShExMapPairing(
  client: SparqlClient,
  prefixes: Prefixes,
  id: string,
): Promise<void> {
  const RP = prefixes.shexrpair;
  await sparqlUpdate(client, prefixes, `DELETE WHERE { <${RP}${id}> ?p ?o }`);
}
