import type { AnalyticsResponse } from '@streamline/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isNotFoundError } from '@/features/boards/boardErrorMessage';

import * as analyticsApi from './analyticsApi';
import { getFlowErrorMessage } from './flowErrorMessage';
import type { DateRange } from './flowRange';

export type FlowAnalyticsState =
  | { status: 'loading' }
  | { status: 'ready'; data: AnalyticsResponse }
  | { status: 'error'; message: string }
  /** The board is gone or the user is not a member. */
  | { status: 'not-found' };

export type FlowAnalytics = FlowAnalyticsState & {
  /** Loads them again from scratch (skeletons while loading), e.g. after an error. */
  reload: () => void;
  /** Reads them again in the background: the data shown stays until the new data arrives. */
  refresh: () => void;
  /** A background refresh of the data shown is in flight (never during the first load). */
  isRefreshing: boolean;
};

/** The outcome of one request, tagged with the request it answers. */
interface Settled {
  requestKey: string;
  state: Exclude<FlowAnalyticsState, { status: 'loading' }>;
}

/**
 * Flow analytics of the board for the local days `range.from`..`range.to` in `timeZone`. Only the
 * latest request may land: starting another one (another board or range, a reload or a refresh)
 * aborts the previous one, and its result, should it still arrive, is dropped.
 *
 * A failed background refresh keeps the data shown (the next change refreshes again); only a
 * board that is gone replaces it.
 */
export function useFlowAnalytics(
  boardId: string,
  range: DateRange,
  timeZone: string,
): FlowAnalytics {
  const { from, to } = range;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const latest = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0,
    controller: null,
  });
  const requestKey = `${boardId}\n${from}\n${to}\n${timeZone}\n${String(attempt)}`;

  const request = useCallback(
    (background: boolean) => {
      const guard = latest.current;
      guard.controller?.abort();
      const controller = new AbortController();
      const generation = ++guard.generation;
      guard.controller = controller;
      const isLatest = () => generation === guard.generation;
      analyticsApi.getAnalytics(boardId, { from, to }, timeZone, controller.signal).then(
        (data) => {
          if (!isLatest()) {
            return;
          }
          setSettled({ requestKey, state: { status: 'ready', data } });
          setRefreshingKey(null);
        },
        (error: unknown) => {
          if (!isLatest()) {
            return;
          }
          setRefreshingKey(null);
          const failed: Settled['state'] = isNotFoundError(error)
            ? { status: 'not-found' }
            : { status: 'error', message: getFlowErrorMessage(error) };
          setSettled((previous) =>
            background &&
            failed.status === 'error' &&
            previous?.requestKey === requestKey &&
            previous.state.status === 'ready'
              ? previous
              : { requestKey, state: failed },
          );
        },
      );
    },
    [boardId, from, to, timeZone, requestKey],
  );

  useEffect(() => {
    const guard = latest.current;
    request(false);
    return () => {
      guard.generation += 1;
      guard.controller?.abort();
      guard.controller = null;
    };
  }, [request]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const refresh = useCallback(() => {
    setRefreshingKey(requestKey);
    request(true);
  }, [request, requestKey]);
  const state: FlowAnalyticsState =
    settled?.requestKey === requestKey ? settled.state : { status: 'loading' };
  const isRefreshing = state.status === 'ready' && refreshingKey === requestKey;
  return { ...state, reload, refresh, isRefreshing };
}
