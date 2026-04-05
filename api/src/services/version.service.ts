import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ShExMapVersion, ShExMapVersionWithContent } from '../models/shexmap.model.js';
import { sparqlSelect, sparqlUpdate } from './sparql.service.js';
import { PREFIXES } from '../rdf/prefixes.js';

const RM  = PREFIXES.shexrmap;
const RU  = PREFIXES.shexruser;
const RV  = PREFIXES.shexrversion;
const SM  = PREFIXES.shexmap;

// ─── Per-map lock to serialize concurrent saves ───────────────────────────────

const saveLocks = new Map<string, Promise<unknown>>();

function withLock<T>(mapId: string, fn: () => Promise<T>): Promise<T> {
  const prev = saveLocks.get(mapId) ?? Promise.resolve();
  const next = prev.then(fn);
  saveLocks.set(mapId, next.catch(() => {}));
  return next;
}

// ─── Input validation ─────────────────────────────────────────────────────────

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function assertSafeId(id: string, label: string) {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid ${label}: ${id}`);
}

// ─── SPARQL helpers ───────────────────────────────────────────────────────────

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function rowToVersion(r: Record<string, { value: string } | undefined>, mapId: string): ShExMapVersion {
  const vn = parseInt(r['versionNumber']?.value ?? '0', 10);
  return {
    id: `${mapId}-v${vn}`,
    mapId,
    versionNumber: vn,
    filePath: r['filePath']?.value ?? `${mapId}/v${vn}.shex`,
    commitMessage: r['commitMessage']?.value,
    authorId: r['authorId']?.value?.split('/').pop() ?? '',
    authorName: r['authorName']?.value ?? 'Unknown',
    createdAt: r['createdAt']?.value ?? '',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listVersions(
  fastify: FastifyInstance,
  mapId: string,
): Promise<ShExMapVersion[]> {
  assertSafeId(mapId, 'mapId');
  const mapIri = `${RM}${mapId}`;

  const sparql = `
    SELECT ?versionNumber ?filePath ?commitMessage ?authorId ?authorName ?createdAt
    WHERE {
      <${mapIri}> <${SM}hasVersion> ?v .
      ?v <${SM}versionNumber> ?versionNumber ;
         dct:creator ?authorId ;
         dct:created ?createdAt .
      OPTIONAL { ?v <${SM}versionFile> ?filePath }
      OPTIONAL { ?v <${SM}commitMessage> ?commitMessage }
      OPTIONAL { ?authorId schema:name ?authorName }
    }
    ORDER BY ASC(?versionNumber)
  `;

  const rows = await sparqlSelect(fastify, sparql);
  return rows.map((r) => rowToVersion(r, mapId));
}

export async function getVersion(
  fastify: FastifyInstance,
  mapId: string,
  versionNumber: number,
): Promise<ShExMapVersion | null> {
  assertSafeId(mapId, 'mapId');
  const versionIri = `${RV}${mapId}-v${versionNumber}`;

  const sparql = `
    SELECT ?versionNumber ?filePath ?commitMessage ?authorId ?authorName ?createdAt
    WHERE {
      <${versionIri}> <${SM}versionNumber> ?versionNumber ;
                      dct:creator ?authorId ;
                      dct:created ?createdAt .
      OPTIONAL { <${versionIri}> <${SM}versionFile> ?filePath }
      OPTIONAL { <${versionIri}> <${SM}commitMessage> ?commitMessage }
      OPTIONAL { ?authorId schema:name ?authorName }
    }
  `;

  const rows = await sparqlSelect(fastify, sparql);
  if (!rows.length) return null;
  return rowToVersion(rows[0]!, mapId);
}

export async function getVersionContent(
  filesDir: string,
  mapId: string,
  versionNumber: number,
): Promise<string> {
  assertSafeId(mapId, 'mapId');
  // basename guards against any traversal in mapId even after assertSafeId
  const filePath = join(filesDir, basename(mapId), `v${versionNumber}.shex`);
  if (!existsSync(filePath)) throw new Error(`Version file not found: ${filePath}`);
  return readFileSync(filePath, 'utf8');
}

export async function saveNewVersion(
  fastify: FastifyInstance,
  filesDir: string,
  mapId: string,
  authorId: string,
  content: string,
  commitMessage?: string,
): Promise<ShExMapVersion> {
  assertSafeId(mapId, 'mapId');

  return withLock(mapId, async () => {
    const mapIri     = `${RM}${mapId}`;
    const authorIri  = `${RU}${authorId}`;
    const now        = new Date().toISOString();

    // 1. Determine next version number
    const maxSparql = `
      SELECT (MAX(?n) AS ?maxN)
      WHERE {
        <${mapIri}> <${SM}hasVersion> ?v .
        ?v <${SM}versionNumber> ?n .
      }
    `;
    const rows = await sparqlSelect(fastify, maxSparql);
    const maxN = parseInt(rows[0]?.['maxN']?.value ?? '0', 10);
    const nextN = isNaN(maxN) ? 1 : maxN + 1;

    const versionId  = `${mapId}-v${nextN}`;
    const versionIri = `${RV}${versionId}`;
    const relPath    = `${mapId}/v${nextN}.shex`;

    // 2. Write the file (do this before SPARQL so orphaned files are harmless)
    const dir = join(filesDir, mapId);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `v${nextN}.shex`);
    writeFileSync(filePath, content, 'utf8');

    // 3. INSERT version node
    const insertVersion = `
      INSERT DATA {
        <${versionIri}> a <${SM}ShExMapVersion> ;
          <${SM}versionNumber> ${nextN} ;
          <${SM}versionFile> "${escapeStr(relPath)}" ;
          dct:creator <${authorIri}> ;
          dct:created "${now}"^^xsd:dateTime .
        ${commitMessage ? `<${versionIri}> <${SM}commitMessage> "${escapeStr(commitMessage)}" .` : ''}
        <${mapIri}> <${SM}hasVersion> <${versionIri}> .
      }
    `;
    await sparqlUpdate(fastify, insertVersion);

    // 4. UPDATE currentVersion and dct:modified on the parent map
    const updateParent = `
      DELETE { <${mapIri}> <${SM}currentVersion> ?old ; dct:modified ?m }
      INSERT { <${mapIri}> <${SM}currentVersion> <${versionIri}> ; dct:modified "${now}"^^xsd:dateTime }
      WHERE  { OPTIONAL { <${mapIri}> <${SM}currentVersion> ?old ; dct:modified ?m } }
    `;
    await sparqlUpdate(fastify, updateParent);

    return {
      id: versionId,
      mapId,
      versionNumber: nextN,
      filePath: relPath,
      commitMessage,
      authorId,
      authorName: '',
      createdAt: now,
    };
  });
}
