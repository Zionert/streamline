import { activityListResponseSchema, type ActivityListResponse } from '@streamline/shared';

import { api } from '@/lib/api';

const boardUrl = (boardId: string) => `/boards/${encodeURIComponent(boardId)}`;

/**
 * One page of an activity feed, newest first: the whole board's, or one card's when `cardId` is
 * given. Pass the previous `nextCursor` for the next page.
 */
export async function listActivity(
  boardId: string,
  cardId: string | null,
  cursor: string | null = null,
): Promise<ActivityListResponse> {
  const url =
    cardId === null
      ? `${boardUrl(boardId)}/activity`
      : `${boardUrl(boardId)}/cards/${encodeURIComponent(cardId)}/activity`;
  const response = await api.get<unknown>(url, {
    params: cursor === null ? undefined : { cursor },
  });
  return activityListResponseSchema.parse(response.data);
}
