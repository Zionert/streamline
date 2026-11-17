import { type FlowCardInput, deriveCardFlow } from './card-flow.js';
import { cumulativeFlow } from './cumulative-flow.js';
import { DEFAULT_TIME_ZONE, resolveDateRange, toLocalDateKey } from './dates.js';

export interface LittlesLawOptions {
  from: Date;
  to: Date;
  timeZone?: string;
}

export interface LittlesLaw {
  /** Number of local days in the range. */
  days: number;
  /** Mean end-of-day IN_PROGRESS count from the cumulative flow data. */
  avgWip: number;
  /** Completions with a local completion date in the range, divided by `days`. */
  avgThroughputPerDay: number;
  /** Mean cycle time of cards completed in the range; `null` without such cards. */
  avgCycleTimeDays: number | null;
  /** `avgThroughputPerDay * avgCycleTimeDays`; `null` when the cycle time is unknown. */
  predictedWip: number | null;
  /** `(avgWip - predictedWip) / predictedWip`; `null` when `predictedWip` is null or 0. */
  relativeError: number | null;
}

/**
 * Little's law check (WF-FLOW-06): average WIP should be close to throughput x average cycle
 * time when the process is stable. Throughput counts every completion (also cards without a
 * cycle time), the average cycle time only cards that were in progress.
 */
export function littlesLaw(
  cards: readonly FlowCardInput[],
  options: LittlesLawOptions,
): LittlesLaw {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const { fromKey, toKey } = resolveDateRange(options.from, options.to, timeZone);
  const cfd = cumulativeFlow(cards, { from: options.from, to: options.to, timeZone });
  const days = cfd.length;
  const avgWip = cfd.reduce((sum, point) => sum + point.IN_PROGRESS, 0) / days;

  let completions = 0;
  const cycleTimes: number[] = [];
  for (const card of cards) {
    const flow = deriveCardFlow(card);
    if (!flow.completedAt) continue;
    const key = toLocalDateKey(flow.completedAt, timeZone);
    if (key < fromKey || key > toKey) continue;
    completions++;
    if (flow.cycleTimeDays !== null) cycleTimes.push(flow.cycleTimeDays);
  }

  const avgThroughputPerDay = completions / days;
  const avgCycleTimeDays =
    cycleTimes.length === 0 ? null : cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
  const predictedWip = avgCycleTimeDays === null ? null : avgThroughputPerDay * avgCycleTimeDays;
  const relativeError =
    predictedWip === null || predictedWip === 0 ? null : (avgWip - predictedWip) / predictedWip;

  return { days, avgWip, avgThroughputPerDay, avgCycleTimeDays, predictedWip, relativeError };
}
