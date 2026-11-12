import {
  hasBoardPermission,
  type Board,
  type BoardMember,
  type Card,
  type PresenceUser,
} from '@streamline/shared';
import { ArrowUpDown, PanelLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { AvatarStack, type AvatarStackPerson } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isFilterActive, type CardFilter } from '@/features/cards/cardFilter';
import { BoardPresence } from '@/features/realtime/BoardPresence';
import { useBoardRealtime } from '@/features/realtime/useBoardRealtime';
import { MOBILE_SCREEN_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { useBoardStore } from '@/stores/board';

import { AddColumnGhost } from './AddColumnForm';
import { BoardColumns } from './BoardColumns';
import { BOARD_SIDEBAR_ID, BoardSidebar } from './BoardSidebar';
import { MembersDialog } from './MembersDialog';
import { BOARDS_PATH, cardPath, type CardLocationState } from './paths';
import { useSidebarState } from './sidebarState';

/** Toast id of the board notice: a newer notice replaces the previous one, like a banner. */
const NOTICE_TOAST_ID = 'board-notice';

/**
 * A single board: its columns and cards (with reordering and settings) and its members, kept up
 * to date with the changes of other users while the page is open.
 */
export function BoardPage() {
  const { boardId = '' } = useParams();
  useBoardRealtime(boardId);
  const openedId = useBoardStore((state) => state.boardId);
  const board = useBoardStore((state) => state.board);
  const status = useBoardStore((state) => state.boardStatus);
  const error = useBoardStore((state) => state.boardError);
  const openBoard = useBoardStore((state) => state.openBoard);

  useEffect(() => {
    void openBoard(boardId);
  }, [boardId, openBoard]);

  if (status === 'not-found' && openedId === boardId) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Board not found</h1>
        <p className="text-subtle">This board does not exist or you are not a member of it.</p>
        <Link to={BOARDS_PATH} className="text-primary underline-offset-4 hover:underline">
          Back to your boards
        </Link>
      </main>
    );
  }
  if (status === 'error' && openedId === boardId) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p role="alert" className="text-destructive">
          Could not load the board. {error}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => void openBoard(boardId)}>
            Retry
          </Button>
          <Button variant="link" asChild>
            <Link to={BOARDS_PATH}>Back to your boards</Link>
          </Button>
        </div>
      </main>
    );
  }
  if (status !== 'ready' || !board || board.id !== boardId) {
    return <BoardSkeleton />;
  }
  return <BoardView board={board} />;
}

