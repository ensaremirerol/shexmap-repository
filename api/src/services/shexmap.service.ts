import { v4 as uuidv4 } from 'uuid';
import type { FastifyInstance } from 'fastify';
import type {
  ShExMap, ShExMapCreate, ShExMapUpdate, ShExMapQuery,
  ShExMapPairing, ShExMapPairingCreate, ShExMapPairingUpdate, ShExMapPairingQuery,
} from '../models/shexmap.model.js';
import { sparqlSelect, sparqlUpdate } from './sparql.service.js';
import { validateShExMap } from './shex.service.js';
import { saveNewVersion } from './version.service.js';
import { PREFIXES } from '../rdf/prefixes.js';

const RM   = PREFIXES.shexrmap;
const RP   = PREFIXES.shexrpair;
const RU   = PREFIXES.shexruser;
const SM   = PREFIXES.shexmap;

// ─── Individual ShExMap ───────────────────────────────────────────────────────

export async function listShExMaps(
  fastify: FastifyInstance,
  query: ShExMapQuery
): Promise<{ items: ShExMap[]; total: number }> {
  const offset = (query.page - 1) * query.limit;

  const filters: string[] = [];
  if (query.q)         filters.push(`FILTER(CONTAINS(LCASE(?title), LCASE("${escapeStr(query.q)}")))`);
  if (query.tag)       filters.push(`FILTER(EXISTS { ?id dcat:keyword "${escapeStr(query.tag)}" })`);
  if (query.author)    filters.push(`FILTER(?authorId = <${RU}${escapeStr(query.author)}>)`);
  if (query.schemaUrl) filters.push(`FILTER(?schemaUrl = <${escapeStr(query.schemaUrl)}>)`);

  const filterBlock = filters.join('\n  ');
  const sortVar = query.sort === 'stars' ? 'stars' : query.sort;
  const orderBy = `ORDER BY ${query.order === 'desc' ? 'DESC' : 'ASC'}(?${sortVar})`;

  const whereBlock = `
    WHERE {
      ?id a <${SM}ShExMap> ;
          dct:title ?title ;
          dct:creator ?authorId ;
          dct:created ?createdAt ;
          dct:modified ?modifiedAt ;
          schema:version ?version .
      OPTIONAL { ?id dct:description ?description }
      OPTIONAL { ?id <${SM}fileName> ?fileName }
      OPTIONAL { ?id <${SM}fileFormat> ?fileFormat }
      OPTIONAL { ?id dct:source ?sourceUrl }
      OPTIONAL { ?id <${SM}hasSchema> ?schemaUrl }
      OPTIONAL { ?authorId schema:name ?authorName }
      OPTIONAL { ?id <${SM}stars> ?stars }
      ${filterBlock}
    }`;

  const sparql = `
    SELECT ?id ?title ?description ?fileName ?fileFormat ?sourceUrl ?schemaUrl
           ?authorId ?authorName ?createdAt ?modifiedAt ?version ?stars
    ${whereBlock}
    ${orderBy}
    LIMIT ${query.limit}
    OFFSET ${offset}
  `;

  const countSparql = `SELECT (COUNT(DISTINCT ?id) AS ?total) ${whereBlock}`;

  const [rows, countRows] = await Promise.all([
    sparqlSelect(fastify, sparql),
    sparqlSelect(fastify, countSparql),
  ]);
  const total = parseInt(countRows[0]?.['total']?.value ?? '0', 10);

  const seen = new Set<string>();
  const items: ShExMap[] = [];
  for (const r of rows) {
    const id = extractLocalId(r['id']?.value ?? '');
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
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
    });
  }

  return { items, total };
}

