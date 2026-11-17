import { type FlowCardInput, deriveCardFlow } from './card-flow.js';
import { assertFiniteNumber, assertValidDate, msToDays } from './errors.js';
import { flowPercentiles } from './percentile.js';

export interface AgingWipItem {
  cardId: string;
  /** `now - cycleStartedAt`, at least 0. */
  ageMs: number;
  ageDays: number;
  /** Age is strictly greater than the threshold. Always false without a threshold. */
  isAging: boolean;
}

export interface AgingWip {
  /**
   * 85th percentile of cycle times in days; `null` with fewer than `MIN_PERCENTILE_SAMPLE`
   * samples, in which case no card is flagged.
   */
  thresholdDays: number | null;
  /** Cards currently in progress, oldest first. */
  items: AgingWipItem[];
}

export interface AgingWipOptions {
  now: Date;
  /**
   * Cycle time samples in days used for the threshold. Defaults to the cycle times of all
   * completed cards in `cards`; pass e.g. the samples of a date range to narrow it down.
   */
  cycleTimesDays?: readonly number[];
}

/** Aging work in progress (WF-FLOW-04): age of every card currently IN_PROGRESS. */
export function agingWip(cards: readonly FlowCardInput[], options: AgingWipOptions): AgingWip {
  assertValidDate(options.now, 'now');
  const now = options.now.getTime();
  const flows = cards.map(deriveCardFlow);

  const samples =
    options.cycleTimesDays ??
    flows.flatMap((f) => (f.cycleTimeDays === null ? [] : [f.cycleTimeDays]));
  for (const sample of samples) assertFiniteNumber(sample, 'cycle time sample');
  const thresholdDays = flowPercentiles(samples).p85;

  const items: AgingWipItem[] = [];
  for (const flow of flows) {
    if (flow.currentCategory !== 'IN_PROGRESS' || !flow.cycleStartedAt) continue;
    const ageMs = Math.max(0, now - flow.cycleStartedAt.getTime());
    const ageDays = msToDays(ageMs);
    items.push({
      cardId: flow.cardId,
      ageMs,
      ageDays,
      isAging: thresholdDays !== null && ageDays > thresholdDays,
    });
  }
  items.sort((a, b) => b.ageMs - a.ageMs);
  return { thresholdDays, items };
}
