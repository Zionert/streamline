import {
  BOARD_ERROR_CODES,
  canLeaveBoard,
  DEFAULT_BOARD_COLUMNS,
  pickBoardKey,
  rankSequenceBetween,
  type AddBoardMemberInput,
  type Board,
  type BoardMember,
  type BoardRole,
  type BoardSummary,
  type CreateBoardInput,
  type UpdateBoardInput,
  type UpdateBoardMemberInput,
} from '@streamline/shared';

import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { noopBoardEvents, type BoardEvents, type ChangeOrigin } from '../realtime/board-events.js';
import type {
  BoardMemberRepository,
  BoardMemberWithUser,
} from '../repositories/board-member.repository.js';
import type {
  BoardRecord,
  BoardRepository,
  InitialColumnData,
} from '../repositories/board.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import {
  assertBoardPermission,
  BOARD_NOT_FOUND_MESSAGE,
  type BoardMembership,
} from './board-access.service.js';
import { busyToServiceUnavailable } from './ranked-write.js';

/**
 * Board and membership use cases. Methods taking a `BoardMembership` expect the caller's
 * membership verified by `BoardAccessService`; they re-check the role themselves as well.
 * Successful changes are broadcast through `BoardEvents` (the optional `origin` identifies the
 * client that made the change, so it is not sent its own change back).
 */
export interface BoardService {
  listForUser(userId: string): Promise<Board[]>;
  /**
   * Creates a board owned by the user, with the default columns and a key generated from the
   * name (the first candidate not used by another board of the user).
   */
  create(userId: string, input: CreateBoardInput): Promise<Board>;
  get(membership: BoardMembership): Promise<Board>;
  /** Changes the name and/or the key (409 `BOARD_KEY_TAKEN` if the owner uses it elsewhere). */
  update(
    membership: BoardMembership,
    input: UpdateBoardInput,
    origin?: ChangeOrigin,
  ): Promise<Board>;
  delete(membership: BoardMembership, origin?: ChangeOrigin): Promise<void>;
  listMembers(membership: BoardMembership): Promise<BoardMember[]>;
  /** Adds a registered user, found by email, to the board. */
  addMember(
    membership: BoardMembership,
    input: AddBoardMemberInput,
    origin?: ChangeOrigin,
  ): Promise<BoardMember>;
  /** Changes the role of a member other than the OWNER. */
  updateMemberRole(
    membership: BoardMembership,
    targetUserId: string,
    input: UpdateBoardMemberInput,
    origin?: ChangeOrigin,
  ): Promise<BoardMember>;
  /**
   * Removes another member (managers only, never the OWNER), or lets the caller leave the board.
   * The removed user's sockets are forced out of the board room.
   */
  removeMember(
    membership: BoardMembership,
    targetUserId: string,
    origin?: ChangeOrigin,
  ): Promise<void>;
}

export interface BoardServiceDependencies {
  boards: BoardRepository;
  members: BoardMemberRepository;
  users: Pick<UserRepository, 'findByEmail'>;
  events?: BoardEvents;
}

const MEMBER_NOT_FOUND_MESSAGE = 'Member not found';

/** Attempts to create a board when concurrent requests keep taking the chosen key. */
export const MAX_BOARD_KEY_ATTEMPTS = 5;

/** The default columns of a new board with evenly spread ranks. */
export function defaultBoardColumns(): InitialColumnData[] {
  const ranks = rankSequenceBetween(null, null, DEFAULT_BOARD_COLUMNS.length);
  return DEFAULT_BOARD_COLUMNS.map(({ title, category }, index) => {
    const rank = ranks[index];
    if (rank === undefined) {
      throw new Error('rankSequenceBetween returned fewer keys than requested');
    }
    return { title, category, rank };
  });
}

export function toBoard(board: BoardRecord, role: BoardRole): Board {
  return {
    id: board.id,
    name: board.name,
    key: board.key,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    role,
  };
}

