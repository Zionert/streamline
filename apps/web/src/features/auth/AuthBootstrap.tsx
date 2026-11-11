import { Outlet } from 'react-router';

import { useSessionRestore } from './useSessionRestore';

/** Root layout route: starts session restoration once, then renders the matched route. */
export function AuthBootstrap() {
  useSessionRestore();
  return <Outlet />;
}
