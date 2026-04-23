import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { fetchAuthStatus } from '../api/auth.js';

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    async function handleCallback() {
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
      const token = params.get('token');

      if (!token) {
        navigate('/', { replace: true });
        return;
      }

      try {
        const status = await fetchAuthStatus(token);

        if (!status.authenticated || !status.user) {
          setError('Authentication failed. Please try signing in again.');
          return;
        }

        setToken(token, {
          sub: status.user.sub,
          name: status.user.name ?? status.user.sub,
          email: status.user.email,
        });

        // Clear the hash from the URL
        history.replaceState(null, '', window.location.pathname + window.location.search);

        // Redirect to intended destination or dashboard
        const searchParams = new URLSearchParams(window.location.search);
        const redirect = searchParams.get('redirect') ?? '/dashboard';
        navigate(redirect, { replace: true });
      } catch {
        setError('An error occurred during sign-in. Please try again.');
      }
    }

    handleCallback();
  }, [navigate, setToken]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-red-600 text-sm">{error}</p>
        <a
          href="/api/v1/auth/login?provider=github"
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
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <p className="text-slate-500 text-sm">Signing you in…</p>
    </div>
  );
}
