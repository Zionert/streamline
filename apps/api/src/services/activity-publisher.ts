import type { Activity, ActivityContent } from '@streamline/shared';

import type { BoardEvents } from '../realtime/board-events.js';
import type { ActivityRecord } from '../repositories/activity.repository.js';
import type { BoardMembership } from './board-access.service.js';

export function toActivity(record: ActivityRecord): Activity {
  // Payloads are written only by the services, from the typed content of their type.
  const content = { type: record.type, payload: record.payload } as ActivityContent;
  return {
    id: record.id,
    boardId: record.boardId,
    cardId: record.cardId,
    actor: record.actor ? { id: record.actor.id, name: record.actor.name } : null,
    createdAt: record.createdAt.toISOString(),
    ...content,
  };
}

/**
 * Broadcasts a committed activity entry as `activity:created`. No origin is passed on purpose:
 * the client that made the change has no other way to learn about the entry, so the event is
 * delivered to every socket in the room (the socket server never suppresses it either).
 */
export function publishActivity(
  events: BoardEvents,
  membership: BoardMembership,
  record: ActivityRecord | null,
): void {
  if (!record) return;
  events.publish('activity:created', {
    boardId: membership.boardId,
    actorId: membership.userId,
    activity: toActivity(record),
  });
}
