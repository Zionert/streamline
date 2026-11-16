import type { ActivityRecord, NewActivityData } from '../repositories/activity.repository.js';

let counter = 0;

/** The row an activity repository would return for `data` (for fakes in unit tests). */
export function fakeActivityRecord(
  data: NewActivityData,
  actorName = 'Actor',
  createdAt = new Date('2026-11-15T10:00:00.000Z'),
): ActivityRecord {
  counter += 1;
  return {
    id: `activity-${String(counter)}`,
    boardId: data.boardId,
    actorId: data.actorId,
    actor: { id: data.actorId, name: actorName },
    type: data.content.type,
    cardId: data.cardId ?? null,
    payload: data.content.payload,
    createdAt,
  };
}
