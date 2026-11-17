import type { FlowCardInput } from '../src/flow/card-flow.js';
import type { ColumnCategory } from '../src/schemas/column.js';

/** Instant from an ISO string, for readable flow test fixtures. */
export function at(iso: string): Date {
  return new Date(iso);
}

/**
 * Card fixture: `createdAt` is the time of the first move unless given explicitly.
 * Each move is `[isoInstant, category]`.
 */
export function flowCard(
  cardId: string,
  moves: readonly (readonly [string, ColumnCategory | null])[],
  createdAt?: string,
): FlowCardInput {
  const created = createdAt ?? moves[0]?.[0];
  if (created === undefined) throw new Error('flowCard needs createdAt or at least one move');
  return {
    cardId,
    createdAt: at(created),
    transitions: moves.map(([iso, toCategory]) => ({ at: at(iso), toCategory })),
  };
}
