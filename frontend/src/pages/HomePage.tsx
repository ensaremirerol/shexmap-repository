import { Link } from 'react-router-dom';
import { useSchemas, useShExMapPairings, useShExMaps } from '../api/shexmaps.js';

export default function HomePage() {
  const { data: maps } = useShExMaps({ limit: 5, sort: 'modified' });
  const { data: _schemas } = useSchemas();
  const { data: pairings } = useShExMapPairings({ limit: 5, sort: 'modified' });


  return (
    <div className="space-y-14">
      {/* Hero */}
      <section className="relative rounded-2xl overflow-hidden bg-slate-900 px-8 py-16 text-center">
        {/* subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'linear-gradient(rgba(139,92,246,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,.4) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 tracking-tight">
            ShEx<span className="text-violet-400">Map</span> Repository
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto mb-8 leading-relaxed">
            A community hub for ShExMaps — bidirectional mappings between RDF shapes.
          </p>
                    <span className="inline-block mb-4 rounded-full bg-violet-900/60 border border-violet-700/50 px-3 py-1 text-xs font-medium text-violet-300 tracking-wide uppercase">
            Open Source
          </span>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link
              to="/browse"
              className="bg-violet-600 hover:bg-violet-500 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              Browse
            </Link>
            <Link
              to="/pairings/create"
              className="bg-violet-800 hover:bg-violet-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              Map
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 max-w-md mx-auto w-full">
        {[
          // { label: 'Schemas', value: schemas?.length, tab: 'schemas' },
          { label: 'Pairings', value: pairings?.total, tab: 'pairings' },
          { label: 'ShExMap Files', value: maps?.total, tab: 'shexmaps' },

        ].map(({ label, value, tab }) => (
          <Link
            key={label}
            to={`/browse?tab=${tab}`}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-center hover:border-violet-300 hover:shadow-md transition-all group"
          >
            <div className="text-3xl font-bold text-violet-600 group-hover:text-violet-700">
              {value ?? '—'}
            </div>
            <div className="text-sm text-slate-500 mt-1 font-medium">{label}</div>
          </Link>
        ))}
      </section>

      {/* Recently Updated */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-slate-800">Recently Updated</h2>
          <Link to="/browse" className="text-sm text-violet-600 hover:text-violet-700 font-medium">
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Pairings column */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Pairings</h3>
            {pairings?.items.length === 0 && (
              <p className="text-sm text-slate-400">No pairings yet.</p>
            )}
            {pairings?.items.map((p) => (
              <Link
                key={p.id}
                to={`/pairings/create?id=${p.id}`}
                className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 hover:border-blue-300 hover:shadow-md transition-all group"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 group-hover:text-blue-700 transition-colors truncate">
                    {p.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    by {p.authorName} · {new Date(p.modifiedAt).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-slate-300 group-hover:text-blue-400 text-lg transition-colors shrink-0 ml-3">→</span>
              </Link>
            ))}
          </div>

          {/* ShExMaps column */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">ShExMaps</h3>
            {maps?.items.length === 0 && (
              <p className="text-sm text-slate-400">No ShExMaps yet.</p>
            )}
            {maps?.items.map((m) => (
              <Link
                key={m.id}
                to={`/maps/${m.id}`}
                className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 hover:border-violet-300 hover:shadow-md transition-all group"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 group-hover:text-violet-700 transition-colors truncate">
                    {m.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    by {m.authorName} · {new Date(m.modifiedAt).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-slate-300 group-hover:text-violet-400 text-lg transition-colors shrink-0 ml-3">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
