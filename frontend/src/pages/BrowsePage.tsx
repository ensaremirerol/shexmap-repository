import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useShExMaps,
  useShExMapPairings,
  useSchemas,
  type ShExMapFilters,
  type PairingFilters,
  type ShExMapPairing,
} from '../api/shexmaps.js';

type Tab = 'schemas' | 'shexmaps' | 'pairings';

export default function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get('tab') as Tab | null;
  const highlightSchema = searchParams.get('schema') ?? undefined;
  const paramMaps = searchParams.get('maps');
  const initialHasMap = paramMaps === 'true' ? true : paramMaps === 'false' ? false : undefined;

  const [tab, setTab] = useState<Tab>(paramTab ?? 'pairings');
  const [mapFilters, setMapFilters] = useState<ShExMapFilters>({ page: 1, limit: 20, sort: 'modified', hasMapAnnotations: initialHasMap });
  const [pairingFilters, setPairingFilters] = useState<PairingFilters>({ page: 1, limit: 20, sort: 'modified' });

  // Sync tab → URL
  function switchTab(t: Tab) {
    setTab(t);
    setSearchParams((p) => { p.set('tab', t); p.delete('schema'); return p; });
  }

  const schemasQuery = useSchemas();
  const mapsQuery = useShExMaps(mapFilters);
  const pairingsQuery = useShExMapPairings(pairingFilters);

  // Build schemaUrl → pairings index for cross-referencing
  const schemaToPairings = useMemo(() => {
    const idx = new Map<string, ShExMapPairing[]>();
    for (const pairing of pairingsQuery.data?.items ?? []) {
      for (const schemaUrl of [pairing.sourceMap.schemaUrl, pairing.targetMap.schemaUrl]) {
        if (!schemaUrl) continue;
        const list = idx.get(schemaUrl) ?? [];
        if (!list.find((p) => p.id === pairing.id)) list.push(pairing);
        idx.set(schemaUrl, list);
      }
    }
    return idx;
  }, [pairingsQuery.data]);

  // Scroll to highlighted schema card
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (tab === 'schemas' && highlightSchema && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [tab, highlightSchema, schemasQuery.data]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'pairings', label: 'Pairings' },
    { id: 'shexmaps', label: 'ShExMaps' },
    // { id: 'schemas', label: 'Schemas' },
    
  ];

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Browse</h1>
        <p className="text-slate-500 mt-1">Explore ShEx schemas, individual ShExMap files, and bidirectional pairings.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.id
                ? 'bg-white border border-b-white border-slate-200 text-violet-700 -mb-px'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Schemas tab ── */}
      {tab === 'schemas' && (
        <div className="space-y-4">
          {schemasQuery.isLoading && (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading…</div>
          )}
          {schemasQuery.isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              Failed to load schemas.
            </div>
          )}
          {schemasQuery.data?.map((schema) => {
            const isHighlighted = schema.url === highlightSchema;
            const linkedPairings = schemaToPairings.get(schema.url) ?? [];
            return (
              <div
                key={schema.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={`bg-white rounded-xl border shadow-sm px-5 py-4 space-y-2 transition-colors ${
                  isHighlighted ? 'border-violet-400 ring-2 ring-violet-200' : 'border-slate-200'
                }`}
              >
                <div className="font-semibold text-slate-800">{schema.title}</div>
                {schema.description && (
                  <div className="text-sm text-slate-500">{schema.description}</div>
                )}
                {schema.sourceUrl && (
                  <a
                    href={schema.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-violet-600 hover:underline break-all"
                  >
                    {schema.sourceUrl}
                  </a>
                )}

                {/* Associated ShExMaps */}
                {schema.shexMapIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="text-xs text-slate-400 self-center">ShExMaps:</span>
                    {schema.shexMapIds.map((mapId) => (
                      <Link
                        key={mapId}
                        to={`/maps/${mapId}`}
                        className="bg-violet-50 text-violet-700 border border-violet-100 text-xs px-2 py-0.5 rounded-full font-medium hover:bg-violet-100 transition-colors"
                      >
                        {mapId}
                      </Link>
                    ))}
                  </div>
                )}

                {/* Associated Pairings */}
                {linkedPairings.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-slate-400 self-center">Pairings:</span>
                    {linkedPairings.map((pairing) => (
                      <Link
                        key={pairing.id}
                        to={`/pairings/create?id=${pairing.id}`}
                        className="bg-blue-50 text-blue-700 border border-blue-100 text-xs px-2 py-0.5 rounded-full font-medium hover:bg-blue-100 transition-colors"
                      >
                        {pairing.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {schemasQuery.data?.length === 0 && (
            <div className="text-center py-20 text-slate-400 text-sm">No schemas found.</div>
          )}
        </div>
      )}

      {/* ── ShExMap Files tab ── */}
      {tab === 'shexmaps' && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <input
              type="search"
              placeholder="Search by title, tag, or variable name…"
              className="flex-1 min-w-48 bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              onChange={(e) => setMapFilters((f) => ({ ...f, q: e.target.value, page: 1 }))}
            />
            <select
              className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              onChange={(e) => setMapFilters((f) => ({ ...f, sort: e.target.value as ShExMapFilters['sort'], page: 1 }))}
            >
              <option value="modified">Recently Updated</option>
              <option value="created">Newest</option>
              <option value="stars">Most Starred</option>
              <option value="title">Title A–Z</option>
            </select>
            {/* Map annotation filter */}
            <div className="flex rounded-lg border border-slate-300 overflow-hidden shadow-sm text-sm font-medium">
              {([
                { label: 'All',           value: undefined },
                { label: 'ShExMaps',      value: true },
                { label: 'ShEx Files',    value: false },
              ] as { label: string; value: boolean | undefined }[]).map(({ label, value }) => {
                const active = mapFilters.hasMapAnnotations === value;
                return (
                  <button
                    key={label}
                    onClick={() => setMapFilters((f) => ({ ...f, hasMapAnnotations: value, page: 1 }))}
                    className={`px-3 py-2 transition-colors ${
                      active
                        ? 'bg-violet-600 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {mapsQuery.isLoading && (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading…</div>
          )}
          {mapsQuery.isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              Failed to load ShExMap files.
            </div>
          )}

          <div className="space-y-3">
            {mapsQuery.data?.items.map((map) => (
              <Link
                key={map.id}
                to={`/maps/${map.id}`}
                className="group flex items-start justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 hover:border-violet-300 hover:shadow-md transition-all"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 group-hover:text-violet-700 transition-colors">
                      {map.title}
                    </span>
                    {map.hasMapAnnotations
                      ? <span className="bg-violet-100 text-violet-700 border border-violet-200 text-xs px-2 py-0.5 rounded-full font-medium">ShExMap</span>
                      : <span className="bg-slate-100 text-slate-500 border border-slate-200 text-xs px-2 py-0.5 rounded-full font-medium">ShEx</span>
                    }
                  </div>
                  {map.description && (
                    <div className="text-sm text-slate-500 mt-0.5 truncate">{map.description}</div>
                  )}
                  {map.schemaUrl && (
                    <div className="mt-1.5">
                      <span className="text-xs text-slate-400">Schema: </span>
                      <span className="bg-blue-50 text-blue-700 border border-blue-100 text-xs px-2 py-0.5 rounded-full font-medium">
                        {map.schemaUrl.split('/').pop() ?? map.schemaUrl}
                      </span>
                    </div>
                  )}
                  {map.mapVariables && map.mapVariables.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                      <span className="text-xs text-slate-400">Variables:</span>
                      {map.mapVariables.slice(0, 8).map((v) => (
                        <span
                          key={v}
                          className="bg-amber-50 text-amber-700 border border-amber-100 text-xs px-2 py-0.5 rounded-full font-mono"
                        >
                          {v}
                        </span>
                      ))}
                      {map.mapVariables.length > 8 && (
                        <span className="text-xs text-slate-400">+{map.mapVariables.length - 8} more</span>
                      )}
                    </div>
                  )}
                  <div className="text-xs text-slate-400 mt-1.5">
                    by {map.authorName} · v{map.version} · {new Date(map.modifiedAt).toLocaleDateString()}
                  </div>
                  {map.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {map.tags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-violet-50 text-violet-700 border border-violet-100 text-xs px-2 py-0.5 rounded-full font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 text-sm text-slate-400 ml-4 shrink-0 pt-0.5">
                  <span className="text-amber-400">★</span>
                  <span>{map.stars}</span>
                </div>
              </Link>
            ))}
          </div>

          {mapsQuery.data && mapsQuery.data.total > (mapFilters.limit ?? 20) && (
            <div className="flex gap-2 justify-center pt-2">
              <button
                disabled={(mapFilters.page ?? 1) <= 1}
                onClick={() => setMapFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <span className="px-4 py-2 text-sm text-slate-500 self-center">Page {mapFilters.page}</span>
              <button
                onClick={() => setMapFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Pairings tab ── */}
      {tab === 'pairings' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="search"
              placeholder="Search by title or tag…"
              className="flex-1 bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              onChange={(e) => setPairingFilters((f) => ({ ...f, q: e.target.value, page: 1 }))}
            />
            <select
              className="bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              onChange={(e) => setPairingFilters((f) => ({ ...f, sort: e.target.value as PairingFilters['sort'], page: 1 }))}
            >
              <option value="modified">Recently Updated</option>
              <option value="created">Newest</option>
              <option value="stars">Most Starred</option>
              <option value="title">Title A–Z</option>
            </select>
          </div>

          {pairingsQuery.isLoading && (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Loading…</div>
          )}
          {pairingsQuery.isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              Failed to load pairings.
            </div>
          )}

          <div className="space-y-3">
            {pairingsQuery.data?.items.map((pairing) => (
              <Link
                key={pairing.id}
                to={`/pairings/create?id=${pairing.id}`}
                className="group flex items-start justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 hover:border-violet-300 hover:shadow-md transition-all"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800 group-hover:text-violet-700 transition-colors">
                    {pairing.title}
                  </div>
                  {pairing.description && (
                    <div className="text-sm text-slate-500 mt-0.5 truncate">{pairing.description}</div>
                  )}
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded font-medium">
                      {pairing.sourceMap.title || pairing.sourceMap.id}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded font-medium">
                      {pairing.targetMap.title || pairing.targetMap.id}
                    </span>
                  </div>
                  {(pairing.sourceMap.schemaUrl || pairing.targetMap.schemaUrl) && (
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className="text-xs text-slate-400">Schemas:</span>
                      {[...new Set([pairing.sourceMap.schemaUrl, pairing.targetMap.schemaUrl].filter(Boolean))].map((url) => (
                        <span key={url} className="bg-blue-50 text-blue-700 border border-blue-100 text-xs px-2 py-0.5 rounded-full font-medium">
                          {url!.split('/').pop()}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-slate-400 mt-1.5">
                    by {pairing.authorName} · v{pairing.version} · {new Date(pairing.modifiedAt).toLocaleDateString()}
                  </div>
                  {pairing.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {pairing.tags.map((tag) => (
                        <span key={tag} className="bg-violet-50 text-violet-700 border border-violet-100 text-xs px-2 py-0.5 rounded-full font-medium">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 text-sm text-slate-400 ml-4 shrink-0 pt-0.5">
                  <span className="text-amber-400">★</span>
                  <span>{pairing.stars}</span>
                </div>
              </Link>
            ))}
          </div>

          {pairingsQuery.data && pairingsQuery.data.total > (pairingFilters.limit ?? 20) && (
            <div className="flex gap-2 justify-center pt-2">
              <button
                disabled={(pairingFilters.page ?? 1) <= 1}
                onClick={() => setPairingFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <span className="px-4 py-2 text-sm text-slate-500 self-center">Page {pairingFilters.page}</span>
              <button
                onClick={() => setPairingFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