export async function getShExMap(
  fastify: FastifyInstance,
  id: string
): Promise<ShExMap | null> {
  const iri = `${RM}${id}`;

  const sparql = `
    SELECT ?title ?description ?content ?sampleTurtleData ?fileName ?fileFormat ?sourceUrl ?schemaUrl
           ?authorId ?authorName ?createdAt ?modifiedAt ?version ?stars ?tag
    WHERE {
      <${iri}> a <${SM}ShExMap> ;
          dct:title ?title ;
          dct:creator ?authorId ;
          dct:created ?createdAt ;
          dct:modified ?modifiedAt ;
          schema:version ?version .
      OPTIONAL { <${iri}> dct:description ?description }
      OPTIONAL { <${iri}> <${SM}mappingContent> ?content }
      OPTIONAL { <${iri}> <${SM}sampleTurtleData> ?sampleTurtleData }
      OPTIONAL { <${iri}> <${SM}fileName> ?fileName }
      OPTIONAL { <${iri}> <${SM}fileFormat> ?fileFormat }
      OPTIONAL { <${iri}> dct:source ?sourceUrl }
      OPTIONAL { <${iri}> <${SM}hasSchema> ?schemaUrl }
      OPTIONAL { ?authorId schema:name ?authorName }
      OPTIONAL { <${iri}> <${SM}stars> ?stars }
      OPTIONAL { <${iri}> dcat:keyword ?tag }
    }
  `;

  const rows = await sparqlSelect(fastify, sparql);
  if (!rows.length) return null;

  const r = rows[0]!;
  const tags = [...new Set(rows.map((row) => row['tag']?.value).filter(Boolean) as string[])];

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
  };
}

export async function createShExMap(
  fastify: FastifyInstance,
  data: ShExMapCreate,
  authorId: string
): Promise<ShExMap> {
  if (data.content) {
    const validation = validateShExMap(data.content);
    if (!validation.valid) throw new Error(`Invalid ShExMap: ${validation.error}`);
  }

  const id = uuidv4();
  const iri = `${RM}${id}`;
  const now = new Date().toISOString();
  const authorIri = `${RU}${authorId}`;

  const tagTriples = data.tags.map((t) => `<${iri}> dcat:keyword "${escapeStr(t)}" .`).join('\n  ');

  const update = `
    INSERT DATA {
      <${iri}> a <${SM}ShExMap> ;
        dct:title "${escapeStr(data.title)}" ;
        ${data.description      ? `dct:description "${escapeStr(data.description)}" ;` : ''}
        ${data.content          ? `<${SM}mappingContent> """${data.content}""" ;` : ''}
        ${data.sampleTurtleData ? `<${SM}sampleTurtleData> """${data.sampleTurtleData}""" ;` : ''}
        ${data.fileName         ? `<${SM}fileName> "${escapeStr(data.fileName)}" ;` : ''}
        <${SM}fileFormat> "${data.fileFormat}" ;
        ${data.sourceUrl  ? `dct:source <${data.sourceUrl}> ;` : ''}
        ${data.schemaUrl  ? `<${SM}hasSchema> <${data.schemaUrl}> ;` : ''}
        schema:version "${data.version}" ;
        dct:creator <${authorIri}> ;
        dct:created "${now}"^^xsd:dateTime ;
        dct:modified "${now}"^^xsd:dateTime ;
        <${SM}stars> 0 .
      ${tagTriples}
    }
  `;

  await sparqlUpdate(fastify, update);
  if (data.content) {
    await saveNewVersion(fastify, id, authorId, data.content, 'Initial version');
  }
  return (await getShExMap(fastify, id)) ?? {
    id, ...data, content: data.content, authorId, authorName: '',
    createdAt: now, modifiedAt: now, stars: 0,
  };
}

