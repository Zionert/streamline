import {
  BOARD_ERROR_CODES,
  canLeaveBoard,
  type AddBoardMemberInput,
  type Board,
  type BoardMember,
  type BoardRole,
  type CreateBoardInput,
  type UpdateBoardInput,
  type UpdateBoardMemberInput,
} from '@streamline/shared';

import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import type {
  BoardMemberRepository,
  BoardMemberWithUser,
} from '../repositories/board-member.repository.js';
import type { BoardRecord, BoardRepository } from '../repositories/board.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import {
  assertBoardPermission,
  BOARD_NOT_FOUND_MESSAGE,
  type BoardMembership,
} from './board-access.service.js';

/**
 * Board and membership use cases. Methods taking a `BoardMembership` expect the caller's
 * membership verified by `BoardAccessService`; they re-check the role themselves as well.
 */
export interface BoardService {
  listForUser(userId: string): Promise<Board[]>;
  /** Creates a board owned by the user. */
  create(userId: string, input: CreateBoardInput): Promise<Board>;
  get(membership: BoardMembership): Promise<Board>;
  rename(membership: BoardMembership, input: UpdateBoardInput): Promise<Board>;
  delete(membership: BoardMembership): Promise<void>;
  listMembers(membership: BoardMembership): Promise<BoardMember[]>;
  /** Adds a registered user, found by email, to the board. */
  addMember(membership: BoardMembership, input: AddBoardMemberInput): Promise<BoardMember>;
  /** Changes the role of a member other than the OWNER. */
  updateMemberRole(
    membership: BoardMembership,
    targetUserId: string,
    input: UpdateBoardMemberInput,
  ): Promise<BoardMember>;
  /** Removes another member (managers only, never the OWNER), or lets the caller leave the board. */
  removeMember(membership: BoardMembership, targetUserId: string): Promise<void>;
}

export interface BoardServiceDependencies {
  boards: BoardRepository;
  members: BoardMemberRepository;
  users: Pick<UserRepository, 'findByEmail'>;
}

const MEMBER_NOT_FOUND_MESSAGE = 'Member not found';

export function toBoard(board: BoardRecord, role: BoardRole): Board {
  return {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    role,
  };
}

export function toBoardMember(member: BoardMemberWithUser): BoardMember {
  return {
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    joinedAt: member.createdAt.toISOString(),
  };
}

export function createBoardService({
  boards,
  members,
  users,
}: BoardServiceDependencies): BoardService {
  /**
   * Explains why a conditional update/delete of a member matched no row:
   * the member does not exist, or it is the OWNER.
   */
  async function failForTarget(
    boardId: string,
    targetUserId: string,
    ownerMessage: string,
  ): Promise<never> {
    const target = await members.find(boardId, targetUserId);
    if (!target) {
      throw new NotFoundError(MEMBER_NOT_FOUND_MESSAGE);
    }
    throw new ForbiddenError(ownerMessage);
  }

  return {
    async listForUser(userId) {
      const list = await boards.listForUser(userId);
      return list.map(({ board, role }) => toBoard(board, role));
    },

    async create(userId, { name }) {
      return toBoard(await boards.createWithOwner(name, userId), 'OWNER');
    },

    async get(membership) {
      assertBoardPermission(membership, 'board:view');
      const board = await boards.findById(membership.boardId);
      if (!board) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
      return toBoard(board, membership.role);
    },

    async rename(membership, { name }) {
      assertBoardPermission(membership, 'board:rename');
      const board = await boards.rename(membership.boardId, name);
      if (!board) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
      return toBoard(board, membership.role);
    },

    async delete(membership) {
      assertBoardPermission(membership, 'board:delete');
      if (!(await boards.delete(membership.boardId))) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
    },

    async listMembers(membership) {
      assertBoardPermission(membership, 'board:view');
      const list = await members.listForBoard(membership.boardId);
      return list.map(toBoardMember);
    },

    async addMember(membership, { email, role }) {
      assertBoardPermission(membership, 'members:manage');
      const user = await users.findByEmail(email);
      if (!user) {
        throw new NotFoundError(
          'No registered user with this email',
          BOARD_ERROR_CODES.USER_NOT_FOUND,
        );
      }

      const result = await members.add({ boardId: membership.boardId, userId: user.id, role });
      switch (result.status) {
        case 'created':
          return toBoardMember(result.member);
        case 'already-member':
          throw new ConflictError(
            'This user is already a member of the board',
            BOARD_ERROR_CODES.ALREADY_MEMBER,
          );
        case 'missing-reference':
          throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
    },

    async updateMemberRole(membership, targetUserId, { role }) {
      assertBoardPermission(membership, 'members:manage');
      const { boardId } = membership;
      // Conditional update: the OWNER row can never be modified, even by a concurrent request.
      if (!(await members.updateRoleUnlessOwner(boardId, targetUserId, role))) {
        return failForTarget(boardId, targetUserId, "The board owner's role cannot be changed");
      }
      const updated = await members.findWithUser(boardId, targetUserId);
      if (!updated) {
        throw new NotFoundError(MEMBER_NOT_FOUND_MESSAGE);
      }
      return toBoardMember(updated);
    },

    async removeMember(membership, targetUserId) {
      const { boardId, userId } = membership;

      if (targetUserId === userId) {
        if (!canLeaveBoard(membership.role)) {
          throw new ConflictError(
            'The board owner cannot leave the board',
            BOARD_ERROR_CODES.OWNER_CANNOT_LEAVE,
          );
        }
        if (!(await members.removeUnlessOwner(boardId, userId))) {
          throw new NotFoundError(MEMBER_NOT_FOUND_MESSAGE);
        }
        return;
      }

      assertBoardPermission(membership, 'members:manage');
      if (!(await members.removeUnlessOwner(boardId, targetUserId))) {
        await failForTarget(boardId, targetUserId, 'The board owner cannot be removed');
      }
    },
  };
}