function BoardSkeleton() {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-6 pt-4">
      <div role="status" className="flex min-h-0 flex-1 flex-col gap-3">
        <span className="sr-only">Loading board...</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-8 w-[200px]" />
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden pb-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton
              key={index}
              data-testid="column-skeleton"
              className="h-full max-h-96 w-[280px] shrink-0 rounded-column"
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function BoardView({ board }: { board: Board }) {
  const columns = useBoardStore((state) => state.columns);
  const members = useBoardStore((state) => state.members);
  const isMoving = useBoardStore((state) => state.isMovingColumn);
  const cardsByColumn = useBoardStore((state) => state.cardsByColumn);
  const cardsStatus = useBoardStore((state) => state.cardsStatus);
  const isMovingCard = useBoardStore((state) => state.isMovingCard);
  const notice = useBoardStore((state) => state.notice);
  const presence = useBoardStore((state) => state.presence);
  const moveColumn = useBoardStore((state) => state.moveColumn);
  const moveCard = useBoardStore((state) => state.moveCard);
  const reloadCards = useBoardStore((state) => state.reloadCards);
  const dismissNotice = useBoardStore((state) => state.dismissNotice);
  const navigate = useNavigate();
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [activeMemberIds, setActiveMemberIds] = useState<ReadonlySet<string>>(() => new Set());
  const isMobile = useMediaQuery(MOBILE_SCREEN_QUERY);
  const sidebar = useSidebarState(isMobile);
  const canWrite = hasBoardPermission(board.role, 'column:write');
  const canEditSettings = hasBoardPermission(board.role, 'column:settings');
  const canWriteCards = hasBoardPermission(board.role, 'card:write');
  const filter = useMemo<CardFilter>(
    () => ({ text: filterText, assigneeIds: activeMemberIds }),
    [filterText, activeMemberIds],
  );
  const filtering = isFilterActive(filter);
  const membersById = useMemo(
    () => new Map<string, AvatarStackPerson>(members.map((member) => [member.userId, member])),
    [members],
  );

  const toggleMember = (userId: string) => {
    setActiveMemberIds((previous) => {
      const next = new Set(previous);
      if (!next.delete(userId)) {
        next.add(userId);
      }
      return next;
    });
  };

  const openCard = (card: Card) => {
    const state: CardLocationState = { fromBoard: true };
    void navigate(cardPath(board.id, card.key), { state });
  };

  // Failed operations without a form of their own (e.g. drag & drop) are reported as toasts;
  // the notice is cleared once shown.
  useEffect(() => {
    if (notice) {
      toast.error(notice, { id: NOTICE_TOAST_ID });
      dismissNotice();
    }
  }, [notice, dismissNotice]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <BoardSidebar
        board={board}
        isMobile={isMobile}
        collapsed={sidebar.collapsed}
        onToggleCollapsed={sidebar.toggleCollapsed}
        drawerOpen={sidebar.drawerOpen}
        onDrawerOpenChange={sidebar.setDrawerOpen}
        onOpenMembers={() => setIsMembersOpen(true)}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-6 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open board navigation"
              aria-expanded={sidebar.drawerOpen}
              aria-controls={BOARD_SIDEBAR_ID}
              onClick={() => sidebar.setDrawerOpen(true)}
            >
              <PanelLeft strokeWidth={2} />
            </Button>
          )}
          <Breadcrumbs items={[{ label: 'Boards', to: BOARDS_PATH }, { label: board.name }]} />
        </div>
        <h1 className="text-2xl font-semibold">Board</h1>
        <BoardToolbar
          members={members}
          filterText={filterText}
          onFilterTextChange={setFilterText}
          activeMemberIds={activeMemberIds}
          onToggleMember={toggleMember}
          showDragHint={filtering && canWriteCards}
          presence={presence}
        />
        {cardsStatus === 'error' && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            Could not load the cards.
            <Button variant="outline" size="sm" onClick={() => void reloadCards()}>
              Retry
            </Button>
          </div>
        )}
        {/* `relative` makes this scroller the containing block of visually hidden (absolute)
            labels inside columns; otherwise they escape it and widen the whole page. */}
        <div className="relative flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-4">
          <BoardColumns
            columns={columns}
            canWrite={canWrite}
            canEditSettings={canEditSettings}
            isMoving={isMoving}
            onMove={(columnId, toIndex) => void moveColumn(columnId, toIndex)}
            cardsByColumn={cardsByColumn}
            filter={filter}
            isLoadingCards={cardsStatus === 'loading' || cardsStatus === 'idle'}
            canWriteCards={canWriteCards}
            // A filtered view hides cards, so the neighbours of a drop would be wrong.
            isCardDragDisabled={isMovingCard || filtering}
            membersById={membersById}
            onMoveCard={(cardId, toColumnId, toIndex) => void moveCard(cardId, toColumnId, toIndex)}
            onOpenCard={openCard}
          />
          {canWrite && <AddColumnGhost />}
        </div>
        {/* Card details: a modal route over the board. */}
        <Outlet />
        <MembersDialog
          boardName={board.name}
          myRole={board.role}
          open={isMembersOpen}
          onOpenChange={setIsMembersOpen}
        />
      </main>
    </div>
  );
}

interface BoardToolbarProps {
  members: readonly BoardMember[];
  filterText: string;
  onFilterTextChange: (text: string) => void;
  /** Members whose cards are shown (all cards when empty). */
  activeMemberIds: ReadonlySet<string>;
  onToggleMember: (userId: string) => void;
  /** Explains that dragging cards is paused while a filter is active. */
  showDragHint: boolean;
  /** Users currently viewing the board. */
  presence: readonly PresenceUser[];
}

/** View-only card filters: text (title or key) and assignees. */
function BoardToolbar({
  members,
  filterText,
  onFilterTextChange,
  activeMemberIds,
  onToggleMember,
  showDragHint,
  presence,
}: BoardToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-[200px]">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
          strokeWidth={2}
        />
        <Input
          type="search"
          aria-label="Filter cards"
          placeholder="Filter cards"
          value={filterText}
          className="h-8 pl-8"
          onChange={(event) => onFilterTextChange(event.target.value)}
        />
      </div>
      {members.length > 0 && (
        <AvatarStack
          people={members}
          max={4}
          label="Board members"
          isActive={(person) => activeMemberIds.has(person.userId)}
          onToggle={(person) => onToggleMember(person.userId)}
        />
      )}
      <Button variant="subtle" size="sm" disabled title="Sorting is not available yet">
        <ArrowUpDown strokeWidth={2} />
        Sort
      </Button>
      {showDragHint && <p className="text-xs text-subtle">Clear the filter to drag cards.</p>}
      <div className="ml-auto">
        <BoardPresence users={presence} />
      </div>
    </div>
  );
}
