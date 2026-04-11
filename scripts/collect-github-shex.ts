#!/usr/bin/env node
/**
 * collect-github-shex.ts
 *
 * Harvest .shex files from public GitHub repositories that contain ShExMap
 * Map annotations (%Map:{...}) and import them into this repository via the
 * REST API.
 *
 * Usage:
 *   npx tsx scripts/collect-github-shex.ts [options]
 *
 * Options:
 *   --api-url URL         REST API base URL (default: http://localhost/api/v1)
 *   --api-key KEY         X-API-Key header (required when AUTH_ENABLED=true)
 *   --token TOKEN         GitHub PAT — raises rate limit to 5 000 req/hr
 *                         (also read from GITHUB_TOKEN env var)
 *   --query Q             GitHub code search query (default: "extension:shex")
 *   --delay MS            Delay between REST API import calls in ms (default: 200)
 *   --github-delay MS     Delay between GitHub API calls in ms (default: 1000)
 *   --limit N             Stop after N imports (0 = all; default: 0)
 *   --dry-run             Preview what would be imported; make no changes
 *   --state-file PATH     JSON file tracking imported SHAs for fast incremental
 *                         runs (default: .harvest-state.json in repo root)
 *   --force               Re-check all files; ignore the state file
 *   --fetch-topics        Fetch repo topics via an extra API call per unique repo
 *                         (adds tags from GitHub topics; costs 1 req/repo)
 *   --sparql-url URL      QLever SPARQL endpoint — used to skip files whose
 *                         dct:source IRI is already in the triplestore
 *                         (also read from QLEVER_SPARQL_URL env var)
 *   --output-dir DIR      Directory to save gzip-compressed .shex files.
 *                         Files are stored as {DIR}/{owner}/{repo}/{path}.gz
 *                         Default: sparql/files/github (relative to repo root).
 *                         Pass an empty string ("") to disable file saving.
 *
 * Deduplication strategy (applied in order):
 *   1. State file: if the blob SHA for this file is unchanged → skip
 *   2. SPARQL ASK (when --sparql-url provided): query dct:source → skip if found
 *   3. API POST: a 409 response means the API rejected a duplicate
 *
 * Incremental updates:
 *   When the blob SHA has changed since the last run the new content is imported
 *   as a new version via POST /shexmaps/:id/versions.
 *
 * Rate limiting:
 *   The script checks X-RateLimit-Remaining after every GitHub API call and
 *   sleeps until X-RateLimit-Reset when fewer than 5 requests remain.
 *   GitHub's secondary rate limit for the code-search endpoint is
 *   ~10 req/min unauthenticated / ~30 req/min authenticated.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ─── Load .env from repo root (if present) ───────────────────────────────────
const dotenvPath = resolve(REPO_ROOT, '.env');
if (existsSync(dotenvPath)) {
  for (const line of readFileSync(dotenvPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ─── Argument parsing ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}

function opt(name: string, envVar?: string, defaultValue?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1];
  if (envVar && process.env[envVar]) return process.env[envVar];
  return defaultValue;
}

const API_URL      = opt('api-url',       'API_URL',             'http://localhost/api/v1')!;
const API_KEY      = opt('api-key',       'HARVESTER_API_KEY');
const GH_TOKEN     = opt('token',         'GITHUB_TOKEN');
const GH_QUERY     = opt('query',         undefined,             'extension:shex')!;
const DELAY_MS     = parseInt(opt('delay',         'HARVEST_DELAY_MS',    '200')!, 10);
const GH_DELAY_MS  = parseInt(opt('github-delay',  undefined,             '1000')!, 10);
const LIMIT        = parseInt(opt('limit',         undefined,             '0')!, 10);
const DRY_RUN      = flag('dry-run');
const FORCE        = flag('force');
const FROM_DISK    = flag('from-disk');
const FETCH_TOPICS = flag('fetch-topics');
const SPARQL_URL   = opt('sparql-url',    'QLEVER_SPARQL_URL');
const STATE_FILE       = resolve(opt('state-file', undefined, resolve(REPO_ROOT, '.harvest-state.json'))!);
// Empty string disables file saving; undefined uses the default path
const OUTPUT_DIR_RAW   = opt('output-dir',     undefined, join(REPO_ROOT, 'sparql', 'files', 'github'));
const OUTPUT_DIR       = OUTPUT_DIR_RAW   === '' ? null : resolve(OUTPUT_DIR_RAW!);
const MAP_OUTPUT_DIR_RAW = opt('map-output-dir', undefined, join(REPO_ROOT, 'sparql', 'files', 'github-maps'));
const MAP_OUTPUT_DIR   = MAP_OUTPUT_DIR_RAW === '' ? null : resolve(MAP_OUTPUT_DIR_RAW!);

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileState {
  sha: string;
  mapId?: string;
  importedAt: string;
  sourceUrl: string;
}

interface HarvestState {
  version: 1;
  harvested: Record<string, FileState>; // key: "owner/repo:path/to/file.shex"
}

interface GitHubSearchItem {
  name: string;
  path: string;
  sha: string;
  git_url: string;
  html_url: string;
  repository: {
    full_name: string;
    description: string | null;
    default_branch: string;
    topics?: string[];
    owner: { login: string };
  };
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchItem[];
}

interface GitHubRepo {
  topics: string[];
  description: string | null;
}

interface ImportPayload {
  title: string;
  description?: string;
  content: string;
  fileName: string;
  fileFormat: 'shexc' | 'shexj';
  sourceUrl: string;
  tags: string[];
  version: string;
}

interface CreateResponse {
  id: string;
}

// ─── State management ─────────────────────────────────────────────────────────

function loadState(): HarvestState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as HarvestState;
    } catch {
      console.warn(`[warn] Could not parse state file ${STATE_FILE} — starting fresh`);
    }
  }
  return { version: 1, harvested: {} };
}

function saveState(state: HarvestState): void {
  if (DRY_RUN) return;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

const GH_HEADERS: Record<string, string> = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'shexmap-harvester/1.0 (https://github.com/micheldumontier/shexmap-repository)',
  'X-GitHub-Api-Version': '2022-11-28',
};
if (GH_TOKEN) GH_HEADERS['Authorization'] = `Bearer ${GH_TOKEN}`;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleRateLimit(headers: Headers): Promise<void> {
  const remaining = parseInt(headers.get('X-RateLimit-Remaining') ?? '999', 10);
  if (remaining < 5) {
    const reset = parseInt(headers.get('X-RateLimit-Reset') ?? '0', 10);
    const waitMs = Math.max(0, reset * 1000 - Date.now()) + 2000;
    console.log(`[rate-limit] ${remaining} requests remaining — sleeping ${Math.ceil(waitMs / 1000)}s until reset`);
    await sleep(waitMs);
  }
}

async function ghFetch(url: string, rawContent = false): Promise<{ data: unknown; headers: Headers }> {
  const headers = { ...GH_HEADERS };
  if (rawContent) headers['Accept'] = 'application/vnd.github.v3.raw';

  const res = await fetch(url, { headers });
  await handleRateLimit(res.headers);

  if (res.status === 429 || (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0')) {
    const reset = parseInt(res.headers.get('X-RateLimit-Reset') ?? '0', 10);
    const waitMs = Math.max(0, reset * 1000 - Date.now()) + 2000;
    console.log(`[rate-limit] Rate limited — retrying after ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
    return ghFetch(url, rawContent);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} at ${url}: ${body.slice(0, 300)}`);
  }

  const data = rawContent ? await res.text() : await res.json();
  return { data, headers: res.headers };
}

// ─── GitHub Code Search ───────────────────────────────────────────────────────

/**
 * Paginate through GitHub code search results.
 * GitHub caps code search at 1 000 results (10 pages × 100).
 */
