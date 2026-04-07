import { Link, NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';

const NAV_LINKS = [
  { to: '/browse', label: 'Browse' },
  { to: '/pairings/create', label: 'Create' },
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
          {/* <Link
            to="/submit"
            className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-1.5 rounded-md transition-colors"
          >
            + Submit Map
          </Link> */}

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
                href="/api/v1/auth/login?provider=github"
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Sign in
              </a>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
