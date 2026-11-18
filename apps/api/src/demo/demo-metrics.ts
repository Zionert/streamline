import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  addDays,
  agingWip,
  instantOnLocalDate,
  littlesLaw,
  toLocalDateKey,
  type FlowCardInput,
  type LittlesLaw,
} from '@streamline/shared';

import { DEMO_COLUMNS, type DemoPlan } from './demo-plan.js';

/** Flow metrics of a demo plan, as the analytics would report them at `now` (UTC days). */
export interface DemoPlanMetrics {
  littlesLaw: LittlesLaw;
  /** Cards in progress at `now` and how many of them are aging. */
  inProgress: number;
  aging: number;
  /** Cards completed in the default range. */
  completed: number;
}

/** The plan's cards as inputs of the shared flow metrics (categories of the demo columns). */
export function demoFlowCards(plan: DemoPlan): FlowCardInput[] {
  const categoryOf = new Map(DEMO_COLUMNS.map((column) => [column.key, column.category]));
  return plan.cards.map((card, index) => ({
    cardId: String(index),
    createdAt: card.createdAt,
    transitions: card.moves.map((move) => ({
      at: move.at,
      toCategory: categoryOf.get(move.column) ?? null,
    })),
  }));
}

/** Metrics of the default analytics range (the last 30 days, ending on the day of `now`). */
export function demoPlanMetrics(plan: DemoPlan, now: Date): DemoPlanMetrics {
  const cards = demoFlowCards(plan);
  const toKey = toLocalDateKey(now);
  const fromKey = addDays(toKey, -(ANALYTICS_DEFAULT_RANGE_DAYS - 1));
  const law = littlesLaw(cards, {
    from: instantOnLocalDate(fromKey),
    to: instantOnLocalDate(toKey),
  });
  const aging = agingWip(cards, { now });
  return {
    littlesLaw: law,
    inProgress: aging.items.length,
    aging: aging.items.filter((item) => item.isAging).length,
    completed: Math.round(law.avgThroughputPerDay * law.days),
  };
}
