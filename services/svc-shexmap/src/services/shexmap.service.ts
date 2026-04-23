import { v4 as uuidv4 } from 'uuid';
import { sparqlSelect, sparqlUpdate, createSparqlClient } from '@shexmap/shared';
import type { Prefixes } from '@shexmap/shared';
import type { ShExMap } from '@shexmap/shared';

type SparqlClient = ReturnType<typeof createSparqlClient>;

const MAP_VAR_RE = /%Map:\s*\{\s*([^%\s}]+)\s*%\}/g;

export function extractMapVariables(content?: string): string[] {
  if (!content) return [];
  const vars: string[] = [];
  for (const m of content.matchAll(MAP_VAR_RE)) {
    if (m[1]) vars.push(m[1]);
  }
  return [...new Set(vars)];
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function extractLocalId(iri: string): string {
  const parts = iri.split('/');
  return parts[parts.length - 1] ?? iri;
}

export async function listShExMaps(
  client: SparqlClient,
  prefixes: Prefixes,
  query: {
    q?: string; tag?: string; author?: string; schemaUrl?: string;
    hasMapAnnotations?: boolean; mapVariable?: string;
    page: number; limit: number; sort: string; order: string;
  },
): Promise<{ items: ShExMap[]; total: number }> {
  const SM = prefixes.shexmap;
  const RU = prefixes.shexruser;
  const offset = (query.page - 1) * query.limit;

  const filters: string[] = [];
  if (query.q)         filters.push(`FILTER(CONTAINS(LCASE(?title), LCASE("${escapeStr(query.q)}")) || EXISTS { ?id <${SM}mapVariable> ?qv . FILTER(CONTAINS(LCASE(?qv), LCASE("${escapeStr(query.q)}"))) })`);
  if (query.tag)       filters.push(`FILTER(EXISTS { ?id <http://www.w3.org/ns/dcat#keyword> "${escapeStr(query.tag)}" })`);
  if (query.author)    filters.push(`FILTER(?authorId = <${RU}${escapeStr(query.author)}>)`);
  if (query.schemaUrl) filters.push(`FILTER(?schemaUrl = <${escapeStr(query.schemaUrl)}>)`);
  if (query.hasMapAnnotations !== undefined) filters.push(`FILTER(?hasMapAnnotations = ${query.hasMapAnnotations})`);
  if (query.mapVariable) filters.push(`FILTER(EXISTS { ?id <${SM}mapVariable> "${escapeStr(query.mapVariable)}" })`);

  const filterBlock = filters.join('\n  ');
  const sortVar = query.sort === 'stars' ? 'stars' : query.sort;
  const orderDir = query.order === 'desc' ? 'DESC' : 'ASC';

  const coreWhere = `
    WHERE {
      ?id a <${SM}ShExMap> ;
          <http://purl.org/dc/terms/title> ?title ;
          <http://purl.org/dc/terms/creator> ?authorId ;
          <http://purl.org/dc/terms/created> ?createdAt ;
          <http://purl.org/dc/terms/modified> ?modifiedAt ;
          <https://schema.org/version> ?version .
      OPTIONAL { ?id <http://purl.org/dc/terms/description> ?description }
      OPTIONAL { ?id <${SM}fileName> ?fileName }
      OPTIONAL { ?id <${SM}fileFormat> ?fileFormat }
      OPTIONAL { ?id <http://purl.org/dc/terms/source> ?sourceUrl }
      OPTIONAL { ?id <${SM}hasSchema> ?schemaUrl }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
      OPTIONAL { ?id <${SM}stars> ?stars }
      OPTIONAL { ?id <${SM}hasMapAnnotations> ?hasMapAnnotations }
      ${filterBlock}
    }`;

  const sparql = `
    SELECT ?id ?title ?description ?fileName ?fileFormat ?sourceUrl ?schemaUrl
           ?authorId ?authorName ?createdAt ?modifiedAt ?version ?stars
           ?hasMapAnnotations ?mapVariable
    WHERE {
      {
        SELECT ?id ?title ?description ?fileName ?fileFormat ?sourceUrl ?schemaUrl
               ?authorId ?authorName ?createdAt ?modifiedAt ?version ?stars ?hasMapAnnotations
        ${coreWhere}
        ORDER BY ${orderDir}(?${sortVar})
        LIMIT ${query.limit}
        OFFSET ${offset}
      }
      OPTIONAL { ?id <${SM}mapVariable> ?mapVariable }
    }
  `;

  const countSparql = `SELECT (COUNT(DISTINCT ?id) AS ?total) ${coreWhere}`;

  const [rows, countRows] = await Promise.all([
    sparqlSelect(client, prefixes, sparql),
    sparqlSelect(client, prefixes, countSparql),
  ]);
  const total = parseInt(countRows[0]?.['total']?.value ?? '0', 10);

  const seen = new Map<string, ShExMap>();
  for (const r of rows) {
    const id = extractLocalId(r['id']?.value ?? '');
    if (!seen.has(id)) {
      seen.set(id, {
        id,
        title: r['title']?.value ?? '',
        description: r['description']?.value,
        fileName: r['fileName']?.value,
        fileFormat: r['fileFormat']?.value ?? 'shexc',
        sourceUrl: r['sourceUrl']?.value,
        schemaUrl: r['schemaUrl']?.value,
        tags: [],
        version: r['version']?.value ?? '1.0.0',
        authorId: extractLocalId(r['authorId']?.value ?? ''),
        authorName: r['authorName']?.value ?? 'Unknown',
        createdAt: r['createdAt']?.value ?? '',
        modifiedAt: r['modifiedAt']?.value ?? '',
        stars: parseInt(r['stars']?.value ?? '0', 10),
        hasMapAnnotations: r['hasMapAnnotations']?.value === 'true',
        mapVariables: [],
      });
    }
    const mv = r['mapVariable']?.value;
    if (mv) {
      const entry = seen.get(id)!;
      if (!entry.mapVariables!.includes(mv)) entry.mapVariables!.push(mv);
    }
  }

  return { items: [...seen.values()], total };
}

export async function getShExMap(
  client: SparqlClient,
  prefixes: Prefixes,
  id: string,
): Promise<ShExMap | null> {
  const SM  = prefixes.shexmap;
  const RM  = prefixes.shexrmap;
  const iri = `${RM}${id}`;

  const sparql = `
    SELECT ?title ?description ?content ?sampleTurtleData ?fileName ?fileFormat ?sourceUrl ?schemaUrl
           ?authorId ?authorName ?createdAt ?modifiedAt ?version ?stars ?tag
           ?hasMapAnnotations ?mapVariable
    WHERE {
      <${iri}> a <${SM}ShExMap> ;
          <http://purl.org/dc/terms/title> ?title ;
          <http://purl.org/dc/terms/creator> ?authorId ;
          <http://purl.org/dc/terms/created> ?createdAt ;
          <http://purl.org/dc/terms/modified> ?modifiedAt ;
          <https://schema.org/version> ?version .
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/description> ?description }
      OPTIONAL { <${iri}> <${SM}mappingContent> ?content }
      OPTIONAL { <${iri}> <${SM}sampleTurtleData> ?sampleTurtleData }
      OPTIONAL { <${iri}> <${SM}fileName> ?fileName }
      OPTIONAL { <${iri}> <${SM}fileFormat> ?fileFormat }
      OPTIONAL { <${iri}> <http://purl.org/dc/terms/source> ?sourceUrl }
      OPTIONAL { <${iri}> <${SM}hasSchema> ?schemaUrl }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
      OPTIONAL { <${iri}> <${SM}stars> ?stars }
      OPTIONAL { <${iri}> <http://www.w3.org/ns/dcat#keyword> ?tag }
      OPTIONAL { <${iri}> <${SM}hasMapAnnotations> ?hasMapAnnotations }
      OPTIONAL { <${iri}> <${SM}mapVariable> ?mapVariable }
    }
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);
  if (!rows.length) return null;

  const r = rows[0]!;
  const tags = [...new Set(rows.map((row) => row['tag']?.value).filter(Boolean) as string[])];
  const mapVariables = [...new Set(rows.map((row) => row['mapVariable']?.value).filter(Boolean) as string[])];

  return {
    id,
    title: r['title']?.value ?? '',
    description: r['description']?.value,
    content: r['content']?.value,
    sampleTurtleData: r['sampleTurtleData']?.value,
    fileName: r['fileName']?.value,
    fileFormat: r['fileFormat']?.value ?? 'shexc',
    sourceUrl: r['sourceUrl']?.value,
    schemaUrl: r['schemaUrl']?.value,
    tags,
    version: r['version']?.value ?? '1.0.0',
    authorId: extractLocalId(r['authorId']?.value ?? ''),
    authorName: r['authorName']?.value ?? 'Unknown',
    createdAt: r['createdAt']?.value ?? '',
    modifiedAt: r['modifiedAt']?.value ?? '',
    stars: parseInt(r['stars']?.value ?? '0', 10),
    hasMapAnnotations: r['hasMapAnnotations']?.value === 'true',
    mapVariables,
  };
}

export interface CreateShExMapInput {
  title: string;
  description?: string;
  content?: string;
  sampleTurtleData?: string;
  fileName?: string;
  fileFormat?: string;
  sourceUrl?: string;
  schemaUrl?: string;
  tags: string[];
  version: string;
}

export async function createShExMap(
  client: SparqlClient,
  prefixes: Prefixes,
  data: CreateShExMapInput,
  authorId: string,
): Promise<ShExMap> {
  const SM  = prefixes.shexmap;
  const RM  = prefixes.shexrmap;
  const RU  = prefixes.shexruser;

  const id  = uuidv4();
  const iri = `${RM}${id}`;
  const now = new Date().toISOString();
  const authorIri = `${RU}${authorId}`;

  const mapVars    = extractMapVariables(data.content);
  const tagTriples = data.tags.map((t) => `<${iri}> <http://www.w3.org/ns/dcat#keyword> "${escapeStr(t)}" .`).join('\n  ');
  const varTriples = mapVars.map((v) => `<${iri}> <${SM}mapVariable> "${escapeStr(v)}" .`).join('\n  ');
  const fileFormat = data.fileFormat ?? 'shexc';

  const update = `
    INSERT DATA {
      <${iri}> a <${SM}ShExMap> ;
        <http://purl.org/dc/terms/title> "${escapeStr(data.title)}" ;
        ${data.description      ? `<http://purl.org/dc/terms/description> "${escapeStr(data.description)}" ;` : ''}
        ${data.content          ? `<${SM}mappingContent> """${data.content}""" ;` : ''}
        ${data.sampleTurtleData ? `<${SM}sampleTurtleData> """${data.sampleTurtleData}""" ;` : ''}
        ${data.fileName         ? `<${SM}fileName> "${escapeStr(data.fileName)}" ;` : ''}
        <${SM}fileFormat> "${fileFormat}" ;
        ${data.sourceUrl  ? `<http://purl.org/dc/terms/source> <${data.sourceUrl}> ;` : ''}
        ${data.schemaUrl  ? `<${SM}hasSchema> <${data.schemaUrl}> ;` : ''}
        <https://schema.org/version> "${data.version}" ;
        <http://purl.org/dc/terms/creator> <${authorIri}> ;
        <http://purl.org/dc/terms/created> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
        <http://purl.org/dc/terms/modified> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
        <${SM}hasMapAnnotations> ${mapVars.length > 0} ;
        <${SM}stars> 0 .
      ${tagTriples}
      ${varTriples}
    }
  `;

  await sparqlUpdate(client, prefixes, update);

  return (await getShExMap(client, prefixes, id)) ?? {
    id,
    title: data.title,
    description: data.description,
    content: data.content,
    sampleTurtleData: data.sampleTurtleData,
    fileName: data.fileName,
    fileFormat,
    sourceUrl: data.sourceUrl,
    schemaUrl: data.schemaUrl,
    tags: data.tags,
    version: data.version,
    authorId,
    authorName: '',
    createdAt: now,
    modifiedAt: now,
    stars: 0,
    hasMapAnnotations: mapVars.length > 0,
    mapVariables: mapVars,
  };
}

export interface UpdateShExMapInput {
  title?: string;
  description?: string;
  sourceUrl?: string;
  schemaUrl?: string;
  sampleTurtleData?: string;
  tags?: string[];
  version?: string;
}

export async function updateShExMap(
  client: SparqlClient,
  prefixes: Prefixes,
  id: string,
  data: UpdateShExMapInput,
): Promise<ShExMap | null> {
  const SM  = prefixes.shexmap;
  const RM  = prefixes.shexrmap;
  const iri = `${RM}${id}`;
  const now = new Date().toISOString();

  const del: string[] = [];
  const whr: string[] = [];
  const ins: string[] = [];

  if (data.title !== undefined) {
    del.push(`<${iri}> <http://purl.org/dc/terms/title> ?title .`);
    whr.push(`OPTIONAL { <${iri}> <http://purl.org/dc/terms/title> ?title }`);
    ins.push(`<${iri}> <http://purl.org/dc/terms/title> "${escapeStr(data.title)}" .`);
  }
  if (data.description !== undefined) {
    del.push(`<${iri}> <http://purl.org/dc/terms/description> ?desc .`);
    whr.push(`OPTIONAL { <${iri}> <http://purl.org/dc/terms/description> ?desc }`);
    if (data.description) ins.push(`<${iri}> <http://purl.org/dc/terms/description> "${escapeStr(data.description)}" .`);
  }
  if (data.tags !== undefined) {
    del.push(`<${iri}> <http://www.w3.org/ns/dcat#keyword> ?tag .`);
    whr.push(`OPTIONAL { <${iri}> <http://www.w3.org/ns/dcat#keyword> ?tag }`);
    for (const t of data.tags) ins.push(`<${iri}> <http://www.w3.org/ns/dcat#keyword> "${escapeStr(t)}" .`);
  }
  if (data.version !== undefined) {
    del.push(`<${iri}> <https://schema.org/version> ?version .`);
    whr.push(`OPTIONAL { <${iri}> <https://schema.org/version> ?version }`);
    ins.push(`<${iri}> <https://schema.org/version> "${data.version}" .`);
  }
  if (data.sourceUrl !== undefined) {
    del.push(`<${iri}> <http://purl.org/dc/terms/source> ?sourceUrl .`);
    whr.push(`OPTIONAL { <${iri}> <http://purl.org/dc/terms/source> ?sourceUrl }`);
    if (data.sourceUrl) ins.push(`<${iri}> <http://purl.org/dc/terms/source> <${data.sourceUrl}> .`);
  }
  if (data.schemaUrl !== undefined) {
    del.push(`<${iri}> <${SM}hasSchema> ?schemaUrl .`);
    whr.push(`OPTIONAL { <${iri}> <${SM}hasSchema> ?schemaUrl }`);
    if (data.schemaUrl) ins.push(`<${iri}> <${SM}hasSchema> <${data.schemaUrl}> .`);
  }
  if (data.sampleTurtleData !== undefined) {
    del.push(`<${iri}> <${SM}sampleTurtleData> ?sampleTurtle .`);
    whr.push(`OPTIONAL { <${iri}> <${SM}sampleTurtleData> ?sampleTurtle }`);
    if (data.sampleTurtleData) ins.push(`<${iri}> <${SM}sampleTurtleData> """${data.sampleTurtleData}""" .`);
  }

  del.push(`<${iri}> <http://purl.org/dc/terms/modified> ?modified .`);
  whr.push(`OPTIONAL { <${iri}> <http://purl.org/dc/terms/modified> ?modified }`);
  ins.push(`<${iri}> <http://purl.org/dc/terms/modified> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`);

  await sparqlUpdate(client, prefixes, `
    DELETE { ${del.join('\n      ')} }
    WHERE  { ${whr.join('\n      ')} }
  `);
  await sparqlUpdate(client, prefixes, `INSERT DATA { ${ins.join('\n    ')} }`);

  return getShExMap(client, prefixes, id);
}

export async function deleteShExMap(
  client: SparqlClient,
  prefixes: Prefixes,
  id: string,
): Promise<void> {
  const RM = prefixes.shexrmap;
  await sparqlUpdate(client, prefixes, `DELETE WHERE { <${RM}${id}> ?p ?o }`);
}
