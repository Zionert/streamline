import {
  hasBoardPermission,
  type Board,
  type BoardMember,
  type Card,
  type Label,
} from '@streamline/shared';
import { Plus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { AvatarStack, type AvatarStackPerson } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isFilterActive, type CardFilter } from '@/features/cards/cardFilter';
import { useCardAging } from '@/features/cards/useCardAging';
import { LabelFilter } from '@/features/labels/LabelFilter';
import { useBoardRealtime } from '@/features/realtime/useBoardRealtime';
import { useBoardStore } from '@/stores/board';

import { AddColumnGhost } from './AddColumnForm';
import { BoardActionsMenu } from './BoardActionsMenu';
import type { ColumnComposerHandle } from './BoardColumn';
import { BoardColumns } from './BoardColumns';
import { BoardLoadError, BoardNotFound } from './BoardStatusViews';
import { newCardColumn } from './newCardColumn';
import { BOARDS_PATH, cardPath, type CardLocationState } from './paths';
import { useOpenBoard } from './useOpenBoard';

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
  useOpenBoard(boardId);

  if (status === 'not-found' && openedId === boardId) {
    return <BoardNotFound />;
  }
  if (status === 'error' && openedId === boardId) {
    return <BoardLoadError message={error ?? ''} onRetry={() => void openBoard(boardId)} />;
  }
  if (status !== 'ready' || !board || board.id !== boardId) {
    return <BoardSkeleton />;
  }
  return <BoardView board={board} />;
}

