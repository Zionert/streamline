import {
  createLabelSchema,
  updateLabelSchema,
  type LabelListResponse,
  type LabelResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { getBoardMembership } from '../middleware/require-board-permission.js';
import { labelNotFound, type LabelService } from '../services/label.service.js';
import { changeOrigin } from './change-origin.js';
import { routeParam } from './params.js';

const labelId = (req: Request): string => routeParam(req, 'labelId', labelNotFound);

export function createLabelController(labelService: LabelService) {
  return {
    list: async (_req: Request, res: Response<LabelListResponse>): Promise<void> => {
      res.json({ labels: await labelService.list(getBoardMembership(res)) });
    },

    create: async (req: Request, res: Response<LabelResponse>): Promise<void> => {
      const input = createLabelSchema.parse(req.body);
      const label = await labelService.create(getBoardMembership(res), input, changeOrigin(req));
      res.status(201).json({ label });
    },

    update: async (req: Request, res: Response<LabelResponse>): Promise<void> => {
      const input = updateLabelSchema.parse(req.body);
      const label = await labelService.update(
        getBoardMembership(res),
        labelId(req),
        input,
        changeOrigin(req),
      );
      res.json({ label });
    },

    remove: async (req: Request, res: Response): Promise<void> => {
      await labelService.delete(getBoardMembership(res), labelId(req), changeOrigin(req));
      res.status(204).end();
    },
  };
}

export type LabelController = ReturnType<typeof createLabelController>;
