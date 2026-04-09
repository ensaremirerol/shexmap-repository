import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ShExEditor from '../components/editor/ShExEditor.js';
import { useCreateShExMap } from '../api/shexmaps.js';
import {
  TurtlePanel,
  saveTurtle,
  saveFocus,
  type ValidationResult,
  type ValidationMode,
} from '../components/validation/TurtleValidationPanel.js';

export default function CreateMapPage() {
  const navigate = useNavigate();
  const createMap = useCreateShExMap();

  const [title, setTitle]       = useState('');
  const [desc, setDesc]         = useState('');
  const [tags, setTags]         = useState('');
  const [version, setVersion]   = useState('1.0.0');
  const [sourceUrl, setSourceUrl] = useState('');
  const [schemaUrl, setSchemaUrl] = useState('');
  const [content, setContent]   = useState('');

  const [turtle, setTurtle]         = useState('');
  const [focusNode, setFocusNode]   = useState('');
  const [activePanel, setActivePanel] = useState<'shex' | 'turtle'>('shex');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationError, setValidationError]   = useState('');

  const validationMode: ValidationMode =
    (content && turtle && focusNode) ? 'full' :
    (activePanel === 'turtle' || (content && turtle)) ? 'rdf' :
    'shex';

  const handleValidate = useCallback(async () => {
    setValidating(true);
    setValidationError('');
    setValidationResult(null);
    try {
      const mode: ValidationMode =
        (content && turtle && focusNode) ? 'full' :
        (activePanel === 'turtle' || (content && turtle)) ? 'rdf' :
        'shex';
      const body: Record<string, string> = { sourceShEx: content };
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
  }, [content, turtle, focusNode, activePanel]);

  const [errors, setErrors] = useState<{ title?: string; content?: string; api?: string }>({});

  async function handleCreate() {
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Title is required';
    if (!content.trim()) next.content = 'ShEx content is required';
    if (Object.keys(next).length) { setErrors(next); return; }
    setErrors({});

    try {
      const result = await createMap.mutateAsync({
        title: title.trim(),
        description: desc.trim() || undefined,
        content,
        sampleTurtleData: turtle.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        version: version.trim() || '1.0.0',
        sourceUrl: sourceUrl.trim() || undefined,
        schemaUrl: schemaUrl.trim() || undefined,
        fileFormat: 'shexc',
      });
      // Migrate localStorage entries from the temporary '__new__' key to the real map ID
      if (turtle) saveTurtle(result.id, turtle);
      if (focusNode) saveFocus(result.id, focusNode);
      navigate(`/maps/${result.id}`);
    } catch {
      setErrors({ api: 'Failed to create ShExMap. Please try again.' });
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-slate-400">
        <Link to="/browse" className="hover:text-violet-600 transition-colors">Browse</Link>
        <span className="mx-2">›</span>
        <span className="text-slate-600">New ShExMap</span>
      </nav>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">New ShExMap</h1>
        <p className="text-sm text-slate-400">Fill in the metadata and paste or write your ShEx content below.</p>
      </div>

      {/* Editor + form panel */}
      <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">

        {/* Dark form header */}
        <div className="bg-slate-800 px-4 py-3 space-y-2.5">
          {/* Row 1: title + version */}
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title *"
                className={`w-full bg-slate-700 text-slate-200 placeholder-slate-500 border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-400 ${
                  errors.title ? 'border-red-500' : 'border-slate-600'
                }`}
              />
              {errors.title && <p className="text-red-400 text-xs mt-0.5">{errors.title}</p>}
            </div>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
              className="w-20 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>

          {/* Row 2: description */}
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-400"
          />

          {/* Row 3: tags */}
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma separated, e.g. fhir, wikidata)"
            className="w-full bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-400"
          />

          {/* Row 4: URLs */}
          <div className="flex gap-2">
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Source URL (optional, e.g. https://...)"
              className="flex-1 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-400"
            />
            <input
              value={schemaUrl}
              onChange={(e) => setSchemaUrl(e.target.value)}
              placeholder="Schema URL (optional)"
              className="flex-1 bg-slate-700 text-slate-200 placeholder-slate-500 border border-slate-600 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-violet-400"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-0.5">
            <button
              onClick={handleCreate}
              disabled={createMap.isPending}
              className="text-sm px-4 py-1.5 rounded font-medium bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
            >
              {createMap.isPending ? 'Creating…' : 'Create Map'}
            </button>
            <Link
              to="/browse"
              className="text-sm px-4 py-1.5 rounded font-medium bg-slate-600 text-slate-300 hover:bg-slate-500 transition-colors"
            >
              Cancel
            </Link>
            {errors.content && <p className="text-red-400 text-xs">{errors.content}</p>}
            {errors.api && <p className="text-red-400 text-xs">{errors.api}</p>}
          </div>
        </div>

        {/* ShEx editor */}
        <ShExEditor
          value={content}
          mapId="__new__"
          fileName="new.shex"
          fileFormat="shexc"
          height={500}
          readOnly={false}
          onChange={setContent}
          onFocus={() => setActivePanel('shex')}
        />

        {/* Turtle + Focus IRI + Validate */}
        <TurtlePanel
          mapId="__new__"
          shexContent={content}
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
