import { hasBoardPermission, type BoardAction, type BoardRole } from '@streamline/shared';

import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import type { BoardMemberRepository } from '../repositories/board-member.repository.js';

/** The caller's verified membership in a board. */
export interface BoardMembership {
  boardId: string;
  userId: string;
  role: BoardRole;
}

export const BOARD_NOT_FOUND_MESSAGE = 'Board not found';

/** Throws `ForbiddenError` when the member's role does not allow the action. */
export function assertBoardPermission(membership: BoardMembership, action: BoardAction): void {
  if (!hasBoardPermission(membership.role, action)) {
    throw new ForbiddenError(`Your role on this board does not allow ${action}`);
  }
}

export interface BoardAccessService {
  /**
   * Loads the user's membership in the board and checks that it allows `action`.
   * Non-members (including a nonexistent board) get `NotFoundError`, so the existence of
   * a board is never revealed; members lacking the role get `ForbiddenError`.
   */
  require(boardId: string, userId: string, action: BoardAction): Promise<BoardMembership>;
}

export interface BoardAccessServiceDependencies {
  members: Pick<BoardMemberRepository, 'find'>;
}

export function createBoardAccessService({
  members,
}: BoardAccessServiceDependencies): BoardAccessService {
  return {
    async require(boardId, userId, action) {
      const member = await members.find(boardId, userId);
      if (!member) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
      const membership: BoardMembership = { boardId, userId, role: member.role };
      assertBoardPermission(membership, action);
      return membership;
    },
  };
}
