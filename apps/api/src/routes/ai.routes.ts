import { AI_ERROR_CODES, type AiStatusResponse } from '@streamline/shared';
import { Router, type RequestHandler } from 'express';

import { createAiController } from '../controllers/ai.controller.js';
import { NotFoundError } from '../errors/app-error.js';
import type { RequireBoardPermission } from '../middleware/require-board-permission.js';
import type { AiChatService } from '../services/ai-chat.service.js';
import type { AiConversationService } from '../services/ai-conversation.service.js';

export interface AiRouterDependencies {
  aiConversationService: AiConversationService;
  /** Chat turns with the model; `null` when no model provider is configured. */
  aiChatService: AiChatService | null;
  /** Whether the assistant is enabled and which model it uses (`GET /ai/status`). */
  aiStatus: AiStatusResponse;
  requireAuth: RequestHandler;
  requireBoardPermission: RequireBoardPermission;
}

/** Answers every request with 404 `AI_DISABLED`; guards the assistant routes while it is off. */
const aiDisabled: RequestHandler = () => {
  throw new NotFoundError('The AI assistant is disabled', AI_ERROR_CODES.AI_DISABLED);
};

/**
 * Routes under `/ai`. `GET /ai/status` always works (the client learns from it whether the
 * assistant is on); while the assistant is disabled every other route answers 404 `AI_DISABLED`.
 * Board chats are read-only towards the board, so every member (VIEWER included) may use them.
 * Sending a message streams the assistant's answer as Server-Sent Events.
 */
export function createAiRouter({
  aiConversationService,
  aiChatService,
  aiStatus,
  requireAuth,
  requireBoardPermission: can,
}: AiRouterDependencies): Router {
  const controller = createAiController(aiConversationService, aiStatus, aiChatService);

  const router = Router();
  router.use(requireAuth);

  router.get('/status', controller.status);

  if (!aiStatus.enabled) {
    router.use(aiDisabled);
    return router;
  }

  router.get('/boards/:boardId/conversation', can('board:view'), controller.getBoardConversation);
  router.delete(
    '/boards/:boardId/conversation',
    can('board:view'),
    controller.clearBoardConversation,
  );
  router.post('/project-sessions', controller.createProjectSession);
  router.get('/conversations/:conversationId/messages', controller.listMessages);
  // Access to the board of a board chat is checked by the service (the board id comes from the
  // conversation, not from the URL).
  router.post(
    '/conversations/:conversationId/messages',
    aiChatService ? controller.sendMessage : aiDisabled,
  );

  return router;
}
