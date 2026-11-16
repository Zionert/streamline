import { activityListQuerySchema, type ActivityListResponse } from '@streamline/shared';
import type { Request, Response } from 'express';

import { NotFoundError } from '../errors/app-error.js';
import { getBoardMembership } from '../middleware/require-board-permission.js';
import type { ActivityService } from '../services/activity.service.js';
import { CARD_NOT_FOUND_MESSAGE } from '../services/card.service.js';
import { routeParam } from './params.js';

export function createActivityController(activityService: ActivityService) {
  return {
    listForBoard: async (req: Request, res: Response<ActivityListResponse>): Promise<void> => {
      const query = activityListQuerySchema.parse(req.query);
      const page = await activityService.listForBoard(getBoardMembership(res), query);
      res.json({ activities: page.items, nextCursor: page.nextCursor });
    },

    listForCard: async (req: Request, res: Response<ActivityListResponse>): Promise<void> => {
      const query = activityListQuerySchema.parse(req.query);
      const cardId = routeParam(req, 'cardId', () => new NotFoundError(CARD_NOT_FOUND_MESSAGE));
      const page = await activityService.listForCard(getBoardMembership(res), cardId, query);
      res.json({ activities: page.items, nextCursor: page.nextCursor });
    },
  };
}

export type ActivityController = ReturnType<typeof createActivityController>;
