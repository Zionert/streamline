import { hasBoardPermission, type Board } from '@streamline/shared';
import {
  ChartLine,
  ChevronLeft,
  ChevronRight,
  Settings,
  SquareKanban,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { BoardIcon } from './BoardIcon';
import { RoleBadge } from './badges';
import { boardPath } from './paths';

export const BOARD_SIDEBAR_ID = 'board-sidebar';

interface BoardSidebarProps {
  board: Board;
  /** Below 768 px the sidebar is a drawer over the page instead of a docked panel. */
  isMobile: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  onOpenMembers: () => void;
}

/** Board navigation: docked and collapsible on wide screens, a drawer on small ones. */
export function BoardSidebar({
  board,
  isMobile,
  collapsed,
  onToggleCollapsed,
  drawerOpen,
  onDrawerOpenChange,
  onOpenMembers,
}: BoardSidebarProps) {
  if (isMobile) {
    return drawerOpen ? (
      <SidebarDrawer onClose={() => onDrawerOpenChange(false)}>
        <SidebarContent
          board={board}
          onOpenMembers={() => {
            onDrawerOpenChange(false);
            onOpenMembers();
          }}
        />
      </SidebarDrawer>
    ) : null;
  }

  return (
    // Collapsed, a narrow strip stays reserved for the toggle so it never overlaps the page.
    <div className={cn('relative flex shrink-0', collapsed && 'w-7')}>
      <aside
        id={BOARD_SIDEBAR_ID}
        aria-label="Board navigation"
        aria-hidden={collapsed || undefined}
        inert={collapsed}
        data-collapsed={collapsed || undefined}
        className={cn(
          'overflow-hidden bg-sidebar transition-[width] duration-200',
          collapsed ? 'w-0' : 'w-60 border-r',
        )}
      >
        <div className="w-60">
          <SidebarContent board={board} onOpenMembers={onOpenMembers} />
        </div>
      </aside>
      <button
        type="button"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls={BOARD_SIDEBAR_ID}
        onClick={onToggleCollapsed}
        className={cn(
          collapsed ? 'left-1.5' : '-right-3',
          'absolute top-4 z-10 flex size-6 items-center justify-center rounded-full border bg-surface text-subtle shadow-card outline-none hover:bg-primary hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        )}
      >
        {collapsed ? (
          <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2} />
        ) : (
          <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

/** Overlay drawer (a modal dialog): closes on Escape and on a click on the backdrop. */
function SidebarDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-testid="sidebar-backdrop"
          className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          id={BOARD_SIDEBAR_ID}
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-60 border-r bg-sidebar text-foreground shadow-raised outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
        >
          <DialogPrimitive.Title className="sr-only">Board navigation</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close board navigation"
              className="absolute top-3 right-2"
            >
              <X strokeWidth={2} />
            </Button>
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SidebarContent({ board, onOpenMembers }: { board: Board; onOpenMembers: () => void }) {
  const canOpenSettings = hasBoardPermission(board.role, 'board:rename');

  return (
    <div className="flex flex-col gap-4 p-3 pt-4">
      <div className="flex items-start gap-3 pr-6">
        <BoardIcon boardId={board.id} name={board.name} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="line-clamp-2 text-base leading-tight font-semibold break-words">
            {board.name}
          </p>
          <RoleBadge role={board.role} />
        </div>
      </div>
      <nav aria-label="Board">
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link
              to={boardPath(board.id)}
              aria-current="page"
              className={cn(navItemClass, 'bg-primary-subtle text-primary')}
            >
              <SquareKanban aria-hidden="true" className="size-5" strokeWidth={2} />
              Board
            </Link>
          </li>
          <li>
            <SoonItem icon={ChartLine} label="Analytics" />
          </li>
          <li>
            <button type="button" className={navItemClass} onClick={onOpenMembers}>
              <Users aria-hidden="true" className="size-5 text-subtle" strokeWidth={2} />
              Members
            </button>
          </li>
          {canOpenSettings && (
            <li>
              <SoonItem icon={Settings} label="Settings" />
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}

const navItemClass =
  'flex h-9 w-full items-center gap-3 rounded-md px-2 text-left text-sm font-medium outline-none hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** A navigation item for a page that does not exist yet. */
function SoonItem({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button type="button" disabled className={cn(navItemClass, 'text-subtle hover:bg-transparent')}>
      <Icon aria-hidden="true" className="size-5" strokeWidth={2} />
      <span className="flex-1">{label}</span>
      <span className="rounded-sm bg-column px-1.5 py-0.5 text-[11px] font-semibold uppercase">
        Soon
      </span>
    </button>
  );
}
