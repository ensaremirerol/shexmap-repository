import { sparqlSelect, sparqlUpdate, createSparqlClient } from '@shexmap/shared';
import type { Prefixes } from '@shexmap/shared';
import type { ShExMapPairingVersion } from '@shexmap/shared';

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
  pairingId: string,
): ShExMapPairingVersion {
  const vn    = parseInt(r['versionNumber']?.value ?? '0', 10);
  const srcVn = r['sourceVersionNumber']?.value;
  const tgtVn = r['targetVersionNumber']?.value;
  return {
    id: `${pairingId}-v${vn}`,
    pairingId,
    versionNumber: vn,
    commitMessage: r['commitMessage']?.value,
    sourceMapId: r['sourceMapId']?.value?.split('/').pop() ?? '',
    sourceVersionNumber: srcVn ? parseInt(srcVn, 10) : undefined,
    targetMapId: r['targetMapId']?.value?.split('/').pop() ?? '',
    targetVersionNumber: tgtVn ? parseInt(tgtVn, 10) : undefined,
    authorId: r['authorId']?.value?.split('/').pop() ?? '',
    authorName: r['authorName']?.value ?? 'Unknown',
    createdAt: r['createdAt']?.value ?? '',
  };
}

const saveLocks = new Map<string, Promise<unknown>>();

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = saveLocks.get(id) ?? Promise.resolve();
  const next = prev.then(fn);
  saveLocks.set(id, next.catch(() => {}));
  return next;
}

