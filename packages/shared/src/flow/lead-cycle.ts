import { type FlowCardInput, deriveCardFlow } from './card-flow.js';
import {
  DEFAULT_TIME_ZONE,
  type LocalDateKey,
  assertValidTimeZone,
  resolveDateRange,
  toLocalDateKey,
} from './dates.js';
import { assertValidDate } from './errors.js';
import { type FlowPercentiles, flowPercentiles } from './percentile.js';

/** One point of the lead/cycle time scatter plot. */
export interface LeadCyclePoint {
  cardId: string;
  completedAt: Date;
  leadTimeDays: number;
  /** `null` when the card was never in progress. */
  cycleTimeDays: number | null;
}

export interface LeadCycleStats {
  /** Sorted by `completedAt` ascending. */
  points: LeadCyclePoint[];
  /** Percentiles of lead time in days. */
  leadTime: FlowPercentiles;
  /** Percentiles of cycle time in days (only cards that were in progress). */
  cycleTime: FlowPercentiles;
}

export interface LeadCycleOptions {
  /** The local date of this instant is the first day of the range (inclusive). */
  from?: Date;
  /** The local date of this instant is the last day of the range (inclusive). */
  to?: Date;
  /** IANA time zone used to assign completions to days; default `'UTC'`. */
  timeZone?: string;
}

function resolveBounds(options: LeadCycleOptions): {
  fromKey: LocalDateKey | null;
  toKey: LocalDateKey | null;
  timeZone: string;
} {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  assertValidTimeZone(timeZone);
  const { from, to } = options;
  if (from !== undefined && to !== undefined) {
    return { ...resolveDateRange(from, to, timeZone), timeZone };
  }
  if (from !== undefined) assertValidDate(from, 'from');
  if (to !== undefined) assertValidDate(to, 'to');
  return {
    fromKey: from === undefined ? null : toLocalDateKey(from, timeZone),
    toKey: to === undefined ? null : toLocalDateKey(to, timeZone),
    timeZone,
  };
}

/**
 * Lead and cycle times of completed cards (WF-FLOW-01). Cards that never left DONE since
 * their creation (`neverLeftDone`) have no lead time and are left out of the scatter and both
 * percentile samples; cards created in DONE and later reopened are included normally. The optional
 * range uses the same rules as throughput: whole local days `[from, to]` in `timeZone`,
 * matched against the local date of `completedAt`.
 */
export function leadCycleStats(
  cards: readonly FlowCardInput[],
  options: LeadCycleOptions = {},
): LeadCycleStats {
  const { fromKey, toKey, timeZone } = resolveBounds(options);

  const points: LeadCyclePoint[] = [];
  for (const card of cards) {
    const flow = deriveCardFlow(card);
    if (!flow.completedAt || flow.leadTimeDays === null) continue;
    if (fromKey !== null || toKey !== null) {
      const key = toLocalDateKey(flow.completedAt, timeZone);
      if (fromKey !== null && key < fromKey) continue;
      if (toKey !== null && key > toKey) continue;
    }
    points.push({
      cardId: flow.cardId,
      completedAt: flow.completedAt,
      leadTimeDays: flow.leadTimeDays,
      cycleTimeDays: flow.cycleTimeDays,
    });
  }
  points.sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());

  return {
    points,
    leadTime: flowPercentiles(points.map((p) => p.leadTimeDays)),
    cycleTime: flowPercentiles(
      points.flatMap((p) => (p.cycleTimeDays === null ? [] : [p.cycleTimeDays])),
    ),
  };
}
