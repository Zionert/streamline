import { Outlet } from 'react-router';

import { AppHeader } from './AppHeader';

/** Shell of the authenticated part of the app: the top bar above a full-height page area. */
export function AppLayout() {
  return (
    <div className="flex h-svh flex-col bg-background">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
