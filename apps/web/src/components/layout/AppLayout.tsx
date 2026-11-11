import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { logout } from '@/features/auth/authApi';
import { LOGIN_PATH } from '@/features/auth/redirect';
import { useAuthStore } from '@/stores/auth';

/** Shell of the authenticated part of the app: header with the current user and logout. */
export function AppLayout() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    await navigate(LOGIN_PATH, { replace: true });
  };

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <span className="font-semibold">StreamLine</span>
        <div className="flex items-center gap-3 text-sm">
          {user && (
            <span>
              {user.name} <span className="text-muted-foreground">({user.email})</span>
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={isLoggingOut}
            onClick={() => void handleLogout()}
          >
            Log out
          </Button>
        </div>
      </header>
      <div className="flex flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
