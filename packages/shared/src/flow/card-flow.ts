import { COLUMN_CATEGORIES, type ColumnCategory } from '../schemas/column.js';
import { FlowError, assertValidDate, msToDays } from './errors.js';

/**
 * One move of a card, with the category of the target column already resolved by the caller.
 * `toCategory: null` means the category is unknown (the target column was deleted later).
 */
export interface FlowTransitionInput {
  at: Date;
  toCategory: ColumnCategory | null;
}

/**
 * Input of every flow metric: a card with its full transition history. The earliest transition
 * is the initial placement (the column the card was created in).
 */
export interface FlowCardInput {
  cardId: string;
  createdAt: Date;
  transitions: readonly FlowTransitionInput[];
}

/** Timeline facts derived from one card. Durations are `null` when not applicable. */
export interface CardFlow {
  readonly cardId: string;
  readonly createdAt: Date;
  /** Category of the latest transition; `null` when unknown or there are no transitions. */
  readonly currentCategory: ColumnCategory | null;
  /** Last entry into DONE; `null` unless the card is currently in DONE. */
  readonly completedAt: Date | null;
  /** First-ever entry into IN_PROGRESS (later reopenings do not reset it). */
  readonly cycleStartedAt: Date | null;
  /** `createdAt` -> `completedAt`; `null` when not completed or `neverLeftDone`. */
  readonly leadTimeMs: number | null;
  /** `cycleStartedAt` -> `completedAt`; `null` when not completed, never in progress or `neverLeftDone`. */
  readonly cycleTimeMs: number | null;
  readonly leadTimeDays: number | null;
  readonly cycleTimeDays: number | null;
  /**
   * Created in a DONE column and every transition since then went to DONE (moves between DONE
   * columns included): the card counts in throughput only, without lead or cycle time.
   */
  readonly neverLeftDone: boolean;
  /** Transitions sorted by time (a copy; the input is never mutated). */
  readonly transitions: readonly FlowTransitionInput[];
}

/** Transitions sorted by `at` ascending; stable for equal instants, does not mutate the input. */
export function sortTransitions(
  transitions: readonly FlowTransitionInput[],
): FlowTransitionInput[] {
  return [...transitions].sort((a, b) => a.at.getTime() - b.at.getTime());
}

function validateCard(card: FlowCardInput): void {
  if (typeof card.cardId !== 'string') {
    throw new FlowError('INVALID_ARGUMENT', 'Invalid cardId: expected a string');
  }
  assertValidDate(card.createdAt, `createdAt of card ${card.cardId}`);
  const transitions: readonly FlowTransitionInput[] = card.transitions;
  if (!Array.isArray(transitions)) {
    throw new FlowError('INVALID_ARGUMENT', `Invalid transitions of card ${card.cardId}`);
  }
  for (const transition of card.transitions) {
    assertValidDate(transition.at, `transition time of card ${card.cardId}`);
    const category: unknown = transition.toCategory;
    if (category !== null && !(COLUMN_CATEGORIES as readonly unknown[]).includes(category)) {
      throw new FlowError(
        'INVALID_ARGUMENT',
        `Invalid category of card ${card.cardId}: ${JSON.stringify(category)}`,
      );
    }
  }
}

/** Results of {@link deriveCardFlow}, recognised when they are passed back in. */
const derivedFlows = new WeakSet<object>();

/**
 * Derives the flow timeline of one card.
 *
 * - Completed <=> the current category is DONE; `completedAt` is the start of the final DONE
 *   stay (moving between two DONE columns is not a new completion).
 * - Cycle start = first-ever entry into IN_PROGRESS, including the initial placement.
 * - A card created in DONE that never left DONE (`neverLeftDone`) has no lead or cycle time.
 *   A card created in DONE that was later reopened and completed again is a normal card:
 *   lead time `createdAt` -> last entry into DONE, cycle time from its first IN_PROGRESS.
 * - Clock skew: a transition may be recorded slightly before `createdAt`. `createdAt` is used
 *   as-is and durations are clamped to at least 0 instead of rejecting the card.
 *
 * The result is frozen and is itself a valid `FlowCardInput`: passing it back to
 * `deriveCardFlow` (or to any metric function, which all call it per card) returns it without
 * deriving it again. A caller computing several metrics can derive the cards once and pass the
 * results to every metric.
 *
 * Inputs must not be mutated after derivation: the result shares the transition objects and `Date`
 * instances of the input, so changing them (e.g. a `toCategory`, or `setTime` on a date) would
 * make a result that is later reused stale. Build a new input object instead (it is derived afresh).
 */
export function deriveCardFlow(card: FlowCardInput): CardFlow {
  if (derivedFlows.has(card)) return card as CardFlow;
  validateCard(card);
  const transitions = sortTransitions(card.transitions);
  const last = transitions.at(-1);
  const currentCategory = last?.toCategory ?? null;
  const neverLeftDone = transitions.length > 0 && transitions.every((t) => t.toCategory === 'DONE');

  let completedAt: Date | null = null;
  if (currentCategory === 'DONE') {
    let index = transitions.length - 1;
    while (index > 0 && transitions[index - 1]?.toCategory === 'DONE') index--;
    completedAt = transitions[index]?.at ?? null;
  }

  const cycleStartedAt = transitions.find((t) => t.toCategory === 'IN_PROGRESS')?.at ?? null;

  let leadTimeMs: number | null = null;
  let cycleTimeMs: number | null = null;
  if (completedAt && !neverLeftDone) {
    leadTimeMs = Math.max(0, completedAt.getTime() - card.createdAt.getTime());
    if (cycleStartedAt) {
      cycleTimeMs = Math.max(0, completedAt.getTime() - cycleStartedAt.getTime());
    }
  }

  const flow: CardFlow = Object.freeze({
    cardId: card.cardId,
    createdAt: card.createdAt,
    currentCategory,
    completedAt,
    cycleStartedAt,
    leadTimeMs,
    cycleTimeMs,
    leadTimeDays: leadTimeMs === null ? null : msToDays(leadTimeMs),
    cycleTimeDays: cycleTimeMs === null ? null : msToDays(cycleTimeMs),
    neverLeftDone,
    transitions: Object.freeze(transitions),
  });
  derivedFlows.add(flow);
  return flow;
}
