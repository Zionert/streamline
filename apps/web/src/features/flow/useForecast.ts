import type { ForecastResponse } from '@streamline/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as analyticsApi from './analyticsApi';
import type { ForecastRequest } from './analyticsApi';
import { getFlowErrorMessage } from './flowErrorMessage';

export type ForecastState =
  | { status: 'idle' }
  | { status: 'loading'; request: ForecastRequest }
  | { status: 'ready'; request: ForecastRequest; data: ForecastResponse }
  | { status: 'error'; request: ForecastRequest; message: string };

export interface ForecastControls {
  state: ForecastState;
  /** Runs a forecast; a run still in flight is aborted and its result dropped. */
  run: (request: ForecastRequest) => void;
  /** Drops the current result (and any run in flight). */
  reset: () => void;
}

/** Monte Carlo forecasts of the board, in `timeZone`; only the latest run is ever shown. */
export function useForecast(boardId: string, timeZone: string): ForecastControls {
  const [state, setState] = useState<ForecastState>({ status: 'idle' });
  const latest = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0,
    controller: null,
  });

  const cancel = useCallback(() => {
    latest.current.generation += 1;
    latest.current.controller?.abort();
    latest.current.controller = null;
  }, []);

  // Nothing arrives after the panel is gone (e.g. another board was opened).
  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    (request: ForecastRequest) => {
      cancel();
      const controller = new AbortController();
      latest.current.controller = controller;
      const generation = latest.current.generation;
      const isLatest = () => generation === latest.current.generation;
      setState({ status: 'loading', request });
      analyticsApi
        .getForecast(boardId, request, timeZone, controller.signal)
        .then((data) => {
          if (isLatest()) {
            setState({ status: 'ready', request, data });
          }
        })
        .catch((error: unknown) => {
          if (isLatest()) {
            setState({ status: 'error', request, message: getFlowErrorMessage(error) });
          }
        });
    },
    [boardId, timeZone, cancel],
  );

  const reset = useCallback(() => {
    cancel();
    setState({ status: 'idle' });
  }, [cancel]);

  return { state, run, reset };
}
