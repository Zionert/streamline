import type {
  BoardMember as BoardMemberRecord,
  BoardRole,
  User,
} from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import { isPrismaError, PRISMA_ERROR } from './prisma-errors.js';

export type { BoardMemberRecord };

export type BoardMemberWithUser = BoardMemberRecord & {
  user: Pick<User, 'id' | 'name' | 'email'>;
};

export interface AddBoardMemberData {
  boardId: string;
  userId: string;
  role: BoardRole;
}

export type AddBoardMemberResult =
  | { status: 'created'; member: BoardMemberWithUser }
  | { status: 'already-member' }
  /** The board or the user was deleted in the meantime. */
  | { status: 'missing-reference' };

export interface BoardMemberRepository {
  find(boardId: string, userId: string): Promise<BoardMemberRecord | null>;
  findWithUser(boardId: string, userId: string): Promise<BoardMemberWithUser | null>;
  /** Members ordered by role (OWNER first), then by join date. */
  listForBoard(boardId: string): Promise<BoardMemberWithUser[]>;
  add(data: AddBoardMemberData): Promise<AddBoardMemberResult>;
  /**
   * Changes the member's role unless the member is the OWNER, in a single statement.
   * Returns `false` when nothing was updated (no such member, or the member is the OWNER).
   */
  updateRoleUnlessOwner(boardId: string, userId: string, role: BoardRole): Promise<boolean>;
  /** Like `updateRoleUnlessOwner`, but removes the member. */
  removeUnlessOwner(boardId: string, userId: string): Promise<boolean>;
}

const userSelect = { select: { id: true, name: true, email: true } } as const;

export function createBoardMemberRepository(db: DbClient): BoardMemberRepository {
  return {
    find(boardId, userId) {
      return db.boardMember.findUnique({ where: { boardId_userId: { boardId, userId } } });
    },

    findWithUser(boardId, userId) {
      return db.boardMember.findUnique({
        where: { boardId_userId: { boardId, userId } },
        include: { user: userSelect },
      });
    },

    listForBoard(boardId) {
      return db.boardMember.findMany({
        where: { boardId },
        include: { user: userSelect },
        // PostgreSQL orders enums by declaration order: OWNER, ADMIN, MEMBER, VIEWER.
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
    },

    async add(data) {
      try {
        const member = await db.boardMember.create({ data, include: { user: userSelect } });
        return { status: 'created', member };
      } catch (err) {
        if (isPrismaError(err, PRISMA_ERROR.UNIQUE_CONSTRAINT_VIOLATION)) {
          return { status: 'already-member' };
        }
        if (isPrismaError(err, PRISMA_ERROR.FOREIGN_KEY_VIOLATION)) {
          return { status: 'missing-reference' };
        }
        throw err;
      }
    },

    async updateRoleUnlessOwner(boardId, userId, role) {
      const { count } = await db.boardMember.updateMany({
        where: { boardId, userId, role: { not: 'OWNER' } },
        data: { role },
      });
      return count > 0;
    },

    async removeUnlessOwner(boardId, userId) {
      const { count } = await db.boardMember.deleteMany({
        where: { boardId, userId, role: { not: 'OWNER' } },
      });
      return count > 0;
    },
  };
}
