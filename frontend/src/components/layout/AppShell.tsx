import { type ReactNode, useEffect } from 'react';
import NavBar from './NavBar.js';
import { useAuthStore } from '../../store/authStore.js';
import { fetchAuthStatus } from '../../api/auth.js';

export default function AppShell({ children }: { children: ReactNode }) {
  const { setUser, clearAuth } = useAuthStore();

  useEffect(() => {
    fetchAuthStatus()
      .then((status) => {
        if (status.authenticated && status.user) {
          setUser({
            sub: status.user.sub,
            name: status.user.name ?? status.user.sub,
            email: status.user.email,
          });
        } else {
          clearAuth();
        }
      })
      .catch(() => clearAuth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <NavBar />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-7xl">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white py-5 text-center text-sm text-slate-400">
        ShExMap Repository <br />
        Conceived by <a href="https://github.com/micheldumontier/" className="text-violet-600 hover:underline" target="_blank" rel="noreferrer">Michel Dumontier</a>.
        Built with <a href="https://code.claude.com/docs/en/overview" className="text-violet-600 hover:underline" target="_blank" rel="noreferrer">Claude Code</a>.
        Powered by{' '}
        <a href="http://shex.io" className="text-violet-600 hover:underline" target="_blank" rel="noreferrer">ShEx</a>{' '}
        &amp; <a href="https://github.com/ad-freiburg/qlever" className="text-violet-600 hover:underline" target="_blank" rel="noreferrer">QLever</a>
        <br/>
        Source code at <a href="https://github.com/micheldumontier/shexmap-repository" className="text-violet-600 hover:underline" target="_blank" rel="noreferrer">GitHub</a>.
      </footer>
    </div>
  );
}