function BoardSkeleton() {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="status" className="flex min-h-0 flex-1 flex-col">
        <span className="sr-only">Loading board...</span>
        <div className="flex items-center gap-2 px-6 py-4">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-5 w-10" />
          <Skeleton className="ml-auto h-9 w-[220px]" />
        </div>
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-6 pb-6">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton
              key={index}
              data-testid="column-skeleton"
              className="h-full max-h-96 w-[300px] shrink-0 rounded-lg"
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
  const labels = useBoardStore((state) => state.labels);
  const moveColumn = useBoardStore((state) => state.moveColumn);
  const moveCard = useBoardStore((state) => state.moveCard);
  const reloadCards = useBoardStore((state) => state.reloadCards);
  const dismissNotice = useBoardStore((state) => state.dismissNotice);
  const navigate = useNavigate();
  const agingByCardId = useCardAging(board.id);
  const [filterText, setFilterText] = useState('');
  const [activeMemberIds, setActiveMemberIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedLabelIds, setSelectedLabelIds] = useState<ReadonlySet<string>>(() => new Set());
  const canWrite = hasBoardPermission(board.role, 'column:write');
  const canEditSettings = hasBoardPermission(board.role, 'column:settings');
  const canWriteCards = hasBoardPermission(board.role, 'card:write');
  const labelsById = useMemo(
    () => new Map<string, Label>(labels.map((label) => [label.id, label])),
    [labels],
  );
  // A deleted label no longer filters (its id may still be selected).
  const activeLabelIds = useMemo<ReadonlySet<string>>(
    () => new Set([...selectedLabelIds].filter((labelId) => labelsById.has(labelId))),
    [selectedLabelIds, labelsById],
  );
  const filter = useMemo<CardFilter>(
    () => ({ text: filterText, assigneeIds: activeMemberIds, labelIds: activeLabelIds }),
    [filterText, activeMemberIds, activeLabelIds],
  );
  const filtering = isFilterActive(filter);
  const membersById = useMemo(
    () => new Map<string, AvatarStackPerson>(members.map((member) => [member.userId, member])),
    [members],
  );

  const toggleMember = (userId: string) => {
    setActiveMemberIds((previous) => toggleInSet(previous, userId));
  };

  const toggleLabel = (labelId: string) => {
    setSelectedLabelIds((previous) => toggleInSet(previous, labelId));
  };

  const clearFilters = () => {
    setFilterText('');
    setActiveMemberIds(new Set());
    setSelectedLabelIds(new Set());
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

  const leaveDeletedBoard = async () => {
    await navigate(BOARDS_PATH, { replace: true });
  };

  // "New card" opens the quick composer of its target column, exactly like that column's "+".
  const composers = useRef(new Map<string, ColumnComposerHandle>());
  const registerComposer = useCallback((columnId: string, handle: ColumnComposerHandle | null) => {
    if (handle) {
      composers.current.set(columnId, handle);
    } else {
      composers.current.delete(columnId);
    }
  }, []);
  const newCardTarget = newCardColumn(columns);
  const startNewCard =
    canWriteCards && newCardTarget
      ? () => composers.current.get(newCardTarget.id)?.openComposer()
      : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate text-[22px] font-semibold tracking-[-0.02em]">
              {board.name}
            </h1>
            <Badge className="px-2 py-0.5">
              <span className="sr-only">Board key:</span>
              {board.key}
            </Badge>
            <BoardActionsMenu board={board} label="Board actions" onDeleted={leaveDeletedBoard} />
          </div>
          <BoardToolbar
            members={members}
            filterText={filterText}
            onFilterTextChange={setFilterText}
            activeMemberIds={activeMemberIds}
            onToggleMember={toggleMember}
            labels={labels}
            selectedLabelIds={activeLabelIds}
            onToggleLabel={toggleLabel}
            isFiltering={filtering}
            onClearFilters={clearFilters}
            onNewCard={startNewCard}
          />
        </div>
        {filtering && canWriteCards && (
          <p className="-mt-2 px-6 pb-3 text-xs text-subtle">Clear the filter to drag cards.</p>
        )}
        {cardsStatus === 'error' && (
          <div role="alert" className="flex items-center gap-3 px-6 pb-3 text-sm text-destructive">
            Could not load the cards.
            <Button variant="outline" size="sm" onClick={() => void reloadCards()}>
              Retry
            </Button>
          </div>
        )}
        {/* `relative` makes this scroller the containing block of visually hidden (absolute)
            labels inside columns; otherwise they escape it and widen the whole page. */}
        <div className="relative flex min-h-0 flex-1 items-stretch gap-4 overflow-x-auto px-6 pb-6">
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
            labelsById={labelsById}
            agingByCardId={agingByCardId}
            onMoveCard={(cardId, toColumnId, toIndex) => void moveCard(cardId, toColumnId, toIndex)}
            onOpenCard={openCard}
            onComposerRef={registerComposer}
          />
          {canWrite && <AddColumnGhost />}
        </div>
        {/* Card details: a modal route over the board. */}
        <Outlet />
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
  labels: readonly Label[];
  /** Labels whose cards are shown (all cards when empty). */
  selectedLabelIds: ReadonlySet<string>;
  onToggleLabel: (labelId: string) => void;
  /** Any filter is active (offers clearing all of them). */
  isFiltering: boolean;
  onClearFilters: () => void;
  /** Starts a new card; `null` hides the button (no `card:write`, or no column to add to). */
  onNewCard: (() => void) | null;
}

/** Copy of the set with `value` added, or removed when it was there. */
function toggleInSet(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(value)) {
    next.add(value);
  }
  return next;
}

/** The view-only card filters (text, people, labels) and "New card". */
function BoardToolbar({
  members,
  filterText,
  onFilterTextChange,
  activeMemberIds,
  onToggleMember,
  labels,
  selectedLabelIds,
  onToggleLabel,
  isFiltering,
  onClearFilters,
  onNewCard,
}: BoardToolbarProps) {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-3">
      <div className="relative w-[220px]">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
          strokeWidth={2}
        />
        <Input
          type="search"
          aria-label="Filter cards"
          placeholder="Filter cards"
          value={filterText}
          className="pl-8"
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
      <LabelFilter labels={labels} selectedIds={selectedLabelIds} onToggle={onToggleLabel} />
      {isFiltering && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X strokeWidth={2} />
          Clear filters
        </Button>
      )}
      {onNewCard && (
        <Button onClick={onNewCard}>
          <Plus strokeWidth={2} />
          New card
        </Button>
      )}
    </div>
  );
}
