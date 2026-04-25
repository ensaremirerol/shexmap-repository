import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { fetchAuthStatus } from '../api/auth.js';

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const { setUser } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetchAuthStatus()
      .then((status) => {
        if (status.authenticated && status.user) {
          setUser({
            sub: status.user.sub,
            name: status.user.name ?? status.user.sub,
            email: status.user.email,
          });
          const searchParams = new URLSearchParams(window.location.search);
          navigate(searchParams.get('redirect') ?? '/dashboard', { replace: true });
        } else {
          setError('Authentication failed. Please try signing in again.');
        }
      })
      .catch(() => setError('An error occurred during sign-in. Please try again.'));
  }, [navigate, setUser]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-red-600 text-sm">{error}</p>
        <a
          href="/api/v1/auth/login/github"
          className="text-sm text-violet-600 hover:underline"
        >
          Try signing in again
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <svg
        className="animate-spin h-8 w-8 text-violet-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-label="Loading"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-slate-500 text-sm">Signing you in…</p>
    </div>
  );
}
