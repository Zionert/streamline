import {
  aiMessageListQuerySchema,
  createAiProjectSessionSchema,
  sendAiMessageSchema,
  type AiBoardConversationResponse,
  type AiConversationResponse,
  type AiMessageListResponse,
  type AiStatusResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { getAuthUserId } from '../middleware/require-auth.js';
import type { AiChatService, AiChatSink } from '../services/ai-chat.service.js';
import { getBoardMembership } from '../middleware/require-board-permission.js';
import {
  conversationNotFound,
  type AiConversationService,
} from '../services/ai-conversation.service.js';
import { routeParam } from './params.js';

/**
 * Starts a Server-Sent Events response and returns the sink writing its events. Nothing is
 * written once the response has ended or the connection is gone.
 */
function openEventStream(res: Response): AiChatSink {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disables response buffering in reverse proxies such as nginx.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  return {
    send(event, data) {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

export function createAiController(
  aiConversationService: AiConversationService,
  status: AiStatusResponse,
  aiChatService: AiChatService | null = null,
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

    /**
     * Runs one turn and streams it as Server-Sent Events. Failures before the stream starts are
     * thrown to the error handler (JSON error responses); later ones arrive as an `error` event.
     */
    sendMessage: async (req: Request, res: Response): Promise<void> => {
      if (!aiChatService) throw new Error('The AI chat service is not configured');
      const input = sendAiMessageSchema.parse(req.body);
      const conversationId = routeParam(req, 'conversationId', conversationNotFound);
      // `close` of the response (not of the request, whose `close` only means that its body was
      // read) fires when the connection is gone; after a completed response it is ignored.
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });
      let streaming = false;
      await aiChatService.runTurn({
        userId: getAuthUserId(req),
        conversationId,
        input,
        signal: abort.signal,
        open: () => {
          streaming = true;
          return openEventStream(res);
        },
      });
      if (streaming && !res.writableEnded) res.end();
    },
  };
}

export type AiController = ReturnType<typeof createAiController>;