async function* searchCodePages(query: string): AsyncGenerator<GitHubSearchItem[]> {
  let page = 1;
  const maxPages = 10; // GitHub hard limit for code search

  while (page <= maxPages) {
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
    console.log(`[search] Fetching page ${page} — query: "${query}"`);

    const { data } = await ghFetch(url);
    const result = data as GitHubSearchResponse;
    const items = result.items ?? [];

    if (items.length === 0) break;

    console.log(`[search] page ${page}: ${items.length} results (total_count=${result.total_count})`);
    yield items;

    if (items.length < 100) break; // last page
    page++;
    await sleep(GH_DELAY_MS);
  }
}

// ─── Repo info cache (for --fetch-topics) ────────────────────────────────────

const repoInfoCache = new Map<string, GitHubRepo>();

async function getRepoInfo(fullName: string): Promise<GitHubRepo> {
  if (repoInfoCache.has(fullName)) return repoInfoCache.get(fullName)!;
  const { data } = await ghFetch(`https://api.github.com/repos/${fullName}`);
  const repo = data as GitHubRepo;
  repoInfoCache.set(fullName, repo);
  await sleep(GH_DELAY_MS);
  return repo;
}

// ─── Raw file content ─────────────────────────────────────────────────────────

async function fetchRawContent(gitUrl: string): Promise<string> {
  const { data } = await ghFetch(gitUrl, /* rawContent= */ true);
  return data as string;
}

