import type { ColumnCategory } from '../schemas/column.js';
import { type FlowCardInput, deriveCardFlow } from './card-flow.js';
import {
  DEFAULT_TIME_ZONE,
  type LocalDateKey,
  dateRange,
  resolveDateRange,
  toLocalDateKey,
} from './dates.js';

/** Number of cards per category at the end of one local day. */
export type CumulativeFlowPoint = { date: LocalDateKey; unknown: number } & Record<
  ColumnCategory,
  number
>;

export interface CumulativeFlowOptions {
  from: Date;
  to: Date;
  timeZone?: string;
}

/**
 * Cumulative flow diagram data (WF-FLOW-03): for every local day of `[from, to]` the number of
 * cards in each category at the END of that day, i.e. the category of the latest transition
 * whose local date is on or before the day. Cards are counted from the local day of
 * `createdAt`; a card that exists but has no transition yet (or whose column was deleted)
 * is counted as `unknown`.
 */
export function cumulativeFlow(
  cards: readonly FlowCardInput[],
  options: CumulativeFlowOptions,
): CumulativeFlowPoint[] {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const { fromKey, toKey } = resolveDateRange(options.from, options.to, timeZone);
  const days = dateRange(fromKey, toKey);
  const points: CumulativeFlowPoint[] = days.map((date) => ({
    date,
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    DONE: 0,
    unknown: 0,
  }));

  for (const card of cards) {
    const flow = deriveCardFlow(card);
    const createdKey = toLocalDateKey(flow.createdAt, timeZone);
    if (createdKey > toKey) continue;
    const timeline = flow.transitions.map((t) => ({
      key: toLocalDateKey(t.at, timeZone),
      category: t.toCategory,
    }));

    let next = 0;
    let category: ColumnCategory | null = null;
    for (const point of points) {
      while (next < timeline.length && (timeline[next]?.key ?? '') <= point.date) {
        category = timeline[next]?.category ?? null;
        next++;
      }
      if (createdKey > point.date) continue;
      point[category ?? 'unknown']++;
    }
  }
  return points;
}
