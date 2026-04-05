import { useState } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';

const PREFIXES = `PREFIX shexmap: <https://shexmap.example.org/ontology#>
PREFIX dct:     <http://purl.org/dc/terms/>
PREFIX xsd:     <http://www.w3.org/2001/XMLSchema#>

`;

const EXAMPLES: { label: string; description: string; query: string }[] = [
  {
    label: 'ShExMaps',
    description: 'A listing of the ShExMaps.',
    query:
      PREFIXES +
      `SELECT ?map ?mapTitle 
{
      ?map a shexmap:ShExMap ;
       dct:title ?mapTitle .

}
ORDER BY ?mapTitle`,
  },
  {
    label: 'Pairings, ShExMaps & Schemas',
    description: 'Expand each pairing to its source and target maps, plus the schema each map belongs to.',
    query:
      PREFIXES +
      `SELECT ?pairingTitle ?srcTitle ?srcSchemaTitle ?tgtTitle ?tgtSchemaTitle WHERE {
  ?pairing a shexmap:ShExMapPairing ;
           dct:title ?pairingTitle ;
           shexmap:sourceMap ?srcMap ;
           shexmap:targetMap ?tgtMap .
  ?srcMap dct:title ?srcTitle .
  ?tgtMap dct:title ?tgtTitle .
  OPTIONAL {
    ?srcMap shexmap:hasSchema ?srcSchema .
    ?srcSchema dct:title ?srcSchemaTitle .
  }
  OPTIONAL {
    ?tgtMap shexmap:hasSchema ?tgtSchema .
    ?tgtSchema dct:title ?tgtSchemaTitle .
  }
}
ORDER BY ?pairingTitle`,
  },
];

const DEFAULT_QUERY = EXAMPLES[0]!.query;

interface SparqlResult {
  head: { vars: string[] };
  results: { bindings: Record<string, { type: string; value: string }>[] };
}

export default function SparqlPage() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [activeExample, setActiveExample] = useState<number>(0);
  const [result, setResult] = useState<SparqlResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadExample = (idx: number) => {
    setActiveExample(idx);
    setQuery(EXAMPLES[idx]!.query);
    setResult(null);
    setError('');
  };

  const runQuery = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/sparql', {
        params: { query },
        headers: { Accept: 'application/sparql-results+json' },
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">SPARQL Query</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Query the ShExMap repository directly using SPARQL 1.1. Endpoint:{' '}
          <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-xs">/sparql</code>
        </p>
      </div>

      {/* Example queries */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Example Queries</div>
        <div className="flex flex-col gap-2">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => loadExample(i)}
              className={`text-left rounded-lg border px-4 py-3 transition-all ${
                activeExample === i
                  ? 'border-violet-400 bg-violet-50'
                  : 'border-slate-200 hover:border-violet-300 hover:bg-slate-50'
              }`}
            >
              <div className={`text-sm font-semibold ${activeExample === i ? 'text-violet-700' : 'text-slate-700'}`}>
                {i + 1}. {ex.label}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{ex.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="bg-slate-800 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">
          Query Editor
        </div>
        <Editor
          height="280px"
          defaultLanguage="sparql"
          value={query}
          onChange={(val) => { setQuery(val ?? ''); setActiveExample(-1); }}
          options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13 }}
          theme="vs-dark"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={runQuery}
          disabled={loading}
          className="bg-violet-600 hover:bg-violet-500 text-white font-medium px-5 py-2.5 text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Running…' : 'Run Query'}
        </button>
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 p-3 rounded-lg">{error}</div>}

      {result && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {result.head.vars.map((v) => (
                    <th key={v} className="py-2.5 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.results.bindings.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    {result.head.vars.map((v) => (
                      <td key={v} className="py-2 px-4 text-slate-700 max-w-xs truncate font-mono text-xs">
                        {row[v]?.value ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-100">
            {result.results.bindings.length} result{result.results.bindings.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
