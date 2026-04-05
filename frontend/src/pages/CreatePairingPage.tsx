/**
 * CreatePairingPage — full create/edit workflow for a ShExMap Pairing.
 *
 * Features:
 *  1. Load/edit/save two versioned ShExMaps (with metadata) — one editor per side
 *  2. Dynamic variable highlighting: matched (colour-coded) and unmatched (muted) per side
 *  3. Turtle data editor per side — load, edit, auto-generate from ShEx shapes
 *  4. Validate & materialise the pairing in either direction, binding-tree display
 *  5. Load/save/update a ShExMap Pairing with its metadata
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import {
  useShExMaps,
  useShExMap,
  useShExMapVersions,
  useSaveShExMapVersion,
  useUpdateShExMap,
  useCreateShExMap,
  useShExMapPairings,
  useShExMapPairing,
  useCreateShExMapPairing,
  useUpdateShExMapPairing,
  useShExMapPairingVersions,
  useSaveShExMapPairingVersion,
  type ShExMap,
  type ShExMapVersion,
  type ShExMapPairingVersion,
} from '../api/shexmaps.js';
import { apiClient } from '../api/client.js';
import ShExEditor from '../components/editor/ShExEditor.js';
import { extractVars, buildVarColorMap } from '../utils/varColors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BindingEntry { variable: string; value: string; datatype?: string }
interface BindingNode  { shape: string; focus: string; bindings: BindingEntry[]; children: BindingNode[] }
interface ValidationResult {
  valid: boolean;
  bindingTree: BindingNode[];
  bindings: Record<string, string>;
  targetRdf?: string;
  errors: string[];
}

// ─── Turtle auto-generate ─────────────────────────────────────────────────────

function autoGenerateTurtle(shexContent: string): string {
  const prefixLines: string[] = ['@prefix ex: <http://example.org/> .', '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .'];
  const vars = extractVars(shexContent);

  // Extract declared prefixes from the ShEx
  for (const m of shexContent.matchAll(/PREFIX\s+(\w+):\s*<([^>]+)>/gi)) {
    prefixLines.push(`@prefix ${m[1]}: <${m[2]}> .`);
  }

  // Extract shape names (rough heuristic: <IRI> { or PREFIX:Local {)
  const shapes: string[] = [];
  for (const m of shexContent.matchAll(/<([^>]+)>\s*\{|\b([A-Za-z_][\w]*:[A-Za-z_][\w]*)\s*\{/g)) {
    const name = m[1] || m[2];
    if (name) shapes.push(name);
  }

  const varComment = vars.length > 0
    ? `\n# Map variables to bind: ${vars.join(', ')}\n`
    : '';

  const instances = shapes.slice(0, 3).map((shape, i) => {
    const nodeIri = `ex:node${i + 1}`;
    const typeTriple = shape.startsWith('http') || shape.startsWith('https')
      ? `  a <${shape}> ;`
      : `  a ${shape} ;`;
    return `${nodeIri}\n${typeTriple}\n  # add required properties here\n  .`;
  });

  if (instances.length === 0) {
    instances.push('ex:node1\n  a ex:Thing ;\n  # add required properties here\n  .');
  }

  return [prefixLines.join('\n'), varComment, ...instances].join('\n') + '\n';
}

// ─── Turtle + Focus IRI localStorage persistence ──────────────────────────────

const TURTLE_STORAGE_KEY = 'shexmap-turtle-data';
const FOCUS_STORAGE_KEY  = 'shexmap-focus-iri';

function loadTurtle(mapId: string): string {
  try {
    const raw = localStorage.getItem(TURTLE_STORAGE_KEY);
    if (!raw) return '';
    const all = JSON.parse(raw) as Record<string, string>;
    return all[mapId] ?? '';
  } catch { return ''; }
}

function saveTurtle(mapId: string, content: string) {
  try {
    const raw = localStorage.getItem(TURTLE_STORAGE_KEY);
    const all: Record<string, string> = raw ? JSON.parse(raw) : {};
    all[mapId] = content;
    localStorage.setItem(TURTLE_STORAGE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded — ignore */ }
}

function loadFocus(mapId: string): string {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return '';
    const all = JSON.parse(raw) as Record<string, string>;
    return all[mapId] ?? '';
  } catch { return ''; }
}

function saveFocus(mapId: string, iri: string) {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    const all: Record<string, string> = raw ? JSON.parse(raw) : {};
    all[mapId] = iri;
    localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(all));
  } catch { /* quota exceeded — ignore */ }
}

// ─── License list ─────────────────────────────────────────────────────────────

