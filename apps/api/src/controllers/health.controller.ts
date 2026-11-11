import type { HealthResponse } from '@streamline/shared';
import type { Request, Response } from 'express';

import { healthService } from '../services/health.service.js';

export const healthController = {
  get: (_req: Request, res: Response<HealthResponse>): void => {
    res.json(healthService.getStatus());
  },
};
