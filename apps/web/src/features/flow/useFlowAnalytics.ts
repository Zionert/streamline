import type { AnalyticsResponse } from '@streamline/shared';
import { useCallback, useEffect, useState } from 'react';

import { isNotFoundError } from '@/features/boards/boardErrorMessage';

import * as analyticsApi from './analyticsApi';
import { getFlowErrorMessage } from './flowErrorMessage';

export type FlowAnalyticsState =
  | { status: 'loading' }
  | { status: 'ready'; data: AnalyticsResponse }
  | { status: 'error'; message: string }
  /** The board is gone or the user is not a member. */
  | { status: 'not-found' };

/** The outcome of one request, tagged with the request it answers. */
interface Settled {
  requestKey: string;
  state: Exclude<FlowAnalyticsState, { status: 'loading' }>;
}

/**
 * Flow analytics of the board for the default range of the API, in `timeZone`. A response for
 * an earlier board (or an earlier attempt) is dropped: its request is aborted and its result,
 * should it still arrive, does not match the current request. `reload` fetches them again.
 */
export function useFlowAnalytics(
  boardId: string,
  timeZone: string,
): FlowAnalyticsState & { reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const requestKey = `${boardId}\n${timeZone}\n${String(attempt)}`;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    analyticsApi
      .getAnalytics(boardId, timeZone, controller.signal)
      .then((data) => {
        if (active) {
          setSettled({ requestKey, state: { status: 'ready', data } });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setSettled({
          requestKey,
          state: isNotFoundError(error)
            ? { status: 'not-found' }
            : { status: 'error', message: getFlowErrorMessage(error) },
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [boardId, timeZone, requestKey]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const state: FlowAnalyticsState =
    settled?.requestKey === requestKey ? settled.state : { status: 'loading' };
  return { ...state, reload };
}
