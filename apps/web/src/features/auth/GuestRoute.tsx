import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { FullPageLoader } from '@/components/layout/FullPageLoader';
import { useAuthStore } from '@/stores/auth';

import { getRedirectTarget } from './redirect';

/** Pages for guests only (login, register); a logged-in user is sent on to the app. */
export function GuestRoute({ children }: { children?: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'idle' || status === 'loading') {
    return <FullPageLoader label="Restoring session..." />;
  }
  if (status === 'authenticated') {
    return <Navigate to={getRedirectTarget(location.state)} replace />;
  }
  return children ?? <Outlet />;
}