const KNOWN_LICENSES = [
  { label: 'CC0 1.0 — Public Domain Dedication',            url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { label: 'CC BY 4.0 — Attribution',                       url: 'https://creativecommons.org/licenses/by/4.0/' },
  { label: 'CC BY-SA 4.0 — Attribution-ShareAlike',         url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  { label: 'CC BY-NC 4.0 — Attribution-NonCommercial',      url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  { label: 'CC BY-NC-SA 4.0 — Attribution-NonCommercial-ShareAlike', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
  { label: 'CC BY-ND 4.0 — Attribution-NoDerivatives',      url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
  { label: 'ODbL 1.0 — Open Database License',              url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  { label: 'ODC-By 1.0 — Open Data Commons Attribution',    url: 'https://opendatacommons.org/licenses/by/1-0/' },
  { label: 'PDDL 1.0 — Public Domain Dedication & License', url: 'https://opendatacommons.org/licenses/pddl/1-0/' },
  { label: 'MIT License',                                   url: 'https://opensource.org/licenses/MIT' },
  { label: 'Apache 2.0',                                    url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  { label: 'GPL 3.0',                                       url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
];

function LicensePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = q.trim()
    ? KNOWN_LICENSES.filter((l) =>
        l.label.toLowerCase().includes(q.toLowerCase()) ||
        l.url.toLowerCase().includes(q.toLowerCase()),
      )
    : KNOWN_LICENSES;

  const selectedLabel = KNOWN_LICENSES.find((l) => l.url === value)?.label;

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={open ? q : (selectedLabel ?? value)}
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          placeholder="Search or paste a license URL…"
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); setQ(''); }}
            className="text-xs text-slate-400 hover:text-slate-600 px-2"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {/* Selected URL display */}
      {value && !open && (
        <p className="mt-1 text-xs font-mono text-slate-400 truncate">{value}</p>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400 italic">No matches — paste a custom URL above</div>
          ) : (
            filtered.map((l) => (
              <button
                key={l.url}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(l.url);
                  setOpen(false);
                  setQ('');
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-violet-50 hover:text-violet-700 transition-colors ${value === l.url ? 'bg-violet-50 text-violet-700 font-medium' : 'text-slate-700'}`}
              >
                <span className="block">{l.label}</span>
                <span className="block text-xs font-mono text-slate-400 truncate">{l.url}</span>
              </button>
            ))
          )}
          {/* Allow pasting a custom URL not in the list */}
          {q && !filtered.find((l) => l.url === q) && q.startsWith('http') && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(q);
                setOpen(false);
                setQ('');
              }}
              className="w-full text-left px-3 py-2 text-sm text-violet-600 hover:bg-violet-50 border-t border-slate-100"
            >
              Use custom URL: <span className="font-mono">{q}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

/** Searchable map selector dropdown */
function MapSelector({
  label,
  selectedId,
  onSelect,
}: {
  label: string;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const { data } = useShExMaps({ q: q || undefined, limit: 20, sort: 'modified' });

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search maps…"
          className="flex-1 text-sm bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
        />
        <select
          value={selectedId}
          onChange={(e) => { onSelect(e.target.value); setQ(''); }}
          className="flex-1 text-sm bg-slate-700 text-slate-200 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
        >
          <option value="">— select a map —</option>
          {data?.items.map((m) => (
            <option key={m.id} value={m.id}>{m.title || m.id}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** ShExMap metadata editor form */
function MapMetaForm({
  map,
  onSave,
  isSaving,
}: {
  map: ShExMap;
  onSave: (data: { title: string; description: string; tags: string[]; version: string; schemaUrl: string }) => void;
  isSaving: boolean;
}) {
  const [title, setTitle]       = useState(map.title);
  const [desc, setDesc]         = useState(map.description ?? '');
  const [tags, setTags]         = useState(map.tags.join(', '));
  const [version, setVersion]   = useState(map.version);
  const [schema, setSchema]     = useState(map.schemaUrl ?? '');
  const [flash, setFlash]       = useState(false);

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
    <div className="grid grid-cols-1 gap-2 text-sm mt-3">
      <div className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Title" className="flex-1 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
        <input value={version} onChange={(e) => setVersion(e.target.value)}
          placeholder="1.0.0" className="w-20 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      </div>
      <input value={desc} onChange={(e) => setDesc(e.target.value)}
        placeholder="Description (optional)" className="bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      <input value={tags} onChange={(e) => setTags(e.target.value)}
        placeholder="Tags (comma separated)" className="bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      <input value={schema} onChange={(e) => setSchema(e.target.value)}
        placeholder="Schema URL (optional)" className="bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400" />
      <button
        onClick={handleSave}
        disabled={isSaving}
        className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${flash ? 'bg-green-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50'}`}
      >
        {flash ? 'Saved!' : isSaving ? 'Saving…' : 'Save map metadata'}
      </button>
    </div>
  );
}

/** Compact per-side validation result */
function SideValidationResult({ result }: { result: ValidationResult }) {
  const bindingCount = Object.keys(result.bindings).length;
  return (
    <div className="space-y-2 pt-1">
      {result.errors.length > 0 && (
        <div className="text-red-700 text-xs bg-red-50 border border-red-200 px-3 py-2 rounded space-y-0.5">
          {result.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
      <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
        result.valid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'
      }`}>
        <span>{result.valid ? '✓' : '⚠'}</span>
        <span>{result.valid
          ? `${bindingCount} binding${bindingCount !== 1 ? 's' : ''} extracted`
          : 'No bindings — check ShEx syntax and focus node'}
        </span>
      </div>
      {bindingCount > 0 && (
        <div className="grid grid-cols-1 gap-y-0.5 font-mono text-xs pl-1">
          {Object.entries(result.bindings).map(([variable, value]) => (
            <div key={variable} className="flex items-start gap-1.5">
              <span className="text-amber-600 shrink-0 max-w-[140px] truncate" title={variable}>
                {variable.split(/[#>]/).pop() ?? variable}
              </span>
              <span className="text-slate-400">=</span>
              <span className="text-emerald-700 font-semibold break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Turtle data panel with Monaco editor, auto-generate, and localStorage save */
function TurtlePanel({
  mapId,
  shexContent,
  turtleContent,
  focusNode,
  onChangeTurtle,
  onChangeFocusNode,
  onValidate,
  isValidating,
  validationResult,
  validationError,
}: {
  mapId: string;
  shexContent: string;
  turtleContent: string;
  focusNode: string;
  onChangeTurtle: (v: string) => void;
  onChangeFocusNode: (v: string) => void;
  onValidate?: () => void;
  isValidating?: boolean;
  validationResult?: ValidationResult | null;
  validationError?: string;
}) {
  function handleAutoGenerate() {
    const stub = autoGenerateTurtle(shexContent);
    onChangeTurtle(stub);
    if (mapId) saveTurtle(mapId, stub);
  }

  function handleChange(v: string) {
    onChangeTurtle(v);
    if (mapId) saveTurtle(mapId, v);
  }

  const canValidate = !!shexContent && !!turtleContent && !!focusNode;

  return (
    <div className="rounded-none border-t border-slate-700">
      <div className="flex items-center justify-between bg-slate-800 px-3 py-2 gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Sample Turtle Data</span>
        <div className="flex gap-2 ml-auto">
          {shexContent && (
            <button
              onClick={handleAutoGenerate}
              className="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300 hover:bg-slate-500 transition-colors"
            >
              Auto-generate
            </button>
          )}
          {turtleContent && (
            <button
              onClick={() => {
                const blob = new Blob([turtleContent], { type: 'text/turtle' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `${mapId || 'data'}.ttl`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300 hover:bg-slate-500 transition-colors"
            >
              ↓ Download
            </button>
          )}
        </div>
      </div>
      <Editor
        height={200}
        defaultLanguage="plaintext"
        language="plaintext"
        value={turtleContent}
        onChange={(v) => handleChange(v ?? '')}
        theme="vs-dark"
        options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, wordWrap: 'on' }}
      />
      <div className="flex items-center gap-2 bg-slate-800 border-t border-slate-700 px-3 py-1.5">
        <label className="text-xs text-slate-400 shrink-0">Focus IRI</label>
        <input
          type="text"
          value={focusNode}
          onChange={(e) => { onChangeFocusNode(e.target.value); if (mapId) saveFocus(mapId, e.target.value); }}
          placeholder="e.g. tag:BPfhir123 or <http://ex.org/node1> or <...>@START"
          className="flex-1 text-xs font-mono bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2 py-1 focus:outline-none focus:border-violet-400"
        />
        {onValidate && (
          <button
            onClick={onValidate}
            disabled={isValidating || !canValidate}
            title={canValidate ? 'Validate this ShExMap against the sample data' : 'Add ShEx, Turtle, and Focus IRI to validate'}
            className="shrink-0 text-xs px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-40 transition-colors"
          >
            {isValidating ? 'Validating…' : 'Validate'}
          </button>
        )}
      </div>
      {/* Per-side validation result */}
      {(validationError || validationResult) && (
        <div className="bg-white border-t border-slate-200 px-4 py-3">
          {validationError && (
            <div className="text-red-700 text-xs bg-red-50 border border-red-200 px-3 py-2 rounded">{validationError}</div>
          )}
          {validationResult && <SideValidationResult result={validationResult} />}
        </div>
      )}
    </div>
  );
}

/** Variable legend showing matched (coloured) and unmatched (grey) variables */
function VariableLegend({
  srcContent,
  tgtContent,
  varColorMap,
}: {
  srcContent: string;
  tgtContent: string;
  varColorMap: Map<string, number>;
}) {
  const srcOnly = useMemo(() => {
    const all = extractVars(srcContent);
    return all.filter((v) => !varColorMap.has(v));
  }, [srcContent, varColorMap]);

  const tgtOnly = useMemo(() => {
    const all = extractVars(tgtContent);
    return all.filter((v) => !varColorMap.has(v));
  }, [tgtContent, varColorMap]);

  const shared = [...varColorMap.entries()];
  if (shared.length === 0 && srcOnly.length === 0 && tgtOnly.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-3">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        Mapping variables
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {shared.map(([varName]) => (
          <span
            key={varName}
            className="text-xs font-mono px-2 py-0.5 rounded text-violet-900"
            title="Matched between source and target"
            style={{ background: 'rgba(139,92,246,0.15)', borderBottom: '2px solid #7c3aed' }}
          >
            {varName}
          </span>
        ))}
        {srcOnly.map((v) => (
          <span key={`src-${v}`} className="text-xs font-mono px-2 py-0.5 rounded text-slate-500" title="Source only — no match in target"
            style={{ background: 'rgba(100,116,139,0.15)', borderBottom: '2px solid #475569' }}>
            {v} <span className="text-slate-400">(src)</span>
          </span>
        ))}
        {tgtOnly.map((v) => (
          <span key={`tgt-${v}`} className="text-xs font-mono px-2 py-0.5 rounded text-slate-500" title="Target only — no match in source"
            style={{ background: 'rgba(100,116,139,0.15)', borderBottom: '2px solid #475569' }}>
            {v} <span className="text-slate-400">(tgt)</span>
          </span>
        ))}
      </div>
      {(srcOnly.length > 0 || tgtOnly.length > 0) && (
        <p className="text-xs text-slate-400 mt-1.5 italic">
          Greyed variables appear in only one side — check spelling or add them to the other schema.
        </p>
      )}
    </div>
  );
}

/** Pairing version history table */
function PairingVersionHistory({ versions }: { versions: ShExMapPairingVersion[] }) {
  return (
    <div className="bg-slate-50 rounded-lg border border-slate-200 px-4 py-3 space-y-1.5 max-h-56 overflow-y-auto">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Pairing version history</div>
      {[...versions].reverse().map((v) => (
        <div key={v.id} className="flex items-center gap-3 text-xs">
          <span className="font-mono text-violet-700 shrink-0">v{v.versionNumber}</span>
          <span className="text-slate-500 truncate flex-1">
            {v.commitMessage ?? <span className="italic text-slate-400">no message</span>}
          </span>
          {v.sourceVersionNumber !== undefined && (
            <span className="text-slate-400 shrink-0 font-mono">src@v{v.sourceVersionNumber}</span>
          )}
          {v.targetVersionNumber !== undefined && (
            <span className="text-slate-400 shrink-0 font-mono">tgt@v{v.targetVersionNumber}</span>
          )}
          <span className="text-slate-400 shrink-0">{new Date(v.createdAt).toLocaleDateString()}</span>
          <span className="text-slate-400 shrink-0">by {v.authorName}</span>
        </div>
      ))}
    </div>
  );
}

/** Binding tree node */
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

/** Validation results panel */
function ValidationPanel({ result }: { result: ValidationResult }) {
  const bindingCount = Object.keys(result.bindings).length;
  return (
    <div className="space-y-3">
      {result.errors.length > 0 && (
        <div className="text-red-700 text-sm bg-red-50 border border-red-200 px-4 py-3 rounded-lg space-y-1">
          {result.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium border ${
        result.valid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'
      }`}>
        <span>{result.valid ? '✓' : '⚠'}</span>
        <span>{result.valid
          ? `${bindingCount} binding${bindingCount !== 1 ? 's' : ''} extracted`
          : 'No bindings found — check ShEx syntax and focus node'}
        </span>
      </div>
      {bindingCount > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Extracted Bindings</div>
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
      )}
      {result.bindingTree.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Binding Tree</div>
          <div className="font-mono text-xs space-y-0.5">
            {result.bindingTree.map((n, i) => <BindingNodeView key={i} node={n} depth={0} />)}
          </div>
        </div>
      )}
      {result.targetRdf && (
        <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
          <div className="flex items-center justify-between bg-slate-800 px-4 py-2.5">
            <span className="text-sm font-medium text-slate-100">Materialized Target RDF</span>
            <button onClick={() => navigator.clipboard.writeText(result.targetRdf!)}
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors">Copy</button>
          </div>
          <Editor height={280} defaultLanguage="plaintext" value={result.targetRdf}
            options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12 }}
            theme="vs-dark" />
        </div>
      )}
    </div>
  );
}

// ─── Inline create-new-map form ───────────────────────────────────────────────

function CreateMapInlineForm({
  initialContent,
  onCreated,
  onCancel,
}: {
  initialContent: string;
  onCreated: (id: string, content: string) => void;
  onCancel: () => void;
}) {
  const createMap = useCreateShExMap();
  const [title, setTitle]     = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [desc, setDesc]       = useState('');
  const [schema, setSchema]   = useState('');
  const [tags, setTags]       = useState('');
  const [err, setErr]         = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr('Title is required.'); return; }
    setErr('');
    try {
      const content = initialContent.trim() || '# New ShEx schema\n';
      const result = await createMap.mutateAsync({
        title: title.trim(),
        description: desc.trim() || undefined,
        content,
        sourceSchemaUrl: schema.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        version: version.trim() || '1.0.0',
      });
      onCreated(result.id, content);
    } catch (e: unknown) {
      const ex = e as { response?: { data?: { error?: string } }; message?: string };
      setErr(ex.response?.data?.error ?? ex.message ?? 'Failed to create map');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 p-3 bg-slate-700 rounded-lg border border-slate-600">
      <div className="text-xs font-semibold text-violet-300 uppercase tracking-wide mb-1">New ShExMap</div>
      <div className="flex gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title *"
          className="flex-1 text-sm bg-slate-800 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
        />
        <input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="1.0.0"
          className="w-20 text-sm bg-slate-800 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
        />
      </div>
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Description (optional)"
        className="w-full text-sm bg-slate-800 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
      />
      <input
        value={schema}
        onChange={(e) => setSchema(e.target.value)}
        placeholder="Schema URL (optional)"
        className="w-full text-sm bg-slate-800 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Tags (comma separated)"
        className="w-full text-sm bg-slate-800 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
      />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded bg-slate-600 text-slate-300 hover:bg-slate-500 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={createMap.isPending}
          className="text-xs px-3 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 transition-colors">
          {createMap.isPending ? 'Creating…' : 'Create & select'}
        </button>
      </div>
    </form>
  );
}

// ─── ShExMap side panel (selector + editor + metadata + turtle) ───────────────

function ShExMapSidePanel({
  role,
  selectedMapId,
  onSelectMap,
  shexContent,
  onShexContentChange,
  varColorMap,
  turtleContent,
  focusNode,
  onChangeTurtle,
  onChangeFocusNode,
}: {
  role: 'Source' | 'Target';
  selectedMapId: string;
  onSelectMap: (id: string) => void;
  shexContent: string;
  onShexContentChange: (v: string) => void;
  varColorMap: Map<string, number>;
  turtleContent: string;
  focusNode: string;
  onChangeTurtle: (v: string) => void;
  onChangeFocusNode: (v: string) => void;
}) {
  const mapQuery = useShExMap(selectedMapId);
  const versionsQuery = useShExMapVersions(selectedMapId);
  const saveVersion = useSaveShExMapVersion(selectedMapId);
  const updateMeta = useUpdateShExMap(selectedMapId);
  const [showMeta, setShowMeta] = useState(false);
  const [loadedVersionNum, setLoadedVersionNum] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Per-side validation
  const [sideValidating, setSideValidating] = useState(false);
  const [sideResult, setSideResult] = useState<ValidationResult | null>(null);
  const [sideErr, setSideErr] = useState('');

  async function handleSideValidate() {
    setSideValidating(true);
    setSideErr('');
    setSideResult(null);
    try {
      const { data } = await axios.post<ValidationResult>('/api/v1/validate', {
        sourceShEx: shexContent,
        sourceRdf: turtleContent,
        sourceNode: focusNode,
      });
      setSideResult(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setSideErr(err.response?.data?.error ?? err.message ?? 'Validation failed');
    } finally {
      setSideValidating(false);
    }
  }

  const map = mapQuery.data;

  // Fetch file content from the /files/ endpoint when inline content is absent
  const { data: fileContent } = useQuery<string>({
    queryKey: ['shex-file', map?.fileName],
    queryFn: () =>
      apiClient
        .get(`/files/${encodeURIComponent(map!.fileName!)}`, { responseType: 'text' })
        .then((r) => r.data as string),
    enabled: !!map?.fileName && !map?.content,
  });

  // When map selection changes: restore turtle and focus IRI from localStorage
  const prevMapId = useRef('');
  useEffect(() => {
    if (!selectedMapId || selectedMapId === prevMapId.current) return;
    prevMapId.current = selectedMapId;
    const savedTurtle = loadTurtle(selectedMapId);
    if (savedTurtle) onChangeTurtle(savedTurtle);
    const savedFocus = loadFocus(selectedMapId);
    if (savedFocus) onChangeFocusNode(savedFocus);
  }, [selectedMapId]);

  const serverVersions = (versionsQuery.data ?? []).map((v: ShExMapVersion) => ({
    versionNumber: v.versionNumber,
    commitMessage: v.commitMessage,
    authorName: v.authorName,
    createdAt: v.createdAt,
  }));

  async function handleLoadServerVersion(vn: number) {
    try {
      const { data } = await axios.get(`/api/v1/shexmaps/${selectedMapId}/versions/${vn}`);
      onShexContentChange(data.content as string);
      setLoadedVersionNum(vn);
    } catch { /* ignore */ }
  }

  // Auto-load content once per map: prefer latest server version, fall back to file/inline.
  // Wait until the version list has resolved before deciding which source to use.
  const prevContentMapId = useRef('');
  useEffect(() => {
    if (!selectedMapId || selectedMapId === prevContentMapId.current) return;
    const versions = versionsQuery.data; // undefined = still loading
    if (versions === undefined) return;  // wait for version list

    if (versions.length > 0) {
      // Load the latest (highest-numbered) server version automatically
      const latest = versions[versions.length - 1]!;
      prevContentMapId.current = selectedMapId;
      handleLoadServerVersion(latest.versionNumber);
    } else {
      // No versions saved — fall back to file content or inline content
      const content = fileContent ?? map?.content;
      if (!content) return; // still loading file
      prevContentMapId.current = selectedMapId;
      onShexContentChange(content);
    }
  }, [selectedMapId, versionsQuery.data, fileContent, map?.content]);

  return (
    <div className="flex-1 min-w-0 rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
      {/* Panel header */}
      <div className="bg-slate-800 px-4 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{role}</span>
          {map && (
            <>
              <span className="text-slate-600">·</span>
              <Link to={`/maps/${map.id}`} className="text-sm font-medium text-slate-100 hover:text-violet-300 transition-colors">
                {map.title || map.id}
              </Link>
              {loadedVersionNum && (
                <span className="text-xs bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded">v{loadedVersionNum}</span>
              )}
              <button
                onClick={() => setShowMeta((s) => !s)}
                className="ml-auto text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                {showMeta ? 'Hide metadata ▲' : 'Edit metadata ▼'}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <MapSelector label="" selectedId={selectedMapId} onSelect={(id) => { onSelectMap(id); setLoadedVersionNum(null); setShowCreate(false); }} />
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((s) => !s)}
            title="Create a new ShExMap"
            className={`shrink-0 text-xs px-2.5 py-1.5 rounded border transition-colors ${showCreate ? 'bg-violet-600 text-white border-violet-500' : 'bg-slate-700 text-violet-300 border-slate-600 hover:bg-slate-600'}`}
          >
            + New
          </button>
        </div>
        {showCreate && (
          <CreateMapInlineForm
            initialContent={shexContent}
            onCreated={(id, content) => {
              onSelectMap(id);
              onShexContentChange(content);
              setShowCreate(false);
              setLoadedVersionNum(null);
            }}
            onCancel={() => setShowCreate(false)}
          />
        )}
        {showMeta && map && (
          <MapMetaForm
            map={map}
            onSave={(d) => updateMeta.mutate(d)}
            isSaving={updateMeta.isPending}
          />
        )}
      </div>

      {/* Monaco ShEx editor */}
      {selectedMapId ? (
        <ShExEditor
          value={shexContent}
          mapId={selectedMapId}
          fileName={map?.fileName}
          fileFormat={map?.fileFormat ?? 'shexc'}
          height={380}
          readOnly={false}
          varColorMap={varColorMap}
          serverVersions={serverVersions}
          onSaveServerVersion={(content, msg) => saveVersion.mutate({ content, commitMessage: msg })}
          isSavingServerVersion={saveVersion.isPending}
          onLoadServerVersion={handleLoadServerVersion}
          onChange={onShexContentChange}
        />
      ) : (
        <div className="flex items-center justify-center text-slate-400 text-sm" style={{ height: 380 }}>
          Select a ShExMap above
        </div>
      )}

      {/* Turtle data section */}
      <TurtlePanel
        mapId={selectedMapId}
        shexContent={shexContent}
        turtleContent={turtleContent}
        focusNode={focusNode}
        onChangeTurtle={onChangeTurtle}
        onChangeFocusNode={onChangeFocusNode}
        onValidate={handleSideValidate}
        isValidating={sideValidating}
        validationResult={sideResult}
        validationError={sideErr}
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CreatePairingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Load existing pairing if ?id= is present
  const editPairingId = searchParams.get('id') ?? '';
  const pairingQuery = useShExMapPairing(editPairingId);
  const pairingsListQuery = useShExMapPairings({ limit: 50 });
  const createPairing = useCreateShExMapPairing();
  const updatePairing = useUpdateShExMapPairing(editPairingId);

  // Source side
  const [srcMapId, setSrcMapId]           = useState('');
  const [srcShex, setSrcShex]             = useState('');
  const [srcTurtle, setSrcTurtle]         = useState('');
  const [srcFocus, setSrcFocus]           = useState('');

  // Target side
  const [tgtMapId, setTgtMapId]           = useState('');
  const [tgtShex, setTgtShex]             = useState('');
  const [tgtTurtle, setTgtTurtle]         = useState('');
  const [tgtFocus, setTgtFocus]           = useState('');

  // Pairing metadata
  const [pairingTitle, setPairingTitle]       = useState('');
  const [pairingDesc, setPairingDesc]         = useState('');
  const [pairingTags, setPairingTags]         = useState('');
  const [pairingVersion, setPairingVersion]   = useState('1.0.0');
  const [pairingLicense, setPairingLicense]   = useState('');

  // Validation
  const [direction, setDirection]     = useState<'src-to-tgt' | 'tgt-to-src'>('src-to-tgt');
  const [validating, setValidating]   = useState(false);
  const [validationErr, setValidationErr] = useState('');
  const [result, setResult]           = useState<ValidationResult | null>(null);

  const [saveFlash, setSaveFlash]     = useState(false);
  const [savedPairingId, setSavedPairingId] = useState('');
  const [commitMsg, setCommitMsg]     = useState('');

  // Pairing version history
  const pairingVersionsQuery = useShExMapPairingVersions(editPairingId);
  const savePairingVersion   = useSaveShExMapPairingVersion(editPairingId);
  const [showPairingHistory, setShowPairingHistory] = useState(false);

  // Populate from existing pairing — only once on initial load, not after saves
  const pairingPopulated = useRef(false);
  useEffect(() => {
    const p = pairingQuery.data;
    if (!p || pairingPopulated.current) return;
    pairingPopulated.current = true;
    setPairingTitle(p.title);
    setPairingDesc(p.description ?? '');
    setPairingTags(p.tags.join(', '));
    setPairingVersion(p.version);
    setPairingLicense(p.license ?? '');
    setSrcMapId(p.sourceMap.id);
    setTgtMapId(p.targetMap.id);
    if (p.sourceMap.content) setSrcShex(p.sourceMap.content);
    if (p.targetMap.content) setTgtShex(p.targetMap.content);
    if (p.sourceFocusIri) setSrcFocus(p.sourceFocusIri);
    if (p.targetFocusIri) setTgtFocus(p.targetFocusIri);
  }, [pairingQuery.data]);

  // Reset the populated flag when the pairing id changes (user selects a different pairing)
  useEffect(() => {
    pairingPopulated.current = false;
  }, [editPairingId]);

  // Shared variable colour map (matched vars only)
  const varColorMap = useMemo<Map<string, number>>(() => {
    if (!srcShex || !tgtShex) return new Map();
    return buildVarColorMap(srcShex, tgtShex);
  }, [srcShex, tgtShex]);

  // Determine which ShEx/Turtle to use for validation depending on direction
  const activeSourceShex   = direction === 'src-to-tgt' ? srcShex : tgtShex;
  const activeSourceTurtle = direction === 'src-to-tgt' ? srcTurtle : tgtTurtle;
  const activeSourceFocus  = direction === 'src-to-tgt' ? srcFocus : tgtFocus;
  const activeTargetShex   = direction === 'src-to-tgt' ? tgtShex : srcShex;

  const handleValidate = useCallback(async (materialize: boolean) => {
    const missing: string[] = [];
    if (!activeSourceShex)   missing.push(`${direction === 'src-to-tgt' ? 'source' : 'target'} ShEx content`);
    if (!activeSourceTurtle) missing.push(`${direction === 'src-to-tgt' ? 'source' : 'target'} Turtle data`);
    if (!activeSourceFocus)  missing.push('focus IRI');
    if (missing.length > 0) {
      setValidationErr(`Missing: ${missing.join(', ')}.`);
      return;
    }
    setValidating(true);
    setValidationErr('');
    setResult(null);
    try {
      const { data } = await axios.post<ValidationResult>('/api/v1/validate', {
        sourceShEx: activeSourceShex,
        sourceRdf: activeSourceTurtle,
        sourceNode: activeSourceFocus,
        ...(materialize && activeTargetShex ? { targetShEx: activeTargetShex } : {}),
      });
      setResult(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setValidationErr(err.response?.data?.error ?? err.message ?? 'Validation failed');
    } finally {
      setValidating(false);
    }
  }, [activeSourceShex, activeSourceTurtle, activeSourceFocus, activeTargetShex]);

  function downloadPairingJson(pairingId: string) {
    const bundle = {
      id: pairingId,
      title: pairingTitle,
      description: pairingDesc || undefined,
      version: pairingVersion,
      license: pairingLicense || undefined,
      tags: pairingTags.split(',').map((t) => t.trim()).filter(Boolean),
      sourceMap: { id: srcMapId, content: srcShex, sampleData: srcTurtle || undefined, focusIri: srcFocus || undefined },
      targetMap: { id: tgtMapId, content: tgtShex, sampleData: tgtTurtle || undefined, focusIri: tgtFocus || undefined },
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pairingTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-pairing.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSavePairing() {
    if (!pairingTitle || !srcMapId || !tgtMapId) return;
    const tags = pairingTags.split(',').map((t) => t.trim()).filter(Boolean);
    const payload = {
      title: pairingTitle,
      description: pairingDesc || undefined,
      sourceMapId: srcMapId,
      targetMapId: tgtMapId,
      sourceFocusIri: srcFocus || undefined,
      targetFocusIri: tgtFocus || undefined,
      tags,
      version: pairingVersion,
      license: pairingLicense || undefined,
    };

    if (editPairingId) {
      await updatePairing.mutateAsync(payload);
      await savePairingVersion.mutateAsync({ commitMessage: commitMsg.trim() || undefined });
      setCommitMsg('');
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2000);
    } else {
      const p = await createPairing.mutateAsync(payload);
      setSavedPairingId(p.id);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 2000);
    }
  }

  const isSavingPairing = createPairing.isPending || updatePairing.isPending || savePairingVersion.isPending;
  const saveError = createPairing.error || updatePairing.error;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <nav className="text-sm text-slate-400 mb-2">
          <Link to="/" className="hover:text-violet-600 transition-colors">Home</Link>
          <span className="mx-2">›</span>
          {editPairingId
            ? <><Link to={`/pairings/${editPairingId}`} className="hover:text-violet-600">Pairing</Link><span className="mx-2">›</span><span className="text-slate-600">Edit</span></>
            : <span className="text-slate-600">Create Pairing</span>}
        </nav>
        <h1 className="text-2xl font-bold text-slate-900">
          {editPairingId ? 'Edit ShExMap Pairing' : 'Create ShExMap Pairing'}
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Compose a bidirectional ShEx mapping: select two ShExMaps, highlight shared variables, validate with sample data, and save.
        </p>
      </div>

      {/* Load existing pairing (quick-load bar) */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Load existing pairing to edit</div>
        <div className="flex items-center gap-3">
          <select
            value={editPairingId}
            onChange={(e) => {
              const v = e.target.value;
              if (v) navigate(`/pairings/create?id=${v}`);
              else navigate('/pairings/create');
            }}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none"
          >
            <option value="">— or start fresh —</option>
            {pairingsListQuery.data?.items.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          {editPairingId && (
            <Link to={`/pairings/${editPairingId}`} className="text-xs text-violet-600 hover:text-violet-700 shrink-0">
              View →
            </Link>
          )}
        </div>
      </section>

      {/* ─── 1 & 2: Side-by-side ShExMap editors ──────────────────────────── */}
      <section className="space-y-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          1 &amp; 2. ShExMap Files
        </div>
        <div className="flex flex-col lg:flex-row gap-4">
          <ShExMapSidePanel
            role="Source"
            selectedMapId={srcMapId}
            onSelectMap={setSrcMapId}
            shexContent={srcShex}
            onShexContentChange={setSrcShex}
            varColorMap={varColorMap}
            turtleContent={srcTurtle}
            focusNode={srcFocus}
            onChangeTurtle={setSrcTurtle}
            onChangeFocusNode={setSrcFocus}
          />
          <ShExMapSidePanel
            role="Target"
            selectedMapId={tgtMapId}
            onSelectMap={setTgtMapId}
            shexContent={tgtShex}
            onShexContentChange={setTgtShex}
            varColorMap={varColorMap}
            turtleContent={tgtTurtle}
            focusNode={tgtFocus}
            onChangeTurtle={setTgtTurtle}
            onChangeFocusNode={setTgtFocus}
          />
        </div>
      </section>

      {/* Variable legend */}
      <VariableLegend srcContent={srcShex} tgtContent={tgtShex} varColorMap={varColorMap} />

      {/* ─── 3. Validate & Materialise ──────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 space-y-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          3. Validate &amp; Materialise
        </div>

        {/* Direction toggle */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 font-medium">Direction:</span>
          <button
            onClick={() => setDirection('src-to-tgt')}
            className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors border ${direction === 'src-to-tgt' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
          >
            Source → Target
          </button>
          <button
            onClick={() => setDirection('tgt-to-src')}
            className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors border ${direction === 'tgt-to-src' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
          >
            Target → Source
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => handleValidate(false)}
            disabled={validating}
            className="bg-violet-600 hover:bg-violet-500 text-white font-medium px-5 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {validating ? 'Running…' : 'Validate'}
          </button>
          {activeTargetShex && (
            <button
              onClick={() => handleValidate(true)}
              disabled={validating}
              className="bg-violet-800 hover:bg-violet-700 text-white font-medium px-5 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {validating ? 'Running…' : 'Validate & Materialise →'}
            </button>
          )}
          {!activeSourceShex && <span className="text-xs text-slate-400 italic">Select both ShExMaps and add Turtle data to validate.</span>}
        </div>

        {validationErr && (
          <div className="text-red-700 text-sm bg-red-50 border border-red-200 px-4 py-3 rounded-lg">{validationErr}</div>
        )}
        {result && <ValidationPanel result={result} />}
      </section>

      {/* ─── 4. Pairing Metadata & Save ─────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 space-y-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          4. Pairing Metadata
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs text-slate-500 font-medium block mb-1">Title <span className="text-red-400">*</span></label>
            <input value={pairingTitle} onChange={(e) => setPairingTitle(e.target.value)}
              placeholder="e.g. FHIR Observation → OMOP Measurement"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-slate-500 font-medium block mb-1">Description</label>
            <textarea value={pairingDesc} onChange={(e) => setPairingDesc(e.target.value)}
              rows={2} placeholder="Optional description of this mapping"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium block mb-1">Tags</label>
            <input value={pairingTags} onChange={(e) => setPairingTags(e.target.value)}
              placeholder="fhir, omop, clinical (comma separated)"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium block mb-1">Version</label>
            <input value={pairingVersion} onChange={(e) => setPairingVersion(e.target.value)}
              placeholder="1.0.0"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-slate-500 font-medium block mb-1">License</label>
            <LicensePicker value={pairingLicense} onChange={setPairingLicense} />
          </div>
        </div>

        {/* Source/target map display */}
        <div className="flex gap-4 text-sm">
          <div className="flex-1 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-400 block mb-0.5">Source Map</span>
            {srcMapId ? <span className="text-slate-700 font-mono text-xs">{srcMapId}</span> : <span className="text-slate-400 italic text-xs">not selected</span>}
          </div>
          <div className="flex-1 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-400 block mb-0.5">Target Map</span>
            {tgtMapId ? <span className="text-slate-700 font-mono text-xs">{tgtMapId}</span> : <span className="text-slate-400 italic text-xs">not selected</span>}
          </div>
        </div>

        {saveError && (
          <div className="text-red-700 text-sm bg-red-50 border border-red-200 px-4 py-3 rounded-lg">
            {(saveError as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message ?? (saveError as { message?: string }).message ?? 'Save failed'}
          </div>
        )}

        {savedPairingId && (
          <div className="text-emerald-700 text-sm bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-lg flex items-center gap-3">
            <span>Pairing saved!</span>
            <Link to={`/pairings/${savedPairingId}`} className="font-medium underline hover:text-emerald-800">View pairing →</Link>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {editPairingId && (
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Change note (optional)"
              className="text-sm border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 w-52 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
            />
          )}
          <button
            onClick={handleSavePairing}
            disabled={isSavingPairing || !pairingTitle || !srcMapId || !tgtMapId}
            className={`font-medium px-6 py-2.5 text-sm rounded-lg transition-colors ${
              saveFlash ? 'bg-green-600 text-white' :
              'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40'
            }`}
          >
            {isSavingPairing ? 'Saving…' : saveFlash ? 'Saved!' : editPairingId ? 'Update Pairing' : 'Save Pairing'}
          </button>
          <button
            onClick={() => downloadPairingJson(editPairingId || savedPairingId)}
            disabled={!pairingTitle || !srcMapId || !tgtMapId || (!editPairingId && !savedPairingId)}
            title="Download pairing as JSON"
            className="font-medium px-4 py-2.5 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            ↓ Download
          </button>
          {(pairingVersionsQuery.data?.length ?? 0) > 0 && (
            <button
              onClick={() => setShowPairingHistory((s) => !s)}
              className="text-sm px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              History ({pairingVersionsQuery.data!.length})
            </button>
          )}
          {(!pairingTitle || !srcMapId || !tgtMapId) && (
            <span className="text-xs text-slate-400 italic">Title and both maps are required.</span>
          )}
        </div>

        {/* Pairing version history panel */}
        {showPairingHistory && editPairingId && (
          <PairingVersionHistory
            versions={pairingVersionsQuery.data ?? []}
          />
        )}
      </section>
    </div>
  );
}
