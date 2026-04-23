import { sparqlSelect, sparqlUpdate, createSparqlClient } from '@shexmap/shared';
import type { Prefixes } from '@shexmap/shared';
import type { ShExMapVersion } from '@shexmap/shared';
import { extractMapVariables } from './shexmap.service.js';

type SparqlClient = ReturnType<typeof createSparqlClient>;

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function assertSafeId(id: string, label: string) {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid ${label}: ${id}`);
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function rowToVersion(
  r: Record<string, { value: string } | undefined>,
  mapId: string,
): ShExMapVersion {
  const vn = parseInt(r['versionNumber']?.value ?? '0', 10);
  return {
    id: `${mapId}-v${vn}`,
    mapId,
    versionNumber: vn,
    commitMessage: r['commitMessage']?.value,
    authorId: r['authorId']?.value?.split('/').pop() ?? '',
    authorName: r['authorName']?.value ?? 'Unknown',
    createdAt: r['createdAt']?.value ?? '',
  };
}

const saveLocks = new Map<string, Promise<unknown>>();

function withLock<T>(mapId: string, fn: () => Promise<T>): Promise<T> {
  const prev = saveLocks.get(mapId) ?? Promise.resolve();
  const next = prev.then(fn);
  saveLocks.set(mapId, next.catch(() => {}));
  return next;
}

export async function listVersions(
  client: SparqlClient,
  prefixes: Prefixes,
  mapId: string,
): Promise<ShExMapVersion[]> {
  assertSafeId(mapId, 'mapId');
  const SM     = prefixes.shexmap;
  const RM     = prefixes.shexrmap;
  const mapIri = `${RM}${mapId}`;

  const sparql = `
    SELECT ?versionNumber ?commitMessage ?authorId ?authorName ?createdAt
    WHERE {
      <${mapIri}> <${SM}hasVersion> ?v .
      ?v <${SM}versionNumber> ?versionNumber ;
         <http://purl.org/dc/terms/creator> ?authorId ;
         <http://purl.org/dc/terms/created> ?createdAt .
      OPTIONAL { ?v <${SM}commitMessage> ?commitMessage }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
    }
    ORDER BY ASC(?versionNumber)
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);
  return rows.map((r) => rowToVersion(r, mapId));
}

export async function getVersion(
  client: SparqlClient,
  prefixes: Prefixes,
  mapId: string,
  versionNumber: number,
): Promise<ShExMapVersion | null> {
  assertSafeId(mapId, 'mapId');
  const SM         = prefixes.shexmap;
  const RV         = prefixes.shexrversion;
  const versionIri = `${RV}${mapId}-v${versionNumber}`;

  const sparql = `
    SELECT ?versionNumber ?commitMessage ?authorId ?authorName ?createdAt
    WHERE {
      <${versionIri}> <${SM}versionNumber> ?versionNumber ;
                      <http://purl.org/dc/terms/creator> ?authorId ;
                      <http://purl.org/dc/terms/created> ?createdAt .
      OPTIONAL { <${versionIri}> <${SM}commitMessage> ?commitMessage }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
    }
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);
  if (!rows.length) return null;
  return rowToVersion(rows[0]!, mapId);
}

export async function getVersionContent(
  client: SparqlClient,
  prefixes: Prefixes,
  mapId: string,
  versionNumber: number,
): Promise<string> {
  assertSafeId(mapId, 'mapId');
  const SM         = prefixes.shexmap;
  const RV         = prefixes.shexrversion;
  const versionIri = `${RV}${mapId}-v${versionNumber}`;

  const sparql = `
    SELECT ?content
    WHERE {
      <${versionIri}> <${SM}versionContent> ?content .
    }
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);
  if (!rows.length || !rows[0]?.['content']?.value) {
    throw new Error(`Content not found for version ${versionNumber} of map ${mapId}`);
  }
  return rows[0]['content'].value;
}

export async function saveNewVersion(
  client: SparqlClient,
  prefixes: Prefixes,
  mapId: string,
  authorId: string,
  content: string,
  commitMessage?: string,
): Promise<ShExMapVersion> {
  assertSafeId(mapId, 'mapId');

  return withLock(mapId, async () => {
    const SM        = prefixes.shexmap;
    const RM        = prefixes.shexrmap;
    const RU        = prefixes.shexruser;
    const RV        = prefixes.shexrversion;
    const mapIri    = `${RM}${mapId}`;
    const authorIri = `${RU}${authorId}`;
    const now       = new Date().toISOString();

    const maxSparql = `
      SELECT (MAX(?n) AS ?maxN)
      WHERE {
        <${mapIri}> <${SM}hasVersion> ?v .
        ?v <${SM}versionNumber> ?n .
      }
    `;
    const rows = await sparqlSelect(client, prefixes, maxSparql);
    const maxN = parseInt(rows[0]?.['maxN']?.value ?? '0', 10);
    const nextN = isNaN(maxN) ? 1 : maxN + 1;

    const versionId  = `${mapId}-v${nextN}`;
    const versionIri = `${RV}${versionId}`;

    const insertVersion = `
      INSERT DATA {
        <${versionIri}> a <${SM}ShExMapVersion> ;
          <${SM}versionNumber> ${nextN} ;
          <${SM}versionContent> """${content}""" ;
          <http://purl.org/dc/terms/creator> <${authorIri}> ;
          <http://purl.org/dc/terms/created> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
        ${commitMessage ? `<${versionIri}> <${SM}commitMessage> "${escapeStr(commitMessage)}" .` : ''}
        <${mapIri}> <${SM}hasVersion> <${versionIri}> .
      }
    `;
    await sparqlUpdate(client, prefixes, insertVersion);

    const updateParent = `
      DELETE { <${mapIri}> <${SM}currentVersion> ?old ; <http://purl.org/dc/terms/modified> ?m }
      INSERT { <${mapIri}> <${SM}currentVersion> <${versionIri}> ; <http://purl.org/dc/terms/modified> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> }
      WHERE  { OPTIONAL { <${mapIri}> <${SM}currentVersion> ?old ; <http://purl.org/dc/terms/modified> ?m } }
    `;
    await sparqlUpdate(client, prefixes, updateParent);

    const vars   = extractMapVariables(content);
    const hasMap = vars.length > 0;
    await sparqlUpdate(client, prefixes, `
      DELETE { <${mapIri}> <${SM}hasMapAnnotations> ?hma . <${mapIri}> <${SM}mapVariable> ?mv }
      WHERE  { OPTIONAL { <${mapIri}> <${SM}hasMapAnnotations> ?hma }
               OPTIONAL { <${mapIri}> <${SM}mapVariable> ?mv } }
    `);
    const varTriples = vars.map((v) => `<${mapIri}> <${SM}mapVariable> "${escapeStr(v)}" .`).join('\n        ');
    await sparqlUpdate(client, prefixes, `
      INSERT DATA {
        <${mapIri}> <${SM}hasMapAnnotations> ${hasMap} .
        ${varTriples}
      }
    `);

    return {
      id: versionId,
      mapId,
      versionNumber: nextN,
      commitMessage,
      authorId,
      authorName: '',
      createdAt: now,
    };
  });
}
