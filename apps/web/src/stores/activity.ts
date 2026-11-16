import type { Activity } from '@streamline/shared';

import * as activityApi from '@/features/activity/activityApi';
import { getBoardErrorMessage } from '@/features/boards/boardErrorMessage';
import { getCardErrorMessage } from '@/features/cards/cardErrorMessage';

import { createPagedFeedStore } from './pagedFeed';

export interface BoardActivityScope {
  boardId: string;
}

export interface CardActivityScope {
  boardId: string;
  cardId: string;
}

/** The activity of the opened board (newest first), while the activity panel is open. */
export const useBoardActivityStore = createPagedFeedStore<Activity, BoardActivityScope>({
  order: 'newest-first',
  fetchPage: async ({ boardId }, cursor) => {
    const page = await activityApi.listActivity(boardId, null, cursor);
    return { items: page.activities, nextCursor: page.nextCursor };
  },
  sameScope: (a, b) => a.boardId === b.boardId,
  belongs: (activity, scope) => activity.boardId === scope.boardId,
  errorMessage: getBoardErrorMessage,
});

/** The activity of the card whose details are open (newest first). */
export const useCardActivityStore = createPagedFeedStore<Activity, CardActivityScope>({
  order: 'newest-first',
  fetchPage: async ({ boardId, cardId }, cursor) => {
    const page = await activityApi.listActivity(boardId, cardId, cursor);
    return { items: page.activities, nextCursor: page.nextCursor };
  },
  sameScope: (a, b) => a.boardId === b.boardId && a.cardId === b.cardId,
  belongs: (activity, scope) =>
    activity.boardId === scope.boardId && activity.cardId === scope.cardId,
  errorMessage: getCardErrorMessage,
});

/**
 * Adds a new entry (`activity:created`, delivered to the client that made the change as well) to
 * the open feeds it belongs to; an entry already shown is not duplicated.
 */
export function receiveActivity(activity: Activity): void {
  useBoardActivityStore.getState().receive([activity]);
  useCardActivityStore.getState().receive([activity]);
}
