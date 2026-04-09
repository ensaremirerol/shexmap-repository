/**
 * Shared validation UI: Turtle editor + Focus IRI input + Validate button + result display.
 * Used by both ShExMapPage (view/edit) and CreateMapPage (new map).
 */

import { useState, useEffect, type ReactNode } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { registerTurtleLanguage, TURTLE_LANGUAGE_ID } from '../../utils/turtleLanguage.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BindingEntry { variable: string; value: string; datatype?: string }
export interface BindingNode  { shape: string; focus: string; bindings: BindingEntry[]; children: BindingNode[] }
export interface ValidationResult {
  shexValid: boolean;
  shexErrors: string[];
  rdfValid?: boolean;
  rdfErrors?: string[];
  valid: boolean;
  bindingTree: BindingNode[];
  bindings: Record<string, string>;
  errors: string[];
}
export type ValidationMode = 'shex' | 'rdf' | 'full';

// ─── localStorage helpers ─────────────────────────────────────────────────────

const TURTLE_STORAGE_KEY = 'shexmap-turtle-data';
const FOCUS_STORAGE_KEY  = 'shexmap-focus-iri';

export function loadTurtle(mapId: string): string {
  try {
    const raw = localStorage.getItem(TURTLE_STORAGE_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as Record<string, string>)[mapId] ?? '';
  } catch { return ''; }
}

export function saveTurtle(mapId: string, content: string) {
  try {
    const raw = localStorage.getItem(TURTLE_STORAGE_KEY);
    const all: Record<string, string> = raw ? JSON.parse(raw) : {};
    all[mapId] = content;
    localStorage.setItem(TURTLE_STORAGE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded */ }
}

export function loadFocus(mapId: string): string {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as Record<string, string>)[mapId] ?? '';
  } catch { return ''; }
}

export function saveFocus(mapId: string, iri: string) {
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

export function ValidationPanel({ result, mode }: { result: ValidationResult; mode: ValidationMode }) {
  const bindingCount = Object.keys(result.bindings).length;
  return (
    <div className="space-y-4 px-5 py-4">
      <ValidationSection title="ShEx Validation">
        <ValidationBadge ok={result.shexValid} label={result.shexValid ? 'Valid' : 'Error'} />
        {result.shexErrors.map((e, i) => (
          <div key={i} className="text-red-700 text-xs font-mono bg-red-50 border border-red-200 px-3 py-2 rounded mt-1 whitespace-pre-wrap">{e}</div>
        ))}
      </ValidationSection>

      {(mode === 'rdf' || mode === 'full') && result.rdfValid !== undefined && (
        <ValidationSection title="Turtle Validation">
          <ValidationBadge ok={result.rdfValid} label={result.rdfValid ? 'Valid' : 'Error'} />
          {(result.rdfErrors ?? []).map((e, i) => (
            <div key={i} className="text-red-700 text-xs font-mono bg-red-50 border border-red-200 px-3 py-2 rounded mt-1 whitespace-pre-wrap">{e}</div>
          ))}
        </ValidationSection>
      )}

      {result.errors.length > 0 && (
        <div className="text-amber-700 text-xs bg-amber-50 border border-amber-200 px-3 py-2 rounded space-y-1">
          {result.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

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

export function TurtlePanel({
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
