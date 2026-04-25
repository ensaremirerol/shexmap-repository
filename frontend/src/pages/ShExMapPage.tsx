import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  useShExMap,
  useShExMapVersions,
  useSaveShExMapVersion,
  useUpdateShExMap,
  useCreateShExMap,
  type ShExMapVersion,
} from '../api/shexmaps.js';
import { apiClient } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';
import ShExEditor from '../components/editor/ShExEditor.js';
import {
  TurtlePanel,
  loadTurtle,
  loadFocus,
  type ValidationResult,
  type ValidationMode,
} from '../components/validation/TurtleValidationPanel.js';

// ─── Map metadata form ────────────────────────────────────────────────────────

function MapMetaForm({
  map,
  onSave,
  isSaving,
}: {
  map: { id: string; title: string; description?: string; tags: string[]; version: string; schemaUrl?: string };
  onSave: (data: { title: string; description: string; tags: string[]; version: string; schemaUrl: string }) => void;
  isSaving: boolean;
}) {
  const [title, setTitle]     = useState(map.title);
  const [desc, setDesc]       = useState(map.description ?? '');
  const [tags, setTags]       = useState(map.tags.join(', '));
  const [version, setVersion] = useState(map.version);
  const [schema, setSchema]   = useState(map.schemaUrl ?? '');
  const [flash, setFlash]     = useState(false);

  useEffect(() => {
    setTitle(map.title);
    setDesc(map.description ?? '');
    setTags(map.tags.join(', '));
    setVersion(map.version);
    setSchema(map.schemaUrl ?? '');
  }, [map.id]);

  function handleSave() {
    onSave({
      title,
      description: desc,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      version,
      schemaUrl: schema,
    });
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
  }

  return (
    <div className="grid grid-cols-1 gap-2 text-sm mt-3 pb-3">
      <div className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="flex-1 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
        <input value={version} onChange={(e) => setVersion(e.target.value)}
          placeholder="1.0.0"
          className="w-20 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      </div>
      <input value={desc} onChange={(e) => setDesc(e.target.value)}
        placeholder="Description (optional)"
        className="bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      <input value={tags} onChange={(e) => setTags(e.target.value)}
        placeholder="Tags (comma separated)"
        className="bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      <input value={schema} onChange={(e) => setSchema(e.target.value)}
        placeholder="Schema URL (optional)"
        className="bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      <button
        onClick={handleSave}
        disabled={isSaving}
        className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${flash ? 'bg-green-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50'}`}
      >
        {flash ? 'Saved!' : isSaving ? 'Saving…' : 'Save metadata'}
      </button>
    </div>
  );
}

// ─── Metadata row ─────────────────────────────────────────────────────────────

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-sm text-slate-700 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ShExMapPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: map, isLoading, isError } = useShExMap(id ?? '');
  const versionsQuery   = useShExMapVersions(id ?? '');
  const saveVersion     = useSaveShExMapVersion(id ?? '');
  const updateMeta      = useUpdateShExMap(id ?? '');
  const forkMap         = useCreateShExMap();

  const [shexContent, setShexContent]       = useState('');
  const [loadedVersionNum, setLoadedVersionNum] = useState<number | null>(null);
  const [showMeta, setShowMeta]             = useState(false);

  const [turtle, setTurtle]       = useState('');
  const [focusNode, setFocusNode] = useState('');
  const [activePanel, setActivePanel] = useState<'shex' | 'turtle'>('shex');

  const [validating, setValidating]         = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationError, setValidationError]   = useState('');

  const validationMode: ValidationMode =
    (shexContent && turtle && focusNode) ? 'full' :
    (activePanel === 'turtle' || (shexContent && turtle)) ? 'rdf' :
    'shex';

  // Fetch file content when map has a fileName but no inline content
  const { data: fileContent } = useQuery<string>({
    queryKey: ['shex-file', map?.fileName],
    queryFn: () =>
      apiClient
        .get(`/files/${encodeURIComponent(map!.fileName!)}`, { responseType: 'text' })
        .then((r) => r.data as string),
    enabled: !!map?.fileName && !map?.content,
  });

  // Auto-load content: prefer latest server version, fall back to file/inline
  const prevMapId = useRef('');
  useEffect(() => {
    if (!id || id === prevMapId.current) return;
    const versions = versionsQuery.data;
    if (versions === undefined) return; // wait for version list

    if (versions.length > 0) {
      const latest = versions[versions.length - 1]!;
      prevMapId.current = id;
      axios.get(`/api/v1/shexmaps/${id}/versions/${latest.versionNumber}`)
        .then(({ data }) => {
          setShexContent(data.content as string);
          setLoadedVersionNum(latest.versionNumber);
        })
        .catch(() => {/* ignore */});
    } else {
      const content = fileContent ?? map?.content;
      if (!content) return;
      prevMapId.current = id;
      setShexContent(content);
    }
  }, [id, versionsQuery.data, fileContent, map?.content]);

  // Restore turtle from localStorage; fall back to map.sampleTurtleData if nothing stored
  useEffect(() => {
    if (!id) return;
    const t = loadTurtle(id);
    setTurtle(t || map?.sampleTurtleData || '');
    const f = loadFocus(id);
    if (f) setFocusNode(f);
  }, [id, map?.sampleTurtleData]);

  const handleValidate = useCallback(async () => {
    setValidating(true);
    setValidationError('');
    setValidationResult(null);
    try {
      const mode: ValidationMode =
        (shexContent && turtle && focusNode) ? 'full' :
        (activePanel === 'turtle' || (shexContent && turtle)) ? 'rdf' :
        'shex';
      const body: Record<string, string> = { sourceShEx: shexContent };
      if (mode === 'rdf' || mode === 'full') body['sourceRdf'] = turtle;
      if (mode === 'full') body['sourceNode'] = focusNode;
      const { data } = await axios.post<ValidationResult>('/api/v1/validate', body);
      setValidationResult(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setValidationError(err.response?.data?.error ?? err.message ?? 'Validation failed');
    } finally {
      setValidating(false);
    }
  }, [shexContent, turtle, focusNode, activePanel]);

  async function handleLoadVersion(vn: number) {
    try {
      const { data } = await axios.get(`/api/v1/shexmaps/${id}/versions/${vn}`);
      setShexContent(data.content as string);
      setLoadedVersionNum(vn);
    } catch { /* ignore */ }
  }

  if (isLoading) return <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>;
  if (isError || !map) return (
    <div className="py-20 text-center">
      <p className="text-slate-500">ShExMap not found.</p>
    </div>
  );

  const isOwner = !!user && user.sub === map.authorId;
  const mapSnapshot = map;

  async function handleFork() {
    const forked = await forkMap.mutateAsync({
      title:            `Fork of ${mapSnapshot.title}`,
      description:      mapSnapshot.description,
      content:          shexContent || mapSnapshot.content,
      sampleTurtleData: mapSnapshot.sampleTurtleData,
      sourceUrl:        mapSnapshot.sourceUrl,
      schemaUrl:        mapSnapshot.schemaUrl,
      tags:             mapSnapshot.tags,
      version:          mapSnapshot.version,
      fileFormat:       mapSnapshot.fileFormat,
    });
    navigate(`/maps/${forked.id}`);
  }

  const serverVersions = (versionsQuery.data ?? []).map((v: ShExMapVersion) => ({
    versionNumber: v.versionNumber,
    commitMessage: v.commitMessage,
    authorName: v.authorName,
    createdAt: v.createdAt,
  }));

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-slate-400">
        <Link to="/browse" className="hover:text-violet-600 transition-colors">Browse</Link>
        <span className="mx-2">›</span>
        <span className="text-slate-600">{map.title}</span>
      </nav>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{map.title}</h1>
            {map.description && (
              <p className="text-slate-500 mt-1.5 leading-relaxed">{map.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-sm shrink-0 text-slate-400 pt-1">
            <span className="text-amber-400 text-base">★</span>
            <span>{map.stars}</span>
          </div>
        </div>
        {map.tags.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {map.tags.map((tag) => (
              <span key={tag} className="bg-violet-50 text-violet-700 border border-violet-100 text-xs px-2.5 py-0.5 rounded-full font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetaRow label="Author" value={map.authorName} />
        <MetaRow label="Version" value={`v${map.version}`} />
        <MetaRow label="Created" value={new Date(map.createdAt).toLocaleDateString()} />
        <MetaRow label="Updated" value={new Date(map.modifiedAt).toLocaleDateString()} />
        {map.fileName && <MetaRow label="File" value={map.fileName} mono />}
        <MetaRow label="Format" value={map.fileFormat} mono />
        {map.schemaUrl && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Schema</div>
            <Link
              to={`/browse?tab=schemas&schema=${encodeURIComponent(map.schemaUrl)}`}
              className="text-sm text-violet-600 hover:underline font-medium"
            >
              {map.schemaUrl.split('/').pop() ?? map.schemaUrl}
            </Link>
            <div className="text-xs text-slate-400 break-all mt-0.5">{map.schemaUrl}</div>
          </div>
        )}
        {map.sourceUrl && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Source URL</div>
            <a href={map.sourceUrl} target="_blank" rel="noreferrer"
              className="text-sm text-violet-600 hover:underline break-all">
              {map.sourceUrl}
            </a>
          </div>
        )}
      </div>

      {/* Editor + Turtle + Validate panel */}
      <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
        {/* Panel header */}
        <div className="bg-slate-800 px-4 py-2.5 space-y-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-100 font-mono">
              {loadedVersionNum !== null
                ? `${map.fileName ?? map.id} @ v${loadedVersionNum}`
                : (map.fileName ?? 'inline content')}
            </span>
            <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono ml-1">
              {map.fileFormat}
            </span>
            {isOwner ? (
              <button
                onClick={() => setShowMeta((s) => !s)}
                className="ml-auto text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showMeta ? 'Hide metadata ▲' : 'Edit metadata ▼'}
              </button>
            ) : user ? (
              <button
                onClick={handleFork}
                disabled={forkMap.isPending}
                className="ml-auto flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-3 py-1 rounded font-medium transition-colors"
              >
                {forkMap.isPending ? 'Forking…' : (
                  <>
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
                      <path d="M5 5.372v.878c0 .414.336.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>
                    </svg>
                    Fork
                  </>
                )}
              </button>
            ) : null}
          </div>
          {isOwner && showMeta && (
            <MapMetaForm
              map={map}
              onSave={(d) => updateMeta.mutate(d)}
              isSaving={updateMeta.isPending}
            />
          )}
        </div>

        {/* ShEx editor */}
        <ShExEditor
          value={shexContent}
          mapId={map.id}
          fileName={map.fileName}
          fileFormat={map.fileFormat}
          height={400}
          readOnly={!isOwner}
          serverVersions={serverVersions}
          onSaveServerVersion={isOwner ? (c, msg) => saveVersion.mutate({ content: c, commitMessage: msg }) : undefined}
          isSavingServerVersion={saveVersion.isPending}
          onLoadServerVersion={handleLoadVersion}
          onChange={setShexContent}
          onFocus={() => setActivePanel('shex')}
        />

        {/* Turtle + Focus IRI + Validate */}
        <TurtlePanel
          mapId={map.id}
          shexContent={shexContent}
          turtleContent={turtle}
          focusNode={focusNode}
          validationMode={validationMode}
          onChangeTurtle={setTurtle}
          onChangeFocusNode={setFocusNode}
          onActivate={() => setActivePanel('turtle')}
          onValidate={handleValidate}
          isValidating={validating}
          validationResult={validationResult}
          validationError={validationError}
        />
      </div>
    </div>
  );
}