/**
 * Derive a stable raw-content URL from the html_url returned by code search.
 *
 * html_url:  https://github.com/owner/repo/blob/main/path/to/file.shex
 * raw_url:   https://raw.githubusercontent.com/owner/repo/main/path/to/file.shex
 */
function rawUrlFromHtmlUrl(htmlUrl: string): string {
  return htmlUrl
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace('/blob/', '/');
}

// ─── ShExMap detection ────────────────────────────────────────────────────────

/** Matches %Map:{ variable %} or %Map:{ regex(/.../) %} annotations */
const MAP_ANNOTATION_RE = /%Map:\s*\{[^}]+\}/;

function hasMapAnnotations(content: string): boolean {
  return MAP_ANNOTATION_RE.test(content);
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

function extractTitle(content: string, fileName: string): string {
  // First non-empty single-line comment
  const m = content.match(/^#\s*(.+)/m);
  if (m) {
    const t = m[1].trim();
    if (t.length > 0 && t.length <= 200) return t;
  }
  // Fall back to filename stem
  return fileName.replace(/\.shex$/i, '');
}

function extractDescription(content: string): string | undefined {
  // Block comment /* ... */
  const block = content.match(/\/\*\s*([\s\S]*?)\s*\*\//);
  if (block) {
    return block[1].replace(/\s+/g, ' ').trim().slice(0, 2000) || undefined;
  }

  // First consecutive run of # comment lines (skip blank lines between them)
  const lines = content.split('\n');
  const commentLines: string[] = [];
  for (const line of lines.slice(0, 30)) {
    const stripped = line.replace(/^#+\s*/, '').trim();
    if (line.startsWith('#') && stripped) {
      commentLines.push(stripped);
    } else if (commentLines.length > 0 && stripped) {
      break; // non-comment, non-blank line after comments → stop
    }
  }
  const desc = commentLines.join(' ').trim();
  return desc.length > 0 ? desc.slice(0, 2000) : undefined;
}

// ─── File storage ─────────────────────────────────────────────────────────────

/**
 * Save a .shex file to:
 *   {dir}/{owner}/{repo}/{path/to/file.shex}
 *
 * Mirrors the GitHub repo tree so provenance is preserved on disk.
 * Returns the absolute path written, or null if dir is null (disabled).
 */
function saveFile(dir: string | null, fullName: string, filePath: string, content: string): string | null {
  if (!dir) return null;
  const destPath = join(dir, fullName, filePath);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, content, 'utf-8');
  return destPath;
}

// ─── SPARQL-based dedup ───────────────────────────────────────────────────────

async function isSourceUrlInTriplestore(sourceUrl: string): Promise<boolean> {
  if (!SPARQL_URL) return false;
  const query = `ASK { ?s <http://purl.org/dc/terms/source> <${sourceUrl}> }`;
  const body = new URLSearchParams({ query }).toString();
  const res = await fetch(SPARQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
    },
    body,
  });
  if (!res.ok) {
    console.warn(`[warn] SPARQL ASK failed (${res.status}) — skipping SPARQL dedup for this file`);
    return false;
  }
  const data = await res.json() as { boolean: boolean };
  return data.boolean;
}

// ─── REST API helpers ─────────────────────────────────────────────────────────

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['X-API-Key'] = API_KEY;
  return h;
}

