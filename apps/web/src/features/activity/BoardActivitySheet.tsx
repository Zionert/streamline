import { useCallback, useEffect } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { findCard } from '@/features/cards/cardOrder';
import { useBoardActivityStore } from '@/stores/activity';
import { useBoardStore } from '@/stores/board';

import { ActivityFeedList } from './ActivityFeedList';

interface BoardActivitySheetProps {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The board's activity in a panel on the right (full width on small screens): newest first,
 * page by page, with new entries arriving live while it is open.
 */
export function BoardActivitySheet({ boardId, open, onOpenChange }: BoardActivitySheetProps) {
  const items = useBoardActivityStore((state) => state.items);
  const status = useBoardActivityStore((state) => state.status);
  const error = useBoardActivityStore((state) => state.error);
  const nextCursor = useBoardActivityStore((state) => state.nextCursor);
  const isLoadingMore = useBoardActivityStore((state) => state.isLoadingMore);
  // Card keys are looked up only while the panel is shown: a closed panel ignores card changes.
  const cardsByColumn = useBoardStore((state) => (open ? state.cardsByColumn : null));

  useEffect(() => {
    if (!open) {
      return;
    }
    const scope = { boardId };
    void useBoardActivityStore.getState().open(scope);
    return () => {
      useBoardActivityStore.getState().close(scope);
    };
  }, [open, boardId]);

  const currentCardKey = useCallback(
    (cardId: string) =>
      cardsByColumn === null ? null : (findCard(cardsByColumn, cardId)?.card.key ?? null),
    [cardsByColumn],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription>Recent changes on this board, newest first.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <ActivityFeedList
            label="Board activity"
            items={items}
            status={status}
            error={error}
            hasMore={nextCursor !== null}
            isLoadingMore={isLoadingMore}
            onLoadMore={() => void useBoardActivityStore.getState().loadMore()}
            onRetry={() => void useBoardActivityStore.getState().reload()}
            currentCardKey={currentCardKey}
            onNavigate={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
