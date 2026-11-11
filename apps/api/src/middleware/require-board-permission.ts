import type { BoardAction } from '@streamline/shared';
import type { RequestHandler, Response } from 'express';

import { NotFoundError } from '../errors/app-error.js';
import {
  BOARD_NOT_FOUND_MESSAGE,
  type BoardAccessService,
  type BoardMembership,
} from '../services/board-access.service.js';
import { getAuthUserId } from './require-auth.js';

declare global {
  // Declaration merging with Express' global Locals type requires a namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Caller's membership in the board from the route; set by `requireBoardPermission`. */
      boardMembership?: BoardMembership;
    }
  }
}

export interface RequireBoardPermissionOptions {
  /** Route parameter holding the board id (default `boardId`). */
  param?: string;
}

/**
 * Builds a middleware that authorizes `action` on the board identified by a route parameter.
 * Must run after `requireAuth`. Non-members get 404, members without the role get 403;
 * on success the membership is available through `getBoardMembership(res)`.
 * Nested routers (e.g. `/boards/:boardId/columns`) need `Router({ mergeParams: true })`.
 */
export type RequireBoardPermission = (
  action: BoardAction,
  options?: RequireBoardPermissionOptions,
) => RequestHandler;

export function createRequireBoardPermission(
  access: Pick<BoardAccessService, 'require'>,
): RequireBoardPermission {
  return (action, { param = 'boardId' } = {}) =>
    async (req, res, next) => {
      const boardId: unknown = req.params[param];
      if (typeof boardId !== 'string' || boardId.length === 0) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
      res.locals.boardMembership = await access.require(boardId, getAuthUserId(req), action);
      next();
    };
}

/** Returns the membership verified by `requireBoardPermission`; use only in handlers behind it. */
export function getBoardMembership(res: Response): BoardMembership {
  const membership = res.locals.boardMembership;
  if (!membership) {
    throw new Error('getBoardMembership() used on a route without requireBoardPermission');
  }
  return membership;
}
