import {
  aiMessageListQuerySchema,
  createAiProjectSessionSchema,
  type AiBoardConversationResponse,
  type AiConversationResponse,
  type AiMessageListResponse,
  type AiStatusResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { getAuthUserId } from '../middleware/require-auth.js';
import { getBoardMembership } from '../middleware/require-board-permission.js';
import {
  conversationNotFound,
  type AiConversationService,
} from '../services/ai-conversation.service.js';
import { routeParam } from './params.js';

export function createAiController(
  aiConversationService: AiConversationService,
  status: AiStatusResponse,
) {
  return {
    status: (_req: Request, res: Response<AiStatusResponse>): void => {
      res.json(status);
    },

    getBoardConversation: async (
      req: Request,
      res: Response<AiBoardConversationResponse>,
    ): Promise<void> => {
      const query = aiMessageListQuerySchema.parse(req.query);
      const { conversation, page } = await aiConversationService.getBoardConversation(
        getBoardMembership(res),
        query,
      );
      res.json({ conversation, messages: page.items, nextCursor: page.nextCursor });
    },

    clearBoardConversation: async (_req: Request, res: Response): Promise<void> => {
      await aiConversationService.clearBoardConversation(getBoardMembership(res));
      res.status(204).end();
    },

    createProjectSession: async (
      req: Request,
      res: Response<AiConversationResponse>,
    ): Promise<void> => {
      createAiProjectSessionSchema.parse(req.body ?? {});
      const conversation = await aiConversationService.createProjectSession(getAuthUserId(req));
      res.status(201).json({ conversation });
    },

    listMessages: async (req: Request, res: Response<AiMessageListResponse>): Promise<void> => {
      const query = aiMessageListQuerySchema.parse(req.query);
      const page = await aiConversationService.listMessages(
        getAuthUserId(req),
        routeParam(req, 'conversationId', conversationNotFound),
        query,
      );
      res.json({ messages: page.items, nextCursor: page.nextCursor });
    },
  };
}

export type AiController = ReturnType<typeof createAiController>;
