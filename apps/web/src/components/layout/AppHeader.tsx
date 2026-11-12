import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logout } from '@/features/auth/authApi';
import { HOME_PATH, LOGIN_PATH } from '@/features/auth/redirect';
import { useAuthStore } from '@/stores/auth';

import { Logo } from './Logo';
import { ThemeSwitcher } from './ThemeSwitcher';

/** Top bar of the authenticated app: logo, theme and the account menu. */
export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-surface px-4">
      <nav aria-label="Main">
        <Link
          to={HOME_PATH}
          aria-label="StreamLine, your boards"
          className="flex items-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Logo />
        </Link>
      </nav>
      <div className="flex items-center gap-1">
        <ThemeSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}

function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    await navigate(LOGIN_PATH, { replace: true });
  };

  if (!user) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-1 rounded-full"
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar userId={user.id} name={user.name} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 font-normal">
          <Avatar userId={user.id} name={user.name} aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{user.name}</span>
            <span className="truncate text-xs text-subtle">{user.email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isLoggingOut} onSelect={() => void handleLogout()}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
