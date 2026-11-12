import {
  createColumnSchema,
  moveColumnSchema,
  renameColumnSchema,
  updateColumnSettingsSchema,
  type ColumnListResponse,
  type ColumnResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { NotFoundError } from '../errors/app-error.js';
import { getBoardMembership } from '../middleware/require-board-permission.js';
import { COLUMN_NOT_FOUND_MESSAGE, type ColumnService } from '../services/column.service.js';
import { changeOrigin } from './change-origin.js';

function columnId(req: Request): string {
  const { columnId: id } = req.params;
  if (typeof id !== 'string' || id.length === 0) {
    throw new NotFoundError(COLUMN_NOT_FOUND_MESSAGE);
  }
  return id;
}

export function createColumnController(columnService: ColumnService) {
  return {
    list: async (_req: Request, res: Response<ColumnListResponse>): Promise<void> => {
      res.json({ columns: await columnService.list(getBoardMembership(res)) });
    },

    create: async (req: Request, res: Response<ColumnResponse>): Promise<void> => {
      const input = createColumnSchema.parse(req.body);
      const column = await columnService.create(getBoardMembership(res), input, changeOrigin(req));
      res.status(201).json({ column });
    },

    rename: async (req: Request, res: Response<ColumnResponse>): Promise<void> => {
      const input = renameColumnSchema.parse(req.body);
      const column = await columnService.rename(
        getBoardMembership(res),
        columnId(req),
        input,
        changeOrigin(req),
      );
      res.json({ column });
    },

    move: async (req: Request, res: Response<ColumnResponse>): Promise<void> => {
      const input = moveColumnSchema.parse(req.body);
      const column = await columnService.move(
        getBoardMembership(res),
        columnId(req),
        input,
        changeOrigin(req),
      );
      res.json({ column });
    },

    updateSettings: async (req: Request, res: Response<ColumnResponse>): Promise<void> => {
      const input = updateColumnSettingsSchema.parse(req.body);
      const column = await columnService.updateSettings(
        getBoardMembership(res),
        columnId(req),
        input,
        changeOrigin(req),
      );
      res.json({ column });
    },

    remove: async (req: Request, res: Response): Promise<void> => {
      await columnService.delete(getBoardMembership(res), columnId(req), changeOrigin(req));
      res.status(204).end();
    },
  };
}

export type ColumnController = ReturnType<typeof createColumnController>;