/** A board without the viewer's role (for events sent to all members). */
export function toBoardSummary(board: BoardRecord): BoardSummary {
  return {
    id: board.id,
    name: board.name,
    key: board.key,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
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
  events = noopBoardEvents,
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

  /** Removes a non-owner member (and unassigns their cards); 503 `BOARD_BUSY` on lock timeout. */
  async function removeUnlessOwner(boardId: string, userId: string): Promise<boolean> {
    try {
      return await members.removeUnlessOwner(boardId, userId);
    } catch (err) {
      throw busyToServiceUnavailable(err);
    }
  }

  return {
    async listForUser(userId) {
      const list = await boards.listForUser(userId);
      return list.map(({ board, role }) => toBoard(board, role));
    },

    async create(userId, { name }) {
      const taken = new Set(await boards.listKeysForOwner(userId));
      const columns = defaultBoardColumns();
      for (let attempt = 1; attempt <= MAX_BOARD_KEY_ATTEMPTS; attempt++) {
        const key = pickBoardKey(name, taken);
        const result = await boards.createWithOwner({ name, key, ownerId: userId, columns });
        if (result.status === 'created') return toBoard(result.board, 'OWNER');
        // A concurrent request of the same user took the key meanwhile; try the next candidate.
        taken.add(key);
      }
      throw new ConflictError(
        'Could not choose a unique board key; please try again',
        BOARD_ERROR_CODES.BOARD_KEY_TAKEN,
      );
    },

    async get(membership) {
      assertBoardPermission(membership, 'board:view');
      const board = await boards.findById(membership.boardId);
      if (!board) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
      return toBoard(board, membership.role);
    },

    async update(membership, { name, key }, origin) {
      assertBoardPermission(membership, 'board:rename');
      const { boardId, userId } = membership;
      const result = await boards.update(boardId, { name, key });
      switch (result.status) {
        case 'updated':
          events.publish(
            'board:updated',
            { boardId, actorId: userId, board: toBoardSummary(result.board) },
            origin,
          );
          return toBoard(result.board, membership.role);
        case 'not-found':
          throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
        case 'key-taken':
          throw new ConflictError(
            'Another board of the owner already uses this key',
            BOARD_ERROR_CODES.BOARD_KEY_TAKEN,
          );
      }
    },

    async delete(membership, origin) {
      assertBoardPermission(membership, 'board:delete');
      const { boardId, userId } = membership;
      if (!(await boards.delete(boardId))) {
        throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
      events.closeBoard({ boardId, actorId: userId }, origin);
    },

    async listMembers(membership) {
      assertBoardPermission(membership, 'board:view');
      const list = await members.listForBoard(membership.boardId);
      return list.map(toBoardMember);
    },

    async addMember(membership, { email, role }, origin) {
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
        case 'created': {
          const member = toBoardMember(result.member);
          events.publish(
            'member:added',
            { boardId: membership.boardId, actorId: membership.userId, member },
            origin,
          );
          return member;
        }
        case 'already-member':
          throw new ConflictError(
            'This user is already a member of the board',
            BOARD_ERROR_CODES.ALREADY_MEMBER,
          );
        case 'missing-reference':
          throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
      }
    },

    async updateMemberRole(membership, targetUserId, { role }, origin) {
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
      const member = toBoardMember(updated);
      events.publish('member:updated', { boardId, actorId: membership.userId, member }, origin);
      return member;
    },

    async removeMember(membership, targetUserId, origin) {
      const { boardId, userId } = membership;
      // The removed user first loses the room, so they never see events after their removal.
      const announceRemoval = () => {
        events.revokeAccess(boardId, targetUserId, origin);
        events.publish(
          'member:removed',
          { boardId, actorId: userId, userId: targetUserId },
          origin,
        );
      };

      if (targetUserId === userId) {
        if (!canLeaveBoard(membership.role)) {
          throw new ConflictError(
            'The board owner cannot leave the board',
            BOARD_ERROR_CODES.OWNER_CANNOT_LEAVE,
          );
        }
        if (!(await removeUnlessOwner(boardId, userId))) {
          throw new NotFoundError(MEMBER_NOT_FOUND_MESSAGE);
        }
        announceRemoval();
        return;
      }

      assertBoardPermission(membership, 'members:manage');
      if (!(await removeUnlessOwner(boardId, targetUserId))) {
        await failForTarget(boardId, targetUserId, 'The board owner cannot be removed');
      }
      announceRemoval();
    },
  };
}
