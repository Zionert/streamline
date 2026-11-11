import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { FullPageLoader } from '@/components/layout/FullPageLoader';
import { useAuthStore } from '@/stores/auth';

import { LOGIN_PATH, type AuthRedirectState } from './redirect';

/** Renders its children (or nested routes) only for an authenticated user. */
export function ProtectedRoute({ children }: { children?: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return <FullPageLoader label="Restoring session..." />;
  }
  if (status === 'unauthenticated') {
    const state: AuthRedirectState = {
      from: { pathname: location.pathname, search: location.search, hash: location.hash },
    };
    return <Navigate to={LOGIN_PATH} replace state={state} />;
  }
  return children ?? <Outlet />;
}
