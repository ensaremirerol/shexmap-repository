import { useState } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { useShExMaps, useShExMapPairings } from '../api/shexmaps.js';

function CopyUuidButton({ uuid }: { uuid: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(uuid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy user ID"
      className="ml-1.5 text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export default function DashboardPage() {
  const { user, isAuthenticated } = useAuthStore();
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';

  const { data: myMaps } = useShExMaps(
    isAuthenticated && user ? { author: user.sub, limit: 50 } : {}
  );

  const { data: myPairings } = useShExMapPairings(
    isAuthenticated && user ? { author: user.sub, limit: 50 } : {}
  );

  if (authEnabled && !isAuthenticated) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">Please sign in to view your dashboard.</p>
        <a href="/api/v1/auth/login?provider=github" className="bg-indigo-600 text-white px-4 py-2 rounded-md">
          Sign in with GitHub
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {user ? `${user.name}'s Dashboard` : 'Dashboard'}
        </h1>
        {user && (
          <div className="mt-1 flex items-center text-sm text-gray-400">
            <span className="font-mono">{user.sub}</span>
            <CopyUuidButton uuid={user.sub} />
          </div>
        )}
      </div>

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          My ShExMaps ({myMaps?.total ?? 0})
        </h2>
        {myMaps?.items.length === 0 && (
          <p className="text-gray-500 text-sm">No ShExMaps submitted yet.</p>
        )}
        <div className="space-y-2">
          {myMaps?.items.map((map) => (
            <a
              key={map.id}
              href={`/maps/${map.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-3 hover:border-indigo-300"
            >
              <div className="font-medium text-gray-900">{map.title}</div>
              <div className="text-sm text-gray-500">
                v{map.version} · {new Date(map.modifiedAt).toLocaleDateString()}
              </div>
            </a>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          My Pairings ({myPairings?.total ?? 0})
        </h2>
        {myPairings?.items.length === 0 && (
          <p className="text-gray-500 text-sm">No pairings submitted yet.</p>
        )}
        <div className="space-y-2">
          {myPairings?.items.map((pairing) => (
            <a
              key={pairing.id}
              href={`/pairings/${pairing.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-3 hover:border-indigo-300"
            >
              <div className="font-medium text-gray-900">{pairing.title}</div>
              <div className="text-sm text-gray-500">
                {new Date(pairing.createdAt).toLocaleDateString()}
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