export async function listPairingVersions(
  client: SparqlClient,
  prefixes: Prefixes,
  pairingId: string,
): Promise<ShExMapPairingVersion[]> {
  assertSafeId(pairingId, 'pairingId');
  const SM         = prefixes.shexmap;
  const RP         = prefixes.shexrpair;
  const pairingIri = `${RP}${pairingId}`;

  const sparql = `
    SELECT ?versionNumber ?commitMessage ?authorId ?authorName ?createdAt
           ?sourceMapId ?sourceVersionNumber ?targetMapId ?targetVersionNumber
    WHERE {
      <${pairingIri}> <${SM}hasPairingVersion> ?v .
      ?v <${SM}versionNumber> ?versionNumber ;
         <http://purl.org/dc/terms/creator> ?authorId ;
         <http://purl.org/dc/terms/created> ?createdAt .
      OPTIONAL { ?v <${SM}commitMessage> ?commitMessage }
      OPTIONAL { ?v <${SM}sourceMap> ?sourceMapId }
      OPTIONAL { ?v <${SM}targetMap> ?targetMapId }
      OPTIONAL { ?v <${SM}sourceMapVersion> ?srcVer . ?srcVer <${SM}versionNumber> ?sourceVersionNumber }
      OPTIONAL { ?v <${SM}targetMapVersion> ?tgtVer . ?tgtVer <${SM}versionNumber> ?targetVersionNumber }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
    }
    ORDER BY ASC(?versionNumber)
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);
  return rows.map((r) => rowToVersion(r, pairingId));
}

export async function getPairingVersion(
  client: SparqlClient,
  prefixes: Prefixes,
  pairingId: string,
  versionNumber: number,
): Promise<ShExMapPairingVersion | null> {
  assertSafeId(pairingId, 'pairingId');
  const SM         = prefixes.shexmap;
  const RV         = prefixes.shexrversion;
  const versionIri = `${RV}${pairingId}-v${versionNumber}`;

  const sparql = `
    SELECT ?versionNumber ?commitMessage ?authorId ?authorName ?createdAt
           ?sourceMapId ?sourceVersionNumber ?targetMapId ?targetVersionNumber
    WHERE {
      <${versionIri}> <${SM}versionNumber> ?versionNumber ;
                      <http://purl.org/dc/terms/creator> ?authorId ;
                      <http://purl.org/dc/terms/created> ?createdAt .
      OPTIONAL { <${versionIri}> <${SM}commitMessage> ?commitMessage }
      OPTIONAL { <${versionIri}> <${SM}sourceMap> ?sourceMapId }
      OPTIONAL { <${versionIri}> <${SM}targetMap> ?targetMapId }
      OPTIONAL { <${versionIri}> <${SM}sourceMapVersion> ?srcVer . ?srcVer <${SM}versionNumber> ?sourceVersionNumber }
      OPTIONAL { <${versionIri}> <${SM}targetMapVersion> ?tgtVer . ?tgtVer <${SM}versionNumber> ?targetVersionNumber }
      OPTIONAL { ?authorId <https://schema.org/name> ?authorName }
    }
  `;

  const rows = await sparqlSelect(client, prefixes, sparql);
  if (!rows.length) return null;
  return rowToVersion(rows[0]!, pairingId);
}

export interface SavePairingVersionOpts {
  commitMessage?: string;
  sourceMapId: string;
  sourceVersionNumber?: number;
  targetMapId: string;
  targetVersionNumber?: number;
}

export async function savePairingVersion(
  client: SparqlClient,
  prefixes: Prefixes,
  pairingId: string,
  authorId: string,
  opts: SavePairingVersionOpts,
): Promise<ShExMapPairingVersion> {
  assertSafeId(pairingId, 'pairingId');

  return withLock(pairingId, async () => {
    const SM         = prefixes.shexmap;
    const RP         = prefixes.shexrpair;
    const RM         = prefixes.shexrmap;
    const RU         = prefixes.shexruser;
    const RV         = prefixes.shexrversion;
    const pairingIri = `${RP}${pairingId}`;
    const authorIri  = `${RU}${authorId}`;
    const now        = new Date().toISOString();

    const maxSparql = `
      SELECT (MAX(?n) AS ?maxN)
      WHERE {
        <${pairingIri}> <${SM}hasPairingVersion> ?v .
        ?v <${SM}versionNumber> ?n .
      }
    `;
    const rows  = await sparqlSelect(client, prefixes, maxSparql);
    const maxN  = parseInt(rows[0]?.['maxN']?.value ?? '0', 10);
    const nextN = isNaN(maxN) ? 1 : maxN + 1;

    const versionId  = `${pairingId}-v${nextN}`;
    const versionIri = `${RV}${versionId}`;

    const srcMapIri = `${RM}${opts.sourceMapId}`;
    const tgtMapIri = `${RM}${opts.targetMapId}`;
    const srcVerIri = opts.sourceVersionNumber !== undefined
      ? `${RV}${opts.sourceMapId}-v${opts.sourceVersionNumber}` : null;
    const tgtVerIri = opts.targetVersionNumber !== undefined
      ? `${RV}${opts.targetMapId}-v${opts.targetVersionNumber}` : null;

    const insert = `
      INSERT DATA {
        <${versionIri}> a <${SM}ShExMapPairingVersion> ;
          <${SM}versionNumber> ${nextN} ;
          <${SM}sourceMap> <${srcMapIri}> ;
          <${SM}targetMap> <${tgtMapIri}> ;
          <http://purl.org/dc/terms/creator> <${authorIri}> ;
          <http://purl.org/dc/terms/created> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
        ${opts.commitMessage ? `<${versionIri}> <${SM}commitMessage> "${escapeStr(opts.commitMessage)}" .` : ''}
        ${srcVerIri ? `<${versionIri}> <${SM}sourceMapVersion> <${srcVerIri}> .` : ''}
        ${tgtVerIri ? `<${versionIri}> <${SM}targetMapVersion> <${tgtVerIri}> .` : ''}
        <${pairingIri}> <${SM}hasPairingVersion> <${versionIri}> .
      }
    `;
    await sparqlUpdate(client, prefixes, insert);

    const updateParent = `
      DELETE { <${pairingIri}> <${SM}currentPairingVersion> ?old ; <http://purl.org/dc/terms/modified> ?m }
      INSERT { <${pairingIri}> <${SM}currentPairingVersion> <${versionIri}> ; <http://purl.org/dc/terms/modified> "${now}"^^<http://www.w3.org/2001/XMLSchema#dateTime> }
      WHERE  { OPTIONAL { <${pairingIri}> <${SM}currentPairingVersion> ?old ; <http://purl.org/dc/terms/modified> ?m } }
    `;
    await sparqlUpdate(client, prefixes, updateParent);

    return {
      id: versionId,
      pairingId,
      versionNumber: nextN,
      commitMessage: opts.commitMessage,
      sourceMapId: opts.sourceMapId,
      sourceVersionNumber: opts.sourceVersionNumber,
      targetMapId: opts.targetMapId,
      targetVersionNumber: opts.targetVersionNumber,
      authorId,
      authorName: '',
      createdAt: now,
    };
  });
}
