import { useEffect } from 'react';

import { useCardActivityStore } from '@/stores/activity';

import { ActivityFeedList } from './ActivityFeedList';

/** The history of one card (newest first), shown in its details; card keys are not links here. */
export function CardActivityFeed({ boardId, cardId }: { boardId: string; cardId: string }) {
  const items = useCardActivityStore((state) => state.items);
  const status = useCardActivityStore((state) => state.status);
  const error = useCardActivityStore((state) => state.error);
  const nextCursor = useCardActivityStore((state) => state.nextCursor);
  const isLoadingMore = useCardActivityStore((state) => state.isLoadingMore);

  useEffect(() => {
    const scope = { boardId, cardId };
    void useCardActivityStore.getState().open(scope);
    return () => {
      useCardActivityStore.getState().close(scope);
    };
  }, [boardId, cardId]);

  return (
    <ActivityFeedList
      label="Card activity"
      items={items}
      status={status}
      error={error}
      hasMore={nextCursor !== null}
      isLoadingMore={isLoadingMore}
      onLoadMore={() => void useCardActivityStore.getState().loadMore()}
      onRetry={() => void useCardActivityStore.getState().reload()}
    />
  );
}
