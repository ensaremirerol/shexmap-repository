import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore.js';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (authEnabled && !isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
