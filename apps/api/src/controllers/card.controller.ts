import {
  cardKeySchema,
  createCardSchema,
  moveCardSchema,
  updateCardSchema,
  type CardListResponse,
  type CardResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { NotFoundError } from '../errors/app-error.js';
import { getBoardMembership } from '../middleware/require-board-permission.js';
import { CARD_NOT_FOUND_MESSAGE, type CardService } from '../services/card.service.js';

function cardId(req: Request): string {
  const { cardId: id } = req.params;
  if (typeof id !== 'string' || id.length === 0) {
    throw new NotFoundError(CARD_NOT_FOUND_MESSAGE);
  }
  return id;
}

export function createCardController(cardService: CardService) {
  return {
    list: async (_req: Request, res: Response<CardListResponse>): Promise<void> => {
      res.json({ columns: await cardService.list(getBoardMembership(res)) });
    },

    create: async (req: Request, res: Response<CardResponse>): Promise<void> => {
      const input = createCardSchema.parse(req.body);
      const card = await cardService.create(getBoardMembership(res), input);
      res.status(201).json({ card });
    },

    getByKey: async (req: Request, res: Response<CardResponse>): Promise<void> => {
      // A malformed key is a validation error (400); a well-formed but unknown one is 404.
      const key = cardKeySchema.parse(req.params.cardKey);
      res.json({ card: await cardService.getByKey(getBoardMembership(res), key) });
    },

    update: async (req: Request, res: Response<CardResponse>): Promise<void> => {
      const input = updateCardSchema.parse(req.body);
      const card = await cardService.update(getBoardMembership(res), cardId(req), input);
      res.json({ card });
    },

    move: async (req: Request, res: Response<CardResponse>): Promise<void> => {
      const input = moveCardSchema.parse(req.body);
      const card = await cardService.move(getBoardMembership(res), cardId(req), input);
      res.json({ card });
    },

    remove: async (req: Request, res: Response): Promise<void> => {
      await cardService.delete(getBoardMembership(res), cardId(req));
      res.status(204).end();
    },
  };
}

export type CardController = ReturnType<typeof createCardController>;
