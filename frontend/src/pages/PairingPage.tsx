import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useShExMapPairing, type ShExMap } from '../api/shexmaps.js';
import { apiClient } from '../api/client.js';
import ShExEditor from '../components/editor/ShExEditor.js';
import { buildVarColorMap } from '../utils/varColors.js';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PairingPage() {
  const { id } = useParams<{ id: string }>();
  const { data: pairing, isLoading, isError } = useShExMapPairing(id ?? '');

  const srcFileName = pairing?.sourceMap.fileName;
  const tgtFileName = pairing?.targetMap.fileName;

  const { data: srcFetched } = useQuery<string>({
    queryKey: ['shex-file', srcFileName],
    queryFn: () =>
      apiClient.get(`/files/${encodeURIComponent(srcFileName!)}`, { responseType: 'text' })
        .then((r) => r.data as string),
    enabled: !!srcFileName,
  });

  const { data: tgtFetched } = useQuery<string>({
    queryKey: ['shex-file', tgtFileName],
    queryFn: () =>
      apiClient.get(`/files/${encodeURIComponent(tgtFileName!)}`, { responseType: 'text' })
        .then((r) => r.data as string),
    enabled: !!tgtFileName,
  });

  const srcContent = srcFetched ?? pairing?.sourceMap.content;
  const tgtContent = tgtFetched ?? pairing?.targetMap.content;

  // Shared mapping variables → color index (shown in both editors + legend)
  const varColorMap = useMemo<Map<string, number>>(() => {
    if (!srcContent || !tgtContent) return new Map();
    return buildVarColorMap(srcContent, tgtContent);
  }, [srcContent, tgtContent]);

  if (isLoading) return <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>;
  if (isError || !pairing) return (
    <div className="py-20 text-center"><p className="text-slate-500">Pairing not found.</p></div>
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-slate-400">
        <Link to="/browse" className="hover:text-violet-600 transition-colors">Browse</Link>
        <span className="mx-2">›</span>
        <span className="text-slate-600">{pairing.title}</span>
      </nav>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{pairing.title}</h1>
            {pairing.description && (
              <p className="text-slate-500 mt-1.5 leading-relaxed">{pairing.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm shrink-0 text-slate-400 pt-1">
            <span className="text-amber-400 text-base">★</span>
            <span>{pairing.stars}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-slate-400">
          <span>by <span className="text-slate-600 font-medium">{pairing.authorName}</span></span>
          <span>v{pairing.version}</span>
          <span>Updated {new Date(pairing.modifiedAt).toLocaleDateString()}</span>
        </div>
        {pairing.tags.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {pairing.tags.map((tag) => (
              <span key={tag} className="bg-violet-50 text-violet-700 border border-violet-100 text-xs px-2.5 py-0.5 rounded-full font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ShEx file panels */}
      <div className="flex flex-col gap-5">
        <ShExFilePanel
          map={pairing.sourceMap}
          role="Source"
          content={srcContent}
          varColorMap={varColorMap}
        />
        <ShExFilePanel
          map={pairing.targetMap}
          role="Target"
          content={tgtContent}
          varColorMap={varColorMap}
        />
      </div>
    </div>
  );
}

// ─── File panel ───────────────────────────────────────────────────────────────

function ShExFilePanel({
  map,
  role,
  content,
  varColorMap,
}: {
  map: ShExMap;
  role: string;
  content: string | undefined;
  varColorMap: Map<string, number>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
      {/* Panel header */}
      <div className="flex items-center justify-between bg-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{role}</span>
          <span className="text-slate-500">·</span>
          <Link
            to={`/maps/${map.id}`}
            className="text-sm font-medium text-slate-100 hover:text-violet-300 transition-colors"
          >
            {map.title || map.id}
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {map.fileName && (
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono">
              {map.fileFormat}
            </span>
          )}
          {map.sourceUrl && (
            <a
              href={map.sourceUrl}
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
              target="_blank"
              rel="noreferrer"
              download={map.fileName}
            >
              ↓ download
            </a>
          )}
        </div>
      </div>

      {!content && (
        <div className="flex items-center justify-center text-slate-400 text-sm" style={{ height: 400 }}>
          Loading…
        </div>
      )}
      {content !== undefined && (
        <ShExEditor
          value={content}
          mapId={map.id}
          fileName={map.fileName}
          fileFormat={map.fileFormat}
          height={400}
          readOnly={true}
          varColorMap={varColorMap}
        />
      )}
    </div>
  );
}
