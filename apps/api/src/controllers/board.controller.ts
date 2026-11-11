import {
  addBoardMemberSchema,
  createBoardSchema,
  updateBoardMemberSchema,
  updateBoardSchema,
  type BoardListResponse,
  type BoardMemberListResponse,
  type BoardMemberResponse,
  type BoardResponse,
} from '@streamline/shared';
import type { Request, Response } from 'express';

import { NotFoundError } from '../errors/app-error.js';
import { getAuthUserId } from '../middleware/require-auth.js';
import { getBoardMembership } from '../middleware/require-board-permission.js';
import type { BoardService } from '../services/board.service.js';

function targetUserId(req: Request): string {
  const { userId } = req.params;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new NotFoundError('Member not found');
  }
  return userId;
}

export function createBoardController(boardService: BoardService) {
  return {
    list: async (req: Request, res: Response<BoardListResponse>): Promise<void> => {
      res.json({ boards: await boardService.listForUser(getAuthUserId(req)) });
    },

    create: async (req: Request, res: Response<BoardResponse>): Promise<void> => {
      const input = createBoardSchema.parse(req.body);
      res.status(201).json({ board: await boardService.create(getAuthUserId(req), input) });
    },

    get: async (_req: Request, res: Response<BoardResponse>): Promise<void> => {
      res.json({ board: await boardService.get(getBoardMembership(res)) });
    },

    rename: async (req: Request, res: Response<BoardResponse>): Promise<void> => {
      const input = updateBoardSchema.parse(req.body);
      res.json({ board: await boardService.rename(getBoardMembership(res), input) });
    },

    remove: async (_req: Request, res: Response): Promise<void> => {
      await boardService.delete(getBoardMembership(res));
      res.status(204).end();
    },

    listMembers: async (_req: Request, res: Response<BoardMemberListResponse>): Promise<void> => {
      res.json({ members: await boardService.listMembers(getBoardMembership(res)) });
    },

    addMember: async (req: Request, res: Response<BoardMemberResponse>): Promise<void> => {
      const input = addBoardMemberSchema.parse(req.body);
      const member = await boardService.addMember(getBoardMembership(res), input);
      res.status(201).json({ member });
    },

    updateMember: async (req: Request, res: Response<BoardMemberResponse>): Promise<void> => {
      const input = updateBoardMemberSchema.parse(req.body);
      const member = await boardService.updateMemberRole(
        getBoardMembership(res),
        targetUserId(req),
        input,
      );
      res.json({ member });
    },

    removeMember: async (req: Request, res: Response): Promise<void> => {
      await boardService.removeMember(getBoardMembership(res), targetUserId(req));
      res.status(204).end();
    },
  };
}

export type BoardController = ReturnType<typeof createBoardController>;
