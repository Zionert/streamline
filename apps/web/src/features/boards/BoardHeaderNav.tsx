import type { Board } from '@streamline/shared';
import { useRef, useState } from 'react';
import { Link, useMatch } from 'react-router';

import { AvatarStack } from '@/components/ui/avatar';
import { BoardActivitySheet } from '@/features/activity/BoardActivitySheet';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';

import { MembersDialog } from './MembersDialog';
import { FLOW_PATH_PATTERN, boardPath, flowPath } from './paths';

/** Avatars shown in the top bar before the "+N" counter. */
const HEADER_MEMBERS_MAX = 4;

const TAB_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-subtle transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

const ACTIVE_TAB_CLASS = 'bg-surface-hover text-foreground';

/**
 * Board part of the top bar: the board name after the logo, then the view tabs. Board and Flow are
 * links (the current one marked as the page, also with a card open over it); Activity and Team
 * open the board history panel and the members dialog, which live here so the tab that opened
 * them gets the focus back when they close.
 */
export function BoardHeaderNav({ board }: { board: Board }) {
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const activityTab = useRef<HTMLButtonElement>(null);
  const teamTab = useRef<HTMLButtonElement>(null);
  const isFlow = useMatch({ path: FLOW_PATH_PATTERN, end: false }) !== null;

  return (
    <>
      <span aria-hidden="true" className="hidden text-border-strong sm:inline">
        /
      </span>
      <span className="hidden max-w-48 min-w-0 truncate text-subtle sm:block lg:max-w-64">
        {board.name}
      </span>
      <nav aria-label="Board views" className="-m-1 min-w-0 overflow-x-auto p-1 sm:ml-2">
        <ul className="flex items-center gap-1">
          <li className="shrink-0">
            <Link
              to={boardPath(board.id)}
              aria-current={isFlow ? undefined : 'page'}
              className={cn(TAB_CLASS, !isFlow && ACTIVE_TAB_CLASS)}
            >
              Board
            </Link>
          </li>
          <li className="shrink-0">
            <Link
              to={flowPath(board.id)}
              aria-current={isFlow ? 'page' : undefined}
              className={cn(TAB_CLASS, isFlow && ACTIVE_TAB_CLASS)}
            >
              Flow
            </Link>
          </li>
          <li className="shrink-0">
            <button
              ref={activityTab}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isActivityOpen}
              className={cn(TAB_CLASS, isActivityOpen && ACTIVE_TAB_CLASS)}
              onClick={() => setIsActivityOpen(true)}
            >
              Activity
            </button>
          </li>
          <li className="shrink-0">
            <button
              ref={teamTab}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isMembersOpen}
              className={cn(TAB_CLASS, isMembersOpen && ACTIVE_TAB_CLASS)}
              onClick={() => setIsMembersOpen(true)}
            >
              Team
            </button>
          </li>
        </ul>
      </nav>
      <BoardActivitySheet
        boardId={board.id}
        open={isActivityOpen}
        onOpenChange={setIsActivityOpen}
        returnFocusRef={activityTab}
      />
      <MembersDialog
        boardName={board.name}
        myRole={board.role}
        open={isMembersOpen}
        onOpenChange={setIsMembersOpen}
        returnFocusRef={teamTab}
      />
    </>
  );
}

/** Members of the opened board in the top bar (hidden below 768 px). */
export function BoardHeaderMembers() {
  const members = useBoardStore((state) => state.members);
  if (members.length === 0) {
    return null;
  }
  return (
    <AvatarStack
      people={members}
      max={HEADER_MEMBERS_MAX}
      size="compact"
      label="Members of this board"
      className="hidden md:flex"
    />
  );
}