async function importShExMap(payload: ImportPayload): Promise<CreateResponse | null> {
  const url = `${API_URL.replace(/\/$/, '')}/shexmaps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(payload),
  });

  if (res.status === 201) return res.json() as Promise<CreateResponse>;
  if (res.status === 409) return null; // duplicate — treat as already existing

  const body = await res.text();
  throw new Error(`API ${res.status} on POST /shexmaps: ${body.slice(0, 300)}`);
}

async function saveNewVersion(mapId: string, content: string, commitMessage: string): Promise<void> {
  const url = `${API_URL.replace(/\/$/, '')}/shexmaps/${mapId}/versions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ content, commitMessage }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} on POST /shexmaps/${mapId}/versions: ${body.slice(0, 300)}`);
  }
}

// ─── Directory walker ─────────────────────────────────────────────────────────

function* walkDir(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkDir(full);
    else yield full;
  }
}

// ─── Shared import logic ──────────────────────────────────────────────────────

async function importMapFile(
  stateKey: string,
  fileName: string,
  content: string,
  sourceUrl: string,
  existingMapId: string | undefined,
  state: HarvestState,
  counters: { imported: number; updated: number; skipped: number; failed: number },
): Promise<void> {
  const title = extractTitle(content, fileName);
  const description = extractDescription(content);
  const tags = ['github-harvested'];

  const payload: ImportPayload = {
    title, description, content,
    fileName,
    fileFormat: 'shexc',
    sourceUrl,
    tags,
    version: '1.0.0',
  };

  if (DRY_RUN) {
    const action = existingMapId ? 'would-update' : 'would-import';
    console.log(`  [${action}] ${stateKey}`);
    console.log(`    title  : ${title}`);
    console.log(`    source : ${sourceUrl}`);
    console.log(`    size   : ${content.length.toLocaleString()} chars`);
    counters.imported++;
    return;
  }

  try {
    await sleep(DELAY_MS);

    if (existingMapId) {
      await saveNewVersion(existingMapId, content, 'Harvested update from disk');
      console.log(`  [updated] ${stateKey}  id=${existingMapId}`);
      state.harvested[stateKey] = { ...state.harvested[stateKey], importedAt: new Date().toISOString() };
      counters.updated++;
    } else {
      const result = await importShExMap(payload);
      if (result) {
        console.log(`  [imported] ${stateKey}  id=${result.id}`);
        state.harvested[stateKey] = {
          sha: state.harvested[stateKey]?.sha ?? '',
          mapId: result.id,
          importedAt: new Date().toISOString(),
          sourceUrl,
        };
        counters.imported++;
      } else {
        console.log(`  [skip-dup] ${stateKey} — API returned 409`);
        counters.skipped++;
      }
    }
    saveState(state);
  } catch (err) {
    const cause = (err as NodeJS.ErrnoException & { cause?: unknown }).cause;
    const detail = cause instanceof Error ? cause.message : cause ? String(cause) : '';
    console.error(`  [error] import ${stateKey}: ${err}${detail ? ` (${detail})` : ''}`);
    counters.failed++;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function printSummary(counters: { imported: number; updated: number; skipped: number; savedOnly?: number; failed: number }): void {
  console.log('');
  console.log('─────────────────────────────────────────────');
  console.log(`  Imported (new)    : ${counters.imported}`);
  console.log(`  Updated (new ver) : ${counters.updated}`);
  console.log(`  Skipped (unchanged): ${counters.skipped}`);
  if (counters.savedOnly !== undefined) {
    console.log(`  Saved only (no %Map): ${counters.savedOnly}`);
  }
  console.log(`  Failed            : ${counters.failed}`);
  console.log('─────────────────────────────────────────────');
}

async function mainFromDisk(): Promise<void> {
  if (!MAP_OUTPUT_DIR || !existsSync(MAP_OUTPUT_DIR)) {
    console.error(`[fatal] Map output dir not found: ${MAP_OUTPUT_DIR}`);
    process.exit(1);
  }

  console.log(`[from-disk] Scanning ${MAP_OUTPUT_DIR}`);
  const state = FORCE ? { version: 1 as const, harvested: {} } : loadState();
  const counters = { imported: 0, updated: 0, skipped: 0, failed: 0 };

  for (const filePath of walkDir(MAP_OUTPUT_DIR)) {
    if (!filePath.endsWith('.shex')) continue;

    // Derive stateKey from path: MAP_OUTPUT_DIR/{owner}/{repo}/{...rest}
    const rel = filePath.slice(MAP_OUTPUT_DIR.length + 1); // owner/repo/path/to/file.shex
    const parts = rel.split('/');
    if (parts.length < 3) continue;
    const fullName = `${parts[0]}/${parts[1]}`;         // owner/repo
    const filePart = parts.slice(2).join('/');           // path/to/file.shex
    const stateKey = `${fullName}:${filePart}`;
    const fileName = parts[parts.length - 1];

    const existing = state.harvested[stateKey];
    if (!FORCE && existing?.mapId) {
      countSkippedInc(counters);
      continue;
    }

    const sourceUrl = existing?.sourceUrl
      ?? `https://raw.githubusercontent.com/${fullName}/HEAD/${filePart}`;

    const content = readFileSync(filePath, 'utf-8');

    if (LIMIT > 0 && counters.imported + counters.updated >= LIMIT) {
      console.log(`[limit] Reached import limit (${LIMIT}) — stopping`);
      break;
    }

    await importMapFile(stateKey, fileName, content, sourceUrl, existing?.mapId, state, counters);
  }

  printSummary(counters);
  saveState(state);
  if (counters.failed > 0) process.exit(1);
}

