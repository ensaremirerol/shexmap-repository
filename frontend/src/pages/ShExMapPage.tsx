import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Editor, { useMonaco } from '@monaco-editor/react';
import axios from 'axios';
import {
  useShExMap,
  useShExMapVersions,
  useSaveShExMapVersion,
  useUpdateShExMap,
  type ShExMapVersion,
} from '../api/shexmaps.js';
import { apiClient } from '../api/client.js';
import ShExEditor from '../components/editor/ShExEditor.js';
import { registerTurtleLanguage, TURTLE_LANGUAGE_ID } from '../utils/turtleLanguage.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BindingEntry { variable: string; value: string; datatype?: string }
interface BindingNode  { shape: string; focus: string; bindings: BindingEntry[]; children: BindingNode[] }
interface ValidationResult {
  shexValid: boolean;
  shexErrors: string[];
  rdfValid?: boolean;
  rdfErrors?: string[];
  valid: boolean;
  bindingTree: BindingNode[];
  bindings: Record<string, string>;
  errors: string[];
}

type ValidationMode = 'shex' | 'rdf' | 'full';

// ─── localStorage persistence ─────────────────────────────────────────────────

const TURTLE_STORAGE_KEY = 'shexmap-turtle-data';
const FOCUS_STORAGE_KEY  = 'shexmap-focus-iri';

function loadTurtle(mapId: string): string {
  try {
    const raw = localStorage.getItem(TURTLE_STORAGE_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as Record<string, string>)[mapId] ?? '';
  } catch { return ''; }
}

function saveTurtle(mapId: string, content: string) {
  try {
    const raw = localStorage.getItem(TURTLE_STORAGE_KEY);
    const all: Record<string, string> = raw ? JSON.parse(raw) : {};
    all[mapId] = content;
    localStorage.setItem(TURTLE_STORAGE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded */ }
}

function loadFocus(mapId: string): string {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as Record<string, string>)[mapId] ?? '';
  } catch { return ''; }
}

function saveFocus(mapId: string, iri: string) {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    const all: Record<string, string> = raw ? JSON.parse(raw) : {};
    all[mapId] = iri;
    localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded */ }
}

// ─── Validation result display ────────────────────────────────────────────────

function ValidationBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
      ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
    }`}>
      <span>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
    </span>
  );
}

function ValidationSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function BindingNodeView({ node, depth = 0 }: { node: BindingNode; depth?: number }) {
  const [open, setOpen] = useState(true);
  const hasContent = node.bindings.length > 0 || node.children.length > 0;
  return (
    <div style={{ marginLeft: depth * 14 }} className="my-0.5">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-xs font-mono w-full text-left">
        <span className="text-slate-400 w-3 shrink-0">{open ? '▼' : '▶'}</span>
        <span className="font-semibold text-violet-700">{node.shape}</span>
        <span className="text-slate-400 mx-0.5">@</span>
        <span className="text-slate-500 truncate" title={node.focus}>
          {node.focus.length > 50 ? `…${node.focus.slice(-40)}` : node.focus}
        </span>
        {!hasContent && <span className="text-slate-300 italic ml-1">(empty)</span>}
      </button>
      {open && (
        <div className="ml-5">
          {node.bindings.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs font-mono py-0.5 pl-1">
              <span className="text-amber-600 shrink-0">{b.variable.split(/[#>]/).pop()}</span>
              <span className="text-slate-400">=</span>
              <span className="text-emerald-700 font-semibold">{b.value}</span>
              {b.datatype && <span className="text-slate-400 text-[10px] ml-0.5">({b.datatype.split('#').pop()})</span>}
            </div>
          ))}
          {node.children.map((child, i) => <BindingNodeView key={i} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function ValidationPanel({ result, mode }: { result: ValidationResult; mode: ValidationMode }) {
  const bindingCount = Object.keys(result.bindings).length;
  return (
    <div className="space-y-4 px-5 py-4">
      {/* ShEx Validation */}
      <ValidationSection title="ShEx Validation">
        <ValidationBadge ok={result.shexValid} label={result.shexValid ? 'Valid' : 'Error'} />
        {result.shexErrors.map((e, i) => (
          <div key={i} className="text-red-700 text-xs font-mono bg-red-50 border border-red-200 px-3 py-2 rounded mt-1 whitespace-pre-wrap">{e}</div>
        ))}
      </ValidationSection>

      {/* Turtle Validation — shown when RDF was provided */}
      {(mode === 'rdf' || mode === 'full') && result.rdfValid !== undefined && (
        <ValidationSection title="Turtle Validation">
          <ValidationBadge ok={result.rdfValid} label={result.rdfValid ? 'Valid' : 'Error'} />
          {(result.rdfErrors ?? []).map((e, i) => (
            <div key={i} className="text-red-700 text-xs font-mono bg-red-50 border border-red-200 px-3 py-2 rounded mt-1 whitespace-pre-wrap">{e}</div>
          ))}
        </ValidationSection>
      )}

      {/* Other errors (e.g. no start shape, materialisation) */}
      {result.errors.length > 0 && (
        <div className="text-amber-700 text-xs bg-amber-50 border border-amber-200 px-3 py-2 rounded space-y-1">
          {result.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Bindings — full mode only */}
      {mode === 'full' && (
        <ValidationSection title={`Bindings — ${bindingCount} extracted`}>
          {bindingCount === 0 ? (
            <span className="text-xs text-slate-400 italic">No bindings found — check ShEx Map annotations and focus node</span>
          ) : (
            <>
              <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {Object.entries(result.bindings).map(([variable, value]) => (
                    <div key={variable} className="flex items-start gap-2 text-xs font-mono py-0.5">
                      <span className="text-amber-600 truncate shrink-0 max-w-[180px]" title={variable}>
                        {variable.split(/[#>]/).pop() ?? variable}
                      </span>
                      <span className="text-slate-400">=</span>
                      <span className="text-emerald-700 font-semibold break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {result.bindingTree.length > 0 && (
                <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Binding Tree</div>
                  <div className="font-mono text-xs space-y-0.5">
                    {result.bindingTree.map((n, i) => <BindingNodeView key={i} node={n} depth={0} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </ValidationSection>
      )}
    </div>
  );
}

// ─── Turtle panel ─────────────────────────────────────────────────────────────

function TurtlePanel({
  mapId,
  shexContent,
  turtleContent,
  focusNode,
  validationMode,
  onChangeTurtle,
  onChangeFocusNode,
  onActivate,
  onValidate,
  isValidating,
  validationResult,
  validationError,
}: {
  mapId: string;
  shexContent: string;
  turtleContent: string;
  focusNode: string;
  validationMode: ValidationMode;
  onChangeTurtle: (v: string) => void;
  onChangeFocusNode: (v: string) => void;
  onActivate: () => void;
  onValidate: () => void;
  isValidating: boolean;
  validationResult: ValidationResult | null;
  validationError: string;
}) {
  const monaco = useMonaco();
  useEffect(() => { if (monaco) registerTurtleLanguage(monaco); }, [monaco]);

  function handleChange(v: string) {
    onActivate();
    onChangeTurtle(v);
    saveTurtle(mapId, v);
  }

  const buttonLabel = isValidating ? 'Validating…'
    : validationMode === 'shex' ? 'Validate ShEx'
    : validationMode === 'rdf'  ? 'Validate RDF'
    : 'Validate';

  const canValidate = validationMode === 'shex' ? !!shexContent
    : validationMode === 'rdf'  ? !!shexContent && !!turtleContent
    : !!shexContent && !!turtleContent && !!focusNode;

  return (
    <div className="border-t border-slate-700">
      {/* Turtle header */}
      <div className="flex items-center justify-between bg-slate-800 px-3 py-2 gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Sample Turtle Data</span>
        {turtleContent && (
          <button
            onClick={() => {
              const blob = new Blob([turtleContent], { type: 'text/turtle' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `${mapId}.ttl`; a.click();
              URL.revokeObjectURL(url);
            }}
            className="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300 hover:bg-slate-500 transition-colors ml-auto"
          >
            ↓ Download
          </button>
        )}
      </div>
      <Editor
        height={200}
        defaultLanguage={TURTLE_LANGUAGE_ID}
        language={TURTLE_LANGUAGE_ID}
        value={turtleContent}
        onChange={(v) => handleChange(v ?? '')}
        onMount={(editor) => { editor.onDidFocusEditorText(onActivate); }}
        theme="shex-dark"
        options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, wordWrap: 'on' }}
      />
      {/* Focus IRI + Validate */}
      <div className="flex items-center gap-2 bg-slate-800 border-t border-slate-700 px-3 py-1.5">
        <label className="text-xs text-slate-400 shrink-0">Focus IRI</label>
        <input
          type="text"
          value={focusNode}
          onFocus={onActivate}
          onChange={(e) => { onActivate(); onChangeFocusNode(e.target.value); saveFocus(mapId, e.target.value); }}
          placeholder="e.g. ex:node1 or <http://example.org/node1> or <...>@START"
          className="flex-1 text-xs font-mono bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2 py-1 focus:outline-none focus:border-violet-400"
        />
        <button
          onClick={onValidate}
          disabled={isValidating || !canValidate}
          className="shrink-0 text-xs px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-40 transition-colors"
        >
          {buttonLabel}
        </button>
      </div>
      {/* Validation results */}
      {(validationError || validationResult) && (
        <div className="bg-white border-t border-slate-200">
          {validationError && (
            <div className="px-5 py-3 text-red-700 text-xs bg-red-50 border-b border-red-200">{validationError}</div>
          )}
          {validationResult && <ValidationPanel result={validationResult} mode={validationMode} />}
        </div>
      )}
    </div>
  );
}

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
  const { data: map, isLoading, isError } = useShExMap(id ?? '');
  const versionsQuery   = useShExMapVersions(id ?? '');
  const saveVersion     = useSaveShExMapVersion(id ?? '');
  const updateMeta      = useUpdateShExMap(id ?? '');

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
            <button
              onClick={() => setShowMeta((s) => !s)}
              className="ml-auto text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              {showMeta ? 'Hide metadata ▲' : 'Edit metadata ▼'}
            </button>
          </div>
          {showMeta && (
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
          readOnly={false}
          serverVersions={serverVersions}
          onSaveServerVersion={(c, msg) => saveVersion.mutate({ content: c, commitMessage: msg })}
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
