import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import {
  DEFAULT_RANGE,
  isSameSelection,
  localToday,
  parseRangeQuery,
  resolveRange,
  withRangeQuery,
  type DateRange,
  type FlowRangeSelection,
} from './flowRange';

export interface FlowRangeState {
  selection: FlowRangeSelection;
  /** The dates to request. */
  range: DateRange;
  /** Today in the browser's time zone (when the page opened, or the range was last picked). */
  today: string;
  /** Reads "today" again (e.g. when the range picker opens on a page left open past midnight). */
  refreshToday: () => void;
  select: (selection: FlowRangeSelection) => void;
}

/**
 * The date range of the Flow page, kept in the URL query (so a reload or a shared link keeps it).
 * An invalid query falls back to the default range and is removed from the address (replacing
 * the history entry). "Today" is read when the page opens and again when the range picker opens,
 * so the dates of a preset (and the request) do not change on their own while the page is open.
 */
export function useFlowRange(timeZone: string): FlowRangeState {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const locationState: unknown = location.state;
  const [today, setToday] = useState(() => localToday(timeZone));
  const refreshToday = useCallback(() => setToday(localToday(timeZone)), [timeZone]);
  const { selection, isCanonical } = parseRangeQuery(searchParams, today);

  useEffect(() => {
    // A query that is not canonical always selects the default range.
    if (!isCanonical) {
      setSearchParams((current) => withRangeQuery(current, DEFAULT_RANGE), {
        replace: true,
        state: locationState,
      });
    }
  }, [isCanonical, setSearchParams, locationState]);

  const select = useCallback(
    (next: FlowRangeSelection) => {
      if (isSameSelection(next, parseRangeQuery(searchParams, today).selection)) {
        return;
      }
      setSearchParams(withRangeQuery(searchParams, next));
    },
    [searchParams, setSearchParams, today],
  );

  return { selection, range: resolveRange(selection, today), today, refreshToday, select };
}