export async function updateShExMap(
  fastify: FastifyInstance,
  id: string,
  data: ShExMapUpdate
): Promise<ShExMap | null> {
  const iri = `${RM}${id}`;
  const now = new Date().toISOString();

  // Build DELETE/WHERE + INSERT DATA separately (QLever does not support combined DELETE/INSERT/WHERE).
  const del: string[] = [];
  const whr: string[] = [];
  const ins: string[] = [];

  if (data.title !== undefined) {
    del.push(`<${iri}> dct:title ?title .`);
    whr.push(`OPTIONAL { <${iri}> dct:title ?title }`);
    ins.push(`<${iri}> dct:title "${escapeStr(data.title)}" .`);
  }
  if (data.description !== undefined) {
    del.push(`<${iri}> dct:description ?desc .`);
    whr.push(`OPTIONAL { <${iri}> dct:description ?desc }`);
    if (data.description) ins.push(`<${iri}> dct:description "${escapeStr(data.description)}" .`);
  }
  if (data.tags !== undefined) {
    del.push(`<${iri}> dcat:keyword ?tag .`);
    whr.push(`OPTIONAL { <${iri}> dcat:keyword ?tag }`);
    for (const t of data.tags) ins.push(`<${iri}> dcat:keyword "${escapeStr(t)}" .`);
  }
  if (data.version !== undefined) {
    del.push(`<${iri}> schema:version ?version .`);
    whr.push(`OPTIONAL { <${iri}> schema:version ?version }`);
    ins.push(`<${iri}> schema:version "${data.version}" .`);
  }
  if (data.sourceUrl !== undefined) {
    del.push(`<${iri}> dct:source ?sourceUrl .`);
    whr.push(`OPTIONAL { <${iri}> dct:source ?sourceUrl }`);
    if (data.sourceUrl) ins.push(`<${iri}> dct:source <${data.sourceUrl}> .`);
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
  // Always bump modified
  del.push(`<${iri}> dct:modified ?modified .`);
  whr.push(`OPTIONAL { <${iri}> dct:modified ?modified }`);
  ins.push(`<${iri}> dct:modified "${now}"^^xsd:dateTime .`);

  await sparqlUpdate(fastify, `
    DELETE { ${del.join('\n      ')} }
    WHERE  { ${whr.join('\n      ')} }
  `);
  await sparqlUpdate(fastify, `INSERT DATA { ${ins.join('\n    ')} }`);

  return getShExMap(fastify, id);
}

export async function deleteShExMap(fastify: FastifyInstance, id: string): Promise<void> {
  await sparqlUpdate(fastify, `DELETE WHERE { <${RM}${id}> ?p ?o }`);
}

// ─── ShExMap Pairing ──────────────────────────────────────────────────────────

export async function listShExMapPairings(
  fastify: FastifyInstance,
  query: ShExMapPairingQuery
): Promise<{ items: ShExMapPairing[]; total: number }> {
  const offset = (query.page - 1) * query.limit;

  const filters: string[] = [];
  if (query.q)           filters.push(`FILTER(CONTAINS(LCASE(?title), LCASE("${escapeStr(query.q)}")))`);
  if (query.tag)         filters.push(`FILTER(EXISTS { ?id dcat:keyword "${escapeStr(query.tag)}" })`);
  if (query.author)      filters.push(`FILTER(?authorId = <${RU}${escapeStr(query.author)}>)`);
  if (query.sourceMapId) filters.push(`FILTER(?srcId = <${RM}${escapeStr(query.sourceMapId)}>)`);
  if (query.targetMapId) filters.push(`FILTER(?tgtId = <${RM}${escapeStr(query.targetMapId)}>)`);

  const filterBlock = filters.join('\n  ');
  const sortVar = query.sort === 'stars' ? 'stars' : query.sort;
  const orderBy = `ORDER BY ${query.order === 'desc' ? 'DESC' : 'ASC'}(?${sortVar})`;

  const pairingWhereBlock = `
    WHERE {
      ?id a <${SM}ShExMapPairing> ;
          dct:title ?title ;
          <${SM}sourceMap> ?srcId ;
          <${SM}targetMap> ?tgtId ;
          dct:creator ?authorId ;
          dct:created ?createdAt ;
          dct:modified ?modifiedAt ;
          schema:version ?version .
      OPTIONAL { ?id dct:description ?description }
      OPTIONAL { ?id dct:license ?license }
      OPTIONAL { ?authorId schema:name ?authorName }
      OPTIONAL { ?id <${SM}stars> ?stars }
      OPTIONAL { ?srcId dct:title ?srcTitle }
      OPTIONAL { ?srcId <${SM}fileName> ?srcFileName }
      OPTIONAL { ?srcId <${SM}fileFormat> ?srcFileFormat }
      OPTIONAL { ?srcId dct:source ?srcSourceUrl }
      OPTIONAL { ?tgtId dct:title ?tgtTitle }
      OPTIONAL { ?tgtId <${SM}fileName> ?tgtFileName }
      OPTIONAL { ?tgtId <${SM}fileFormat> ?tgtFileFormat }
      OPTIONAL { ?tgtId dct:source ?tgtSourceUrl }
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
    sparqlSelect(fastify, sparql),
    sparqlSelect(fastify, countSparql),
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
  fastify: FastifyInstance,
  id: string
): Promise<ShExMapPairing | null> {
  const iri = `${RP}${id}`;

  const sparql = `
    SELECT ?title ?description ?version ?license ?stars ?tag
           ?authorId ?authorName ?createdAt ?modifiedAt
           ?sourceFocusIri ?targetFocusIri
           ?srcId ?srcTitle ?srcDesc ?srcContent ?srcSampleTurtle ?srcFileName ?srcFileFormat ?srcSourceUrl ?srcSchemaUrl
           ?tgtId ?tgtTitle ?tgtDesc ?tgtContent ?tgtSampleTurtle ?tgtFileName ?tgtFileFormat ?tgtSourceUrl ?tgtSchemaUrl
    WHERE {
      <${iri}> a <${SM}ShExMapPairing> ;
          dct:title ?title ;
          <${SM}sourceMap> ?srcId ;
          <${SM}targetMap> ?tgtId ;
          dct:creator ?authorId ;
          dct:created ?createdAt ;
          dct:modified ?modifiedAt ;
          schema:version ?version .
      OPTIONAL { <${iri}> dct:description ?description }
      OPTIONAL { <${iri}> dct:license ?license }
      OPTIONAL { ?authorId schema:name ?authorName }
      OPTIONAL { <${iri}> <${SM}stars> ?stars }
      OPTIONAL { <${iri}> dcat:keyword ?tag }
      OPTIONAL { <${iri}> <${SM}sourceFocusIri> ?sourceFocusIri }
      OPTIONAL { <${iri}> <${SM}targetFocusIri> ?targetFocusIri }
      OPTIONAL { ?srcId dct:title ?srcTitle }
      OPTIONAL { ?srcId dct:description ?srcDesc }
      OPTIONAL { ?srcId <${SM}mappingContent> ?srcContent }
      OPTIONAL { ?srcId <${SM}sampleTurtleData> ?srcSampleTurtle }
      OPTIONAL { ?srcId <${SM}fileName> ?srcFileName }
      OPTIONAL { ?srcId <${SM}fileFormat> ?srcFileFormat }
      OPTIONAL { ?srcId dct:source ?srcSourceUrl }
      OPTIONAL { ?srcId <${SM}hasSchema> ?srcSchemaUrl }
      OPTIONAL { ?tgtId dct:title ?tgtTitle }
      OPTIONAL { ?tgtId dct:description ?tgtDesc }
      OPTIONAL { ?tgtId <${SM}mappingContent> ?tgtContent }
      OPTIONAL { ?tgtId <${SM}sampleTurtleData> ?tgtSampleTurtle }
      OPTIONAL { ?tgtId <${SM}fileName> ?tgtFileName }
      OPTIONAL { ?tgtId <${SM}fileFormat> ?tgtFileFormat }
      OPTIONAL { ?tgtId dct:source ?tgtSourceUrl }
      OPTIONAL { ?tgtId <${SM}hasSchema> ?tgtSchemaUrl }
    }
  `;

  const rows = await sparqlSelect(fastify, sparql);
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

export async function createShExMapPairing(
  fastify: FastifyInstance,
  data: ShExMapPairingCreate,
  authorId: string
): Promise<ShExMapPairing> {
  const id = uuidv4();
  const iri = `${RP}${id}`;
  const now = new Date().toISOString();
  const authorIri = `${RU}${authorId}`;
  const srcIri = `${RM}${data.sourceMapId}`;
  const tgtIri = `${RM}${data.targetMapId}`;

  const tagTriples = data.tags.map((t) => `<${iri}> dcat:keyword "${escapeStr(t)}" .`).join('\n  ');

  const update = `
    INSERT DATA {
      <${iri}> a <${SM}ShExMapPairing> ;
        dct:identifier "${id}" ;
        dct:title "${escapeStr(data.title)}" ;
        ${data.description ? `dct:description "${escapeStr(data.description)}" ;` : ''}
        <${SM}sourceMap> <${srcIri}> ;
        <${SM}targetMap> <${tgtIri}> ;
        ${data.sourceFocusIri ? `<${SM}sourceFocusIri> "${escapeStr(data.sourceFocusIri)}" ;` : ''}
        ${data.targetFocusIri ? `<${SM}targetFocusIri> "${escapeStr(data.targetFocusIri)}" ;` : ''}
        ${data.license ? `dct:license <${data.license}> ;` : ''}
        schema:version "${data.version}" ;
        dct:creator <${authorIri}> ;
        dct:created "${now}"^^xsd:dateTime ;
        dct:modified "${now}"^^xsd:dateTime ;
        <${SM}stars> 0 .
      ${tagTriples}
    }
  `;

  await sparqlUpdate(fastify, update);
  return (await getShExMapPairing(fastify, id))!;
}

export async function updateShExMapPairing(
  fastify: FastifyInstance,
  id: string,
  data: ShExMapPairingUpdate
): Promise<ShExMapPairing | null> {
  const iri = `${RP}${id}`;
  const now = new Date().toISOString();

  await sparqlUpdate(fastify, `
    DELETE {
      <${iri}> dct:title ?title .
      <${iri}> dct:description ?description .
      <${iri}> dcat:keyword ?tag .
      <${iri}> schema:version ?version .
      <${iri}> dct:modified ?modified .
      <${iri}> dct:license ?license .
      <${iri}> <${SM}sourceMap> ?srcMap .
      <${iri}> <${SM}targetMap> ?tgtMap .
      <${iri}> <${SM}sourceFocusIri> ?srcFocus .
      <${iri}> <${SM}targetFocusIri> ?tgtFocus .
    }
    WHERE {
      OPTIONAL { <${iri}> dct:title ?title }
      OPTIONAL { <${iri}> dct:description ?description }
      OPTIONAL { <${iri}> dcat:keyword ?tag }
      OPTIONAL { <${iri}> schema:version ?version }
      OPTIONAL { <${iri}> dct:modified ?modified }
      OPTIONAL { <${iri}> dct:license ?license }
      OPTIONAL { <${iri}> <${SM}sourceMap> ?srcMap }
      OPTIONAL { <${iri}> <${SM}targetMap> ?tgtMap }
      OPTIONAL { <${iri}> <${SM}sourceFocusIri> ?srcFocus }
      OPTIONAL { <${iri}> <${SM}targetFocusIri> ?tgtFocus }
    }
  `);

  const tagTriples = (data.tags ?? []).map((t) => `<${iri}> dcat:keyword "${escapeStr(t)}" .`).join('\n    ');
  const lines = [
    data.title !== undefined       ? `<${iri}> dct:title "${escapeStr(data.title)}" .` : '',
    data.description !== undefined ? `<${iri}> dct:description "${escapeStr(data.description)}" .` : '',
    data.version !== undefined     ? `<${iri}> schema:version "${data.version}" .` : '',
    data.license !== undefined     ? `<${iri}> dct:license <${data.license}> .` : '',
    data.sourceMapId !== undefined ? `<${iri}> <${SM}sourceMap> <${RM}${data.sourceMapId}> .` : '',
    data.targetMapId !== undefined ? `<${iri}> <${SM}targetMap> <${RM}${data.targetMapId}> .` : '',
    data.sourceFocusIri !== undefined ? `<${iri}> <${SM}sourceFocusIri> "${escapeStr(data.sourceFocusIri)}" .` : '',
    data.targetFocusIri !== undefined ? `<${iri}> <${SM}targetFocusIri> "${escapeStr(data.targetFocusIri)}" .` : '',
    `<${iri}> dct:modified "${now}"^^xsd:dateTime .`,
    tagTriples,
  ].filter(Boolean).join('\n    ');

  await sparqlUpdate(fastify, `INSERT DATA { ${lines} }`);
  return getShExMapPairing(fastify, id);
}

export async function deleteShExMapPairing(fastify: FastifyInstance, id: string): Promise<void> {
  await sparqlUpdate(fastify, `DELETE WHERE { <${RP}${id}> ?p ?o }`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function extractLocalId(iri: string): string {
  const parts = iri.split('/');
  return parts[parts.length - 1] ?? iri;
}

type SparqlRow = Record<string, { value: string } | undefined>;

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
