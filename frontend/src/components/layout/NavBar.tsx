import { Link, NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';

const NAV_LINKS = [
  { to: '/browse', label: 'Browse' },
  // { to: '/coverage', label: 'Coverage' },
  { to: '/query', label: 'SPARQL' },
];

const EXTERNAL_LINKS = [
  { href: '/api/v1/docs', label: 'API Docs' },
];

export default function NavBar() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';

  return (
    <nav className="bg-slate-900 border-b border-slate-800 px-4 py-0">
      <div className="container mx-auto max-w-7xl flex items-center gap-8 h-14">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <span className="text-white font-bold text-base tracking-tight">
            ShEx<span className="text-violet-400">Map</span>
          </span>
        </Link>

        <div className="flex gap-1 flex-1">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
          {EXTERNAL_LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium px-3 py-1.5 rounded-md transition-colors text-slate-400 hover:text-white hover:bg-slate-800"
            >
              {label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">

          <Link
            to="/pairings/create"
            className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
          >
            + New Pairing
          </Link>

          <Link
            to="/maps/new"
            className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
          >
            + New ShExMap
          </Link>

          {authEnabled && (
            isAuthenticated ? (
              <div className="flex items-center gap-3">
                <Link to="/dashboard" className="text-sm text-slate-300 hover:text-white transition-colors">
                  {user?.name ?? 'Dashboard'}
                </Link>
                <button
                  onClick={logout}
                  className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <a
                href="/api/v1/auth/login/github"
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors border border-slate-600"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                Sign in with GitHub
              </a>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
