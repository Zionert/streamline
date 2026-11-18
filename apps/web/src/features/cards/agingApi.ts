import { agingResponseSchema, type AgingResponse } from '@streamline/shared';

import { api } from '@/lib/api';

/** The age of every card currently in progress on the board, flagged when it is aging. */
export async function getCardAging(boardId: string, signal?: AbortSignal): Promise<AgingResponse> {
  const response = await api.get<unknown>(
    `/boards/${encodeURIComponent(boardId)}/analytics/aging`,
    signal ? { signal } : {},
  );
  return agingResponseSchema.parse(response.data);
}
