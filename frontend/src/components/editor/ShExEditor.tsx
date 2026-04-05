/**
 * ShExEditor — Monaco-based editor with:
 *  - ShEx language support (syntax highlighting, completions, diagnostics)
 *  - Colour-coded variable annotation decorations
 *  - Toggleable edit/read-only mode
 *  - Local version history saved to localStorage
 *  - Download current content as a file
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import { registerShexLanguage, SHEXC_LANGUAGE_ID } from '../../utils/shexLanguage.js';
import { injectVarColors, extractVars } from '../../utils/varColors.js';

// ─── Local version store ──────────────────────────────────────────────────────

export interface LocalVersion {
  id: string;          // ShExMap id (or synthetic key)
  version: string;     // semver label
  content: string;
  savedAt: string;     // ISO timestamp
}

const STORAGE_KEY = 'shexmap-local-versions';

function loadVersions(mapId: string): LocalVersion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as LocalVersion[];
    return all.filter((v) => v.id === mapId).sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
    );
  } catch {
    return [];
  }
}

function saveVersion(entry: LocalVersion) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all: LocalVersion[] = raw ? (JSON.parse(raw) as LocalVersion[]) : [];
    all.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // quota exceeded etc. — ignore
  }
}

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ServerVersion {
  versionNumber: number;
  commitMessage?: string;
  authorName: string;
  createdAt: string;
}

export interface ShExEditorProps {
  /** Value shown / edited */
  value: string;
  /** ShExMap ID used as localStorage key for version history */
  mapId: string;
  /** Suggested filename for downloads (default: "<mapId>.shex") */
  fileName?: string;
  /** File format — 'shexc' | 'shexj'. Drives language selection. Default: 'shexc' */
  fileFormat?: string;
  /** Height of the editor area. Default: 400 */
  height?: number;
  /** If true the editor starts in read-only mode (default: true) */
  readOnly?: boolean;
  /** Map of variable → color-palette index for decoration highlights */
  varColorMap?: Map<string, number>;
  /** Called when the user saves a new version locally */
  onVersionSaved?: (entry: LocalVersion) => void;
  /** Server-side version list (from API) */
  serverVersions?: ServerVersion[];
  /** Save current content as a new server version */
  onSaveServerVersion?: (content: string, commitMessage?: string) => void;
  /** True while a server save is in flight */
  isSavingServerVersion?: boolean;
  /** Load a specific server version number into the editor */
  onLoadServerVersion?: (versionNumber: number) => void;
  /** Called on every content change (live, debounce-free) */
  onChange?: (content: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShExEditor({
  value,
  mapId,
  fileName,
  fileFormat = 'shexc',
  height = 400,
  readOnly: initialReadOnly = true,
  varColorMap,
  onVersionSaved,
  serverVersions,
  onSaveServerVersion,
  isSavingServerVersion,
  onLoadServerVersion,
  onChange,
}: ShExEditorProps) {
  const monaco = useMonaco();
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<MonacoType.editor.IEditorDecorationsCollection | null>(null);

  const [readOnly, setReadOnly] = useState(initialReadOnly);
  const [localContent, setLocalContent] = useState(value);
  const [isDirty, setIsDirty] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState<'server' | 'local'>('server');
  const [savedVersions, setSavedVersions] = useState<LocalVersion[]>(() => loadVersions(mapId));
  const [saveFlash, setSaveFlash] = useState(false);
  const [serverSaveFlash, setServerSaveFlash] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

  // When a different map is loaded, reset dirty state so external value can sync in.
  useEffect(() => {
    setIsDirty(false);
  }, [mapId]);

  // Suppress the Monaco onChange that fires when we programmatically update localContent.
  // Without this, the programmatic update sets isDirty=true and blocks future external syncs.
  const skipOnChangeRef = useRef(false);

  // Keep localContent in sync when the upstream value prop changes (e.g. data loads).
  // Only set the skip flag when the content actually changes — if value already matches
  // localContent, setLocalContent is a no-op and Monaco never fires onChange to reset
  // the flag, leaving it stuck true and silently swallowing the next user paste/edit.
  useEffect(() => {
    if (!isDirty) {
      setLocalContent((prev) => {
        if (prev === value) return prev; // no change — skip flag not needed
        skipOnChangeRef.current = true;
        return value;
      });
    }
    // localContent intentionally excluded: we read prev via the updater form instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, isDirty]);

  // Register ShEx language once Monaco is ready
  useEffect(() => {
    if (monaco) {
      registerShexLanguage(monaco);
    }
  }, [monaco]);

  // Apply purple highlight decorations for matched variables
  const applyDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    injectVarColors();
    decorationsRef.current?.clear();
    if (!varColorMap || varColorMap.size === 0) return;
    const model = editor.getModel();
    if (!model) return;
    const newDecos: MonacoType.editor.IModelDeltaDecoration[] = [];
    for (const [varName] of varColorMap) {
      for (const match of model.findMatches(varName, true, false, true, null, true)) {
        newDecos.push({
          range: match.range,
          options: { inlineClassName: 'shex-var-matched' },
        });
      }
    }
    decorationsRef.current = editor.createDecorationsCollection(newDecos);
  }, [varColorMap]);

  useEffect(() => {
    applyDecorations();
  }, [applyDecorations, localContent]);

  // ── Edit / read-only toggle ────────────────────────────────────────────────

  function handleToggleEdit() {
    const next = !readOnly;
    setReadOnly(next);
    editorRef.current?.updateOptions({ readOnly: next });
  }

  // ── Save local draft version ───────────────────────────────────────────────

  function handleSaveVersion() {
    const content = editorRef.current?.getValue() ?? localContent;
    const label = versionLabel.trim() || new Date().toISOString();
    const entry: LocalVersion = {
      id: mapId,
      version: label,
      content,
      savedAt: new Date().toISOString(),
    };
    saveVersion(entry);
    const versions = loadVersions(mapId);
    setSavedVersions(versions);
    setVersionLabel('');
    onVersionSaved?.(entry);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
  }

  // ── Save server version ────────────────────────────────────────────────────

  function handleSaveServerVersion() {
    const content = editorRef.current?.getValue() ?? localContent;
    onSaveServerVersion?.(content, commitMessage.trim() || undefined);
    setCommitMessage('');
    setServerSaveFlash(true);
    setTimeout(() => setServerSaveFlash(false), 1500);
  }

  // ── Load a saved version into the editor ──────────────────────────────────

  function handleLoadVersion(v: LocalVersion) {
    setLocalContent(v.content);
    editorRef.current?.setValue(v.content);
    setIsDirty(true);
    setShowVersionHistory(false);
  }

  // ── Download current content ───────────────────────────────────────────────

  function handleDownload() {
    const content = editorRef.current?.getValue() ?? localContent;
    const name = fileName ?? `${mapId}.shex`;
    downloadText(content, name);
  }

  // ── Language selection ─────────────────────────────────────────────────────
  const language = fileFormat === 'shexj' ? 'json' : SHEXC_LANGUAGE_ID;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap bg-slate-800 px-3 py-2 rounded-none">
        {/* Edit / view toggle */}
        <button
          onClick={handleToggleEdit}
          className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
            readOnly
              ? 'bg-slate-600 text-slate-300 hover:bg-slate-500'
              : 'bg-violet-600 text-white hover:bg-violet-500'
          }`}
        >
          {readOnly ? 'Edit' : 'Editing'}
        </button>

        {/* Save controls in edit mode */}
        {!readOnly && (
          <>
            {/* Local draft save */}
            <input
              type="text"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="draft label"
              className="text-xs bg-slate-700 text-slate-200 placeholder-slate-400 border border-slate-600 rounded px-2 py-1 w-28 focus:outline-none focus:border-violet-400"
            />
            <button
              onClick={handleSaveVersion}
              title="Save draft locally in browser"
              className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
                saveFlash ? 'bg-green-600 text-white' : 'bg-slate-600 text-slate-200 hover:bg-slate-500'
              }`}
            >
              {saveFlash ? 'Saved!' : 'Save draft'}
            </button>

            {/* Server version save */}
            {onSaveServerVersion && (
              <>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="commit message (optional)"
                  className="text-xs bg-slate-700 text-slate-200 placeholder-slate-400 border border-slate-600 rounded px-2 py-1 w-44 focus:outline-none focus:border-violet-400"
                />
                <button
                  onClick={handleSaveServerVersion}
                  disabled={isSavingServerVersion}
                  title="Save as a permanent server version"
                  className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
                    serverSaveFlash
                      ? 'bg-green-600 text-white'
                      : isSavingServerVersion
                        ? 'bg-violet-800 text-violet-300 cursor-not-allowed'
                        : 'bg-violet-600 text-white hover:bg-violet-500'
                  }`}
                >
                  {isSavingServerVersion ? 'Saving…' : serverSaveFlash ? 'Saved!' : '↑ Save to server'}
                </button>
              </>
            )}
          </>
        )}

        {/* Version history button */}
        {(savedVersions.length > 0 || (serverVersions && serverVersions.length > 0)) && (
          <button
            onClick={() => setShowVersionHistory((s) => !s)}
            className="text-xs px-3 py-1 rounded font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
          >
            History {serverVersions && serverVersions.length > 0 ? `(${serverVersions.length})` : `(${savedVersions.length})`}
          </button>
        )}

        {/* Download */}
        <button
          onClick={handleDownload}
          className="text-xs px-3 py-1 rounded font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors ml-auto"
        >
          ↓ Download
        </button>

        {/* Dirty indicator */}
        {isDirty && !readOnly && (
          <span className="text-xs text-amber-400 font-medium">unsaved changes</span>
        )}
      </div>

      {/* Variable legend — all vars extracted from this content */}
      <VariableLegend localContent={localContent} varColorMap={varColorMap} />

      {/* Version history panel */}
      {showVersionHistory && (
        <div className="bg-slate-900 border-t border-slate-700 px-3 py-2 max-h-56 overflow-y-auto">
          {/* Tabs */}
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setHistoryTab('server')}
              className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                historyTab === 'server'
                  ? 'bg-violet-700 text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Server {serverVersions ? `(${serverVersions.length})` : ''}
            </button>
            <button
              onClick={() => setHistoryTab('local')}
              className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                historyTab === 'local'
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Local drafts ({savedVersions.length})
            </button>
          </div>

          {/* Server versions */}
          {historyTab === 'server' && (
            <div className="space-y-1">
              {!serverVersions || serverVersions.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No server versions yet. Edit and click "↑ Save to server" to create one.</p>
              ) : (
                [...serverVersions].reverse().map((v) => (
                  <div key={v.versionNumber} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-violet-300 shrink-0">v{v.versionNumber}</span>
                    <span className="text-slate-400 truncate flex-1">
                      {v.commitMessage ?? <span className="italic text-slate-600">no message</span>}
                    </span>
                    <span className="text-slate-500 shrink-0">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => {
                        onLoadServerVersion?.(v.versionNumber);
                        setShowVersionHistory(false);
                      }}
                      className="text-violet-400 hover:text-violet-300 transition-colors shrink-0"
                    >
                      Load
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Local drafts */}
          {historyTab === 'local' && (
            <div className="space-y-1">
              {savedVersions.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No local drafts saved.</p>
              ) : (
                savedVersions.map((v) => (
                  <div key={v.savedAt} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-300">{v.version}</span>
                    <span className="text-slate-500">
                      {new Date(v.savedAt).toLocaleString()}
                    </span>
                    <div className="flex gap-1 ml-auto">
                      <button
                        onClick={() => handleLoadVersion(v)}
                        className="text-violet-400 hover:text-violet-300 transition-colors"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => downloadText(v.content, fileName ?? `${mapId}-${v.version}.shex`)}
                        className="text-slate-400 hover:text-slate-300 transition-colors"
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Monaco editor */}
      <Editor
        height={height}
        language={language}
        value={localContent}
        theme="shex-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'on',
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          parameterHints: { enabled: true },
        }}
        onMount={(editor) => {
          editorRef.current = editor;
          editor.updateOptions({ readOnly });
          applyDecorations();
        }}
        onChange={(val) => {
          if (val !== undefined) {
            if (skipOnChangeRef.current) {
              // Programmatic update from value prop sync — don't mark dirty or notify parent.
              skipOnChangeRef.current = false;
              return;
            }
            setLocalContent(val);
            setIsDirty(true);
            onChange?.(val);
          }
        }}
      />
    </div>
  );
}

// ─── Variable legend ──────────────────────────────────────────────────────────

function VariableLegend({
  localContent,
  varColorMap,
}: {
  localContent: string;
  varColorMap?: Map<string, number>;
}) {
  const allVars = useMemo(() => extractVars(localContent), [localContent]);
  if (allVars.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-1.5 bg-slate-900 border-t border-slate-700">
      {allVars.map((varName) => {
        const matched = varColorMap?.has(varName) ?? false;
        return matched ? (
          <span
            key={varName}
            title="Matched in paired schema"
            className="text-xs font-mono px-1.5 py-0.5 rounded text-violet-200"
            style={{ background: 'rgba(139,92,246,0.25)', borderBottom: '2px solid #7c3aed' }}
          >
            {varName}
          </span>
        ) : (
          <span
            key={varName}
            title="Not matched in paired schema"
            className="text-xs font-mono px-1.5 py-0.5 rounded text-slate-500"
            style={{ background: 'rgba(100,116,139,0.15)', borderBottom: '2px solid #475569' }}
          >
            {varName}
          </span>
        );
      })}
    </div>
  );
}
