import type { BoardEvent } from '@streamline/shared';

import type { BoardEvents, ChangeOrigin } from '../realtime/board-events.js';

export type RecordedBoardEvent =
  | (BoardEvent & { origin: ChangeOrigin | undefined })
  | { name: 'revoke-access'; boardId: string; userId: string; origin: ChangeOrigin | undefined };

/** A `BoardEvents` fake that records every call, in order. */
export function createRecordingBoardEvents(): BoardEvents & { events: RecordedBoardEvent[] } {
  const events: RecordedBoardEvent[] = [];
  return {
    events,
    publish(name, payload, origin) {
      // `name` and `payload` always match (enforced by the `publish` signature).
      events.push({ name, payload, origin } as RecordedBoardEvent);
    },
    revokeAccess(boardId, userId, origin) {
      events.push({ name: 'revoke-access', boardId, userId, origin });
    },
    closeBoard(payload, origin) {
      events.push({ name: 'board:deleted', payload, origin });
    },
  };
}
