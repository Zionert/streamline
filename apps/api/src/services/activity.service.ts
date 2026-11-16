import type { Activity, ActivityListQuery } from '@streamline/shared';

import { NotFoundError } from '../errors/app-error.js';
import type { ActivityRecord, ActivityRepository } from '../repositories/activity.repository.js';
import { toActivity } from './activity-publisher.js';
import { assertBoardPermission, type BoardMembership } from './board-access.service.js';
import { CARD_NOT_FOUND_MESSAGE } from './card.service.js';
import { toPage, type Page } from './pagination.js';

/**
 * Reading the board activity log. Entries are written by the other services, in the transaction
 * of the change they describe (see `insertActivity`), and broadcast with `publishActivity`
 * after the commit.
 */
export interface ActivityService {
  /** The board's entries, newest first. */
  listForBoard(membership: BoardMembership, query: ActivityListQuery): Promise<Page<Activity>>;
  /** The entries about one existing card of the board, newest first. */
  listForCard(
    membership: BoardMembership,
    cardId: string,
    query: ActivityListQuery,
  ): Promise<Page<Activity>>;
}

export interface ActivityServiceDependencies {
  activities: ActivityRepository;
}

function mapPage(records: ActivityRecord[], limit: number): Page<Activity> {
  const page = toPage(records, limit);
  return { items: page.items.map(toActivity), nextCursor: page.nextCursor };
}

export function createActivityService({
  activities,
}: ActivityServiceDependencies): ActivityService {
  return {
    async listForBoard(membership, { cursor, limit }) {
      assertBoardPermission(membership, 'board:view');
      return mapPage(await activities.listForBoard(membership.boardId, { cursor, limit }), limit);
    },

    async listForCard(membership, cardId, { cursor, limit }) {
      assertBoardPermission(membership, 'board:view');
      const { boardId } = membership;
      if (!(await activities.cardExists(boardId, cardId))) {
        throw new NotFoundError(CARD_NOT_FOUND_MESSAGE);
      }
      return mapPage(await activities.listForCard(boardId, cardId, { cursor, limit }), limit);
    },
  };
}