function countSkippedInc(c: { skipped: number }): void { c.skipped++; }

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  ShExMap GitHub Harvester                    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  API URL     : ${API_URL}`);
  console.log(`  State file  : ${STATE_FILE}`);
  console.log(`  Map dir     : ${MAP_OUTPUT_DIR ?? '(disabled)'}`);
  console.log(`  Dry run     : ${DRY_RUN}`);
  console.log(`  Force       : ${FORCE}`);

  if (FROM_DISK) {
    console.log('  Mode        : from-disk (skipping GitHub search)');
    console.log('');
    return mainFromDisk();
  }

  console.log(`  GH query    : "${GH_QUERY}"`);
  console.log(`  Output dir  : ${OUTPUT_DIR ?? '(disabled)'}`);
  console.log(`  SPARQL dedup: ${SPARQL_URL ?? '(disabled)'}`);
  console.log(`  Fetch topics: ${FETCH_TOPICS}`);
  console.log(`  Limit       : ${LIMIT || 'unlimited'}`);
  if (!GH_TOKEN) {
    console.warn('\n[warn] GITHUB_TOKEN not set — code search is limited to 10 req/min.\n');
  }
  console.log('');

  const state: HarvestState = FORCE ? { version: 1, harvested: {} } : loadState();

  const counters = { imported: 0, updated: 0, skipped: 0, savedOnly: 0, failed: 0 };

  outer: for await (const items of searchCodePages(GH_QUERY)) {
    for (const item of items) {
      if (LIMIT > 0 && counters.imported + counters.updated >= LIMIT) {
        console.log(`[limit] Reached import limit (${LIMIT}) — stopping`);
        break outer;
      }

      const stateKey = `${item.repository.full_name}:${item.path}`;
      const rawUrl = rawUrlFromHtmlUrl(item.html_url);
      const existing = state.harvested[stateKey];

      // ── 1. State-file dedup ─────────────────────────────────────────────
      if (!FORCE && existing) {
        if (existing.sha === item.sha) {
          counters.skipped++;
          continue;
        }
      }

      // ── 2. SPARQL dedup (for files not yet in local state) ──────────────
      if (!existing && SPARQL_URL) {
        let inStore: boolean;
        try {
          inStore = await isSourceUrlInTriplestore(rawUrl);
        } catch (err) {
          console.warn(`[warn] SPARQL dedup error for ${stateKey}: ${err}`);
          inStore = false;
        }
        if (inStore) {
          console.log(`  [skip-sparql] ${stateKey} — already in triplestore`);
          state.harvested[stateKey] = { sha: item.sha, importedAt: new Date().toISOString(), sourceUrl: rawUrl };
          counters.skipped++;
          continue;
        }
      }

      // ── 3. Download raw content ─────────────────────────────────────────
      let content: string;
      try {
        await sleep(GH_DELAY_MS);
        content = await fetchRawContent(item.git_url);
      } catch (err) {
        console.error(`  [error] download ${stateKey}: ${err}`);
        counters.failed++;
        continue;
      }

      const isMap = hasMapAnnotations(content);

      // ── 4. Save to disk ─────────────────────────────────────────────────
      if (!DRY_RUN) {
        try {
          saveFile(OUTPUT_DIR, item.repository.full_name, item.path, content);
          if (isMap) saveFile(MAP_OUTPUT_DIR, item.repository.full_name, item.path, content);
        } catch (err) {
          console.warn(`  [warn] Could not write file for ${stateKey}: ${err}`);
        }
      }

      // ── 5. Non-map files: record state and move on ──────────────────────
      if (!isMap) {
        if (DRY_RUN) {
          console.log(`  [would-save] ${stateKey}`);
          console.log(`    source : ${rawUrl}`);
          console.log(`    size   : ${content.length.toLocaleString()} chars`);
          if (OUTPUT_DIR) console.log(`    dir    : ${join(OUTPUT_DIR, item.repository.full_name, item.path)}`);
        } else {
          state.harvested[stateKey] = { sha: item.sha, importedAt: new Date().toISOString(), sourceUrl: rawUrl };
          saveState(state);
        }
        counters.savedOnly++;
        continue;
      }

      // ── 6. Import map file ──────────────────────────────────────────────
      let topics: string[] = item.repository.topics ?? [];
      if (FETCH_TOPICS && topics.length === 0) {
        try {
          const info = await getRepoInfo(item.repository.full_name);
          topics = info.topics ?? [];
        } catch { /* non-fatal */ }
      }
      const tags = [...new Set(['github-harvested', ...topics])].slice(0, 20);

      if (DRY_RUN) {
        const action = existing?.mapId ? 'would-update' : 'would-import';
        console.log(`  [${action}] ${stateKey}`);
        console.log(`    title      : ${extractTitle(content, item.name)}`);
        console.log(`    source     : ${rawUrl}`);
        console.log(`    tags       : ${tags.join(', ') || '(none)'}`);
        console.log(`    size       : ${content.length.toLocaleString()} chars`);
        if (MAP_OUTPUT_DIR) console.log(`    map-dir    : ${join(MAP_OUTPUT_DIR, item.repository.full_name, item.path)}`);
        counters.imported++;
        continue;
      }

      await importMapFile(stateKey, item.name, content, rawUrl, existing?.mapId, state, counters);
    }
  }

  printSummary(counters);
  saveState(state);
  if (counters.failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
