import {
  analyticsQuerySchema,
  forecastQuerySchema,
  type AnalyticsResponse,
  type ForecastResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { getBoardMembership } from '../middleware/require-board-permission.js';
import type { AnalyticsService } from '../services/analytics.service.js';

export function createAnalyticsController(analyticsService: AnalyticsService) {
  return {
    get: async (req: Request, res: Response<AnalyticsResponse>): Promise<void> => {
      const query = analyticsQuerySchema.parse(req.query);
      res.json(await analyticsService.getAnalytics(getBoardMembership(res), query));
    },

    forecast: async (req: Request, res: Response<ForecastResponse>): Promise<void> => {
      const query = forecastQuerySchema.parse(req.query);
      res.json(await analyticsService.forecast(getBoardMembership(res), query));
    },
  };
}

export type AnalyticsController = ReturnType<typeof createAnalyticsController>;
