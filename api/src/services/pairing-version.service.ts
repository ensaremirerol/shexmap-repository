import type { FastifyInstance } from 'fastify';
import type { ShExMapPairingVersion } from '../models/shexmap.model.js';
import { sparqlSelect, sparqlUpdate } from './sparql.service.js';
import { PREFIXES } from '../rdf/prefixes.js';

const RP  = PREFIXES.shexrpair;
const RV  = PREFIXES.shexrversion;
const RU  = PREFIXES.shexruser;
const SM  = PREFIXES.shexmap;

// ─── Per-pairing lock ─────────────────────────────────────────────────────────

const saveLocks = new Map<string, Promise<unknown>>();

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = saveLocks.get(id) ?? Promise.resolve();
  const next = prev.then(fn);
  saveLocks.set(id, next.catch(() => {}));
  return next;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const vn = parseInt(r['versionNumber']?.value ?? '0', 10);
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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listPairingVersions(
  fastify: FastifyInstance,
  pairingId: string,
): Promise<ShExMapPairingVersion[]> {
  assertSafeId(pairingId, 'pairingId');
  const pairingIri = `${RP}${pairingId}`;

  const sparql = `
    SELECT ?versionNumber ?commitMessage ?authorId ?authorName ?createdAt
           ?sourceMapId ?sourceVersionNumber ?targetMapId ?targetVersionNumber
    WHERE {
      <${pairingIri}> <${SM}hasPairingVersion> ?v .
      ?v <${SM}versionNumber> ?versionNumber ;
         dct:creator ?authorId ;
         dct:created ?createdAt .
      OPTIONAL { ?v <${SM}commitMessage> ?commitMessage }
      OPTIONAL { ?v <${SM}sourceMap> ?sourceMapId }
      OPTIONAL { ?v <${SM}targetMap> ?targetMapId }
      OPTIONAL { ?v <${SM}sourceMapVersion> ?srcVer . ?srcVer <${SM}versionNumber> ?sourceVersionNumber }
      OPTIONAL { ?v <${SM}targetMapVersion> ?tgtVer . ?tgtVer <${SM}versionNumber> ?targetVersionNumber }
      OPTIONAL { ?authorId schema:name ?authorName }
    }
    ORDER BY ASC(?versionNumber)
  `;

  const rows = await sparqlSelect(fastify, sparql);
  return rows.map((r) => rowToVersion(r, pairingId));
}

export async function getPairingVersion(
  fastify: FastifyInstance,
  pairingId: string,
  versionNumber: number,
): Promise<ShExMapPairingVersion | null> {
  assertSafeId(pairingId, 'pairingId');
  const versionIri = `${RV}${pairingId}-v${versionNumber}`;

  const sparql = `
    SELECT ?versionNumber ?commitMessage ?authorId ?authorName ?createdAt
           ?sourceMapId ?sourceVersionNumber ?targetMapId ?targetVersionNumber
    WHERE {
      <${versionIri}> <${SM}versionNumber> ?versionNumber ;
                      dct:creator ?authorId ;
                      dct:created ?createdAt .
      OPTIONAL { <${versionIri}> <${SM}commitMessage> ?commitMessage }
      OPTIONAL { <${versionIri}> <${SM}sourceMap> ?sourceMapId }
      OPTIONAL { <${versionIri}> <${SM}targetMap> ?targetMapId }
      OPTIONAL { <${versionIri}> <${SM}sourceMapVersion> ?srcVer . ?srcVer <${SM}versionNumber> ?sourceVersionNumber }
      OPTIONAL { <${versionIri}> <${SM}targetMapVersion> ?tgtVer . ?tgtVer <${SM}versionNumber> ?targetVersionNumber }
      OPTIONAL { ?authorId schema:name ?authorName }
    }
  `;

  const rows = await sparqlSelect(fastify, sparql);
  if (!rows.length) return null;
  return rowToVersion(rows[0]!, pairingId);
}

export async function savePairingVersion(
  fastify: FastifyInstance,
  pairingId: string,
  authorId: string,
  opts: {
    commitMessage?: string;
    sourceMapId: string;
    sourceVersionNumber?: number;
    targetMapId: string;
    targetVersionNumber?: number;
  },
): Promise<ShExMapPairingVersion> {
  assertSafeId(pairingId, 'pairingId');

  return withLock(pairingId, async () => {
    const pairingIri = `${RP}${pairingId}`;
    const authorIri  = `${RU}${authorId}`;
    const now        = new Date().toISOString();

    // Determine next version number
    const maxSparql = `
      SELECT (MAX(?n) AS ?maxN)
      WHERE {
        <${pairingIri}> <${SM}hasPairingVersion> ?v .
        ?v <${SM}versionNumber> ?n .
      }
    `;
    const rows = await sparqlSelect(fastify, maxSparql);
    const maxN = parseInt(rows[0]?.['maxN']?.value ?? '0', 10);
    const nextN = isNaN(maxN) ? 1 : maxN + 1;

    const versionId  = `${pairingId}-v${nextN}`;
    const versionIri = `${RV}${versionId}`;

    const srcMapIri = `${PREFIXES.shexrmap}${opts.sourceMapId}`;
    const tgtMapIri = `${PREFIXES.shexrmap}${opts.targetMapId}`;
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
          dct:creator <${authorIri}> ;
          dct:created "${now}"^^xsd:dateTime .
        ${opts.commitMessage ? `<${versionIri}> <${SM}commitMessage> "${escapeStr(opts.commitMessage)}" .` : ''}
        ${srcVerIri ? `<${versionIri}> <${SM}sourceMapVersion> <${srcVerIri}> .` : ''}
        ${tgtVerIri ? `<${versionIri}> <${SM}targetMapVersion> <${tgtVerIri}> .` : ''}
        <${pairingIri}> <${SM}hasPairingVersion> <${versionIri}> .
      }
    `;
    await sparqlUpdate(fastify, insert);

    // Update currentPairingVersion and dct:modified on the parent
    const updateParent = `
      DELETE { <${pairingIri}> <${SM}currentPairingVersion> ?old ; dct:modified ?m }
      INSERT { <${pairingIri}> <${SM}currentPairingVersion> <${versionIri}> ; dct:modified "${now}"^^xsd:dateTime }
      WHERE  { OPTIONAL { <${pairingIri}> <${SM}currentPairingVersion> ?old ; dct:modified ?m } }
    `;
    await sparqlUpdate(fastify, updateParent);

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
