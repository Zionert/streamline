import type { Board as BoardRecord, BoardRole } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import { isPrismaError, PRISMA_ERROR } from './prisma-errors.js';

export type { BoardRecord };

export interface BoardWithRole {
  board: BoardRecord;
  /** Role of the user the board was loaded for. */
  role: BoardRole;
}

export interface BoardRepository {
  /** Creates the board and makes `ownerId` its OWNER atomically. */
  createWithOwner(name: string, ownerId: string): Promise<BoardRecord>;
  findById(id: string): Promise<BoardRecord | null>;
  /** Boards the user is a member of, newest first. */
  listForUser(userId: string): Promise<BoardWithRole[]>;
  /** Returns `null` when the board does not exist. */
  rename(id: string, name: string): Promise<BoardRecord | null>;
  /** Deletes the board with its memberships; returns `false` when it did not exist. */
  delete(id: string): Promise<boolean>;
}

export function createBoardRepository(db: DbClient): BoardRepository {
  return {
    createWithOwner(name, ownerId) {
      // A nested create runs in a single transaction.
      return db.board.create({
        data: { name, members: { create: { userId: ownerId, role: 'OWNER' } } },
      });
    },

    findById(id) {
      return db.board.findUnique({ where: { id } });
    },

    async listForUser(userId) {
      const memberships = await db.boardMember.findMany({
        where: { userId },
        select: { role: true, board: true },
        orderBy: [{ board: { createdAt: 'desc' } }, { boardId: 'desc' }],
      });
      return memberships.map(({ board, role }) => ({ board, role }));
    },

    async rename(id, name) {
      try {
        return await db.board.update({ where: { id }, data: { name } });
      } catch (err) {
        if (isPrismaError(err, PRISMA_ERROR.RECORD_NOT_FOUND)) {
          return null;
        }
        throw err;
      }
    },

    async delete(id) {
      const { count } = await db.board.deleteMany({ where: { id } });
      return count > 0;
    },
  };
}
