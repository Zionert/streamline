import type { Activity } from '@streamline/shared';
import { History } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { FeedStatus } from '@/stores/pagedFeed';

import { ActivityItem } from './ActivityItem';

export interface ActivityFeedListProps {
  items: readonly Activity[];
  status: FeedStatus;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** The current key of a card still on the board, `null` for a deleted one. */
  currentCardKey?: (cardId: string) => string | null;
  /** Called when a card link is followed. */
  onNavigate?: () => void;
  label: string;
}

/** A feed of activity entries, newest first, with loading, empty, error and "Load more" states. */
export function ActivityFeedList({
  items,
  status,
  error,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onRetry,
  currentCardKey,
  onNavigate,
  label,
}: ActivityFeedListProps) {
  if (status === 'loading' && items.length === 0) {
    return (
      <div role="status" className="flex flex-col gap-3 py-2">
        <span className="sr-only">Loading activity...</span>
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-6 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 py-2 text-sm text-destructive">
        <p>Could not load the activity. {error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-subtle">
        <History aria-hidden="true" className="size-4" strokeWidth={2} />
        <p className="text-xs font-semibold tracking-[0.04em] uppercase">No activity yet</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={label} className="flex flex-col divide-y">
        {items.map((activity) => (
          <ActivityItem
            key={activity.id}
            activity={activity}
            currentCardKey={
              activity.cardId !== null && currentCardKey ? currentCardKey(activity.cardId) : null
            }
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={isLoadingMore}
          onClick={onLoadMore}
        >
          {isLoadingMore ? 'Loading...' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
