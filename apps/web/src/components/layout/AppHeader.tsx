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
import { BoardHeaderMembers, BoardHeaderNav } from '@/features/boards/BoardHeaderNav';
import { useCurrentBoard } from '@/features/boards/useCurrentBoard';
import { useAuthStore } from '@/stores/auth';

import { Logo } from './Logo';
import { ThemeSwitcher } from './ThemeSwitcher';

/**
 * Top bar of the authenticated app: logo, on board pages the board name, view tabs and members,
 * then the theme and the account menu.
 */
export function AppHeader() {
  const board = useCurrentBoard();

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-border bg-canvas px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <nav aria-label="Main" className="shrink-0">
          <Link
            to={HOME_PATH}
            aria-label="StreamLine, your boards"
            className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Logo />
          </Link>
        </nav>
        {/* Keyed by board, so the panels opened from the tabs never carry over to another board. */}
        {board && <BoardHeaderNav key={board.id} board={board} />}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ThemeSwitcher />
        {board && <BoardHeaderMembers />}
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
          size="icon-sm"
          className="rounded-full"
          aria-label={`Account menu for ${user.name}`}
        >
          <Avatar userId={user.id} name={user.name} size="compact" aria-hidden="true" />
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
