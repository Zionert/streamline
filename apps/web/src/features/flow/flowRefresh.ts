import type { BoardChange } from '@/features/realtime/boardChanges';

/** Quiet time after the last relevant board change before the analytics are read again. */
export const FLOW_REFRESH_DELAY_MS = 2000;

/** Live events that change the analytics (comments, labels and members do not). */
const FLOW_EVENTS: ReadonlySet<string> = new Set([
  'card:created',
  'card:moved',
  'card:updated',
  'card:deleted',
  'column:created',
  'column:updated',
  'column:deleted',
  'column:moved',
]);

/** Whether a board change calls for reading the analytics again (local changes always do). */
export function isFlowChange(change: BoardChange): boolean {
  return change.type !== 'remote' || FLOW_EVENTS.has(change.event.name);
}
