import {
  analyticsResponseSchema,
  forecastResponseSchema,
  type AnalyticsResponse,
  type ForecastResponse,
} from '@streamline/shared';

import { api } from '@/lib/api';

const analyticsUrl = (boardId: string) => `/boards/${encodeURIComponent(boardId)}/analytics`;

/** Flow metrics of the board for the local days `from`..`to` (inclusive) in `timeZone`. */
export async function getAnalytics(
  boardId: string,
  range: { from: string; to: string },
  timeZone: string,
  signal?: AbortSignal,
): Promise<AnalyticsResponse> {
  const response = await api.get<unknown>(analyticsUrl(boardId), {
    params: { from: range.from, to: range.to, timeZone },
    ...(signal ? { signal } : {}),
  });
  return analyticsResponseSchema.parse(response.data);
}

/**
 * What a forecast answers: when `remaining` cards will be done (all open cards when absent), or
 * how many cards will be done by `targetDate` (`YYYY-MM-DD`).
 */
export type ForecastRequest =
  { mode: 'count'; remaining?: number } | { mode: 'date'; targetDate: string };

/** Monte Carlo forecast from the board's recent daily throughput. */
export async function getForecast(
  boardId: string,
  request: ForecastRequest,
  timeZone: string,
  signal?: AbortSignal,
): Promise<ForecastResponse> {
  const params =
    request.mode === 'count'
      ? {
          mode: 'count',
          ...(request.remaining === undefined ? {} : { remaining: request.remaining }),
          timeZone,
        }
      : { mode: 'date', targetDate: request.targetDate, timeZone };
  const response = await api.get<unknown>(`${analyticsUrl(boardId)}/forecast`, {
    params,
    ...(signal ? { signal } : {}),
  });
  return forecastResponseSchema.parse(response.data);
}
