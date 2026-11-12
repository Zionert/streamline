import type {
  Board as BoardRecord,
  BoardRole,
  ColumnCategory,
} from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import { isPrismaError, isUniqueViolationOf, PRISMA_ERROR } from './prisma-errors.js';

export type { BoardRecord };

export interface BoardWithRole {
  board: BoardRecord;
  /** Role of the user the board was loaded for. */
  role: BoardRole;
}

/** A column created together with a new board. */
export interface InitialColumnData {
  title: string;
  rank: string;
  category: ColumnCategory;
}

export interface NewBoardData {
  name: string;
  /** Must be unique among the boards of the owner. */
  key: string;
  ownerId: string;
  columns: readonly InitialColumnData[];
}

export interface BoardChanges {
  name?: string | undefined;
  key?: string | undefined;
}

export type CreateBoardResult =
  | { status: 'created'; board: BoardRecord }
  /** Another board of the owner already has the key. */
  | { status: 'key-taken' };

export type UpdateBoardResult =
  { status: 'updated'; board: BoardRecord } | { status: 'not-found' } | { status: 'key-taken' };

/** The unique constraint on board keys per owner. */
const KEY_UNIQUE_CONSTRAINT = { name: 'Board_ownerId_key_key', fields: ['ownerId', 'key'] };

export interface BoardRepository {
  /**
   * Creates the board with its initial columns and makes `ownerId` its OWNER (and `Board.ownerId`)
   * atomically.
   */
  createWithOwner(data: NewBoardData): Promise<CreateBoardResult>;
  findById(id: string): Promise<BoardRecord | null>;
  /** Keys of all boards owned by the user. */
  listKeysForOwner(ownerId: string): Promise<string[]>;
  /** Boards the user is a member of, newest first. */
  listForUser(userId: string): Promise<BoardWithRole[]>;
  update(id: string, changes: BoardChanges): Promise<UpdateBoardResult>;
  /** Deletes the board with its memberships; returns `false` when it did not exist. */
  delete(id: string): Promise<boolean>;
}

export function createBoardRepository(db: DbClient): BoardRepository {
  return {
    async createWithOwner({ name, key, ownerId, columns }) {
      try {
        // A nested create runs in a single transaction.
        const board = await db.board.create({
          data: {
            name,
            key,
            ownerId,
            members: { create: { userId: ownerId, role: 'OWNER' } },
            columns: { create: [...columns] },
          },
        });
        return { status: 'created', board };
      } catch (err) {
        if (isUniqueViolationOf(err, KEY_UNIQUE_CONSTRAINT)) {
          return { status: 'key-taken' };
        }
        throw err;
      }
    },

    findById(id) {
      return db.board.findUnique({ where: { id } });
    },

    async listKeysForOwner(ownerId) {
      const boards = await db.board.findMany({ where: { ownerId }, select: { key: true } });
      return boards.map((board) => board.key);
    },

    async listForUser(userId) {
      const memberships = await db.boardMember.findMany({
        where: { userId },
        select: { role: true, board: true },
        orderBy: [{ board: { createdAt: 'desc' } }, { boardId: 'desc' }],
      });
      return memberships.map(({ board, role }) => ({ board, role }));
    },

    async update(id, { name, key }) {
      try {
        const board = await db.board.update({ where: { id }, data: { name, key } });
        return { status: 'updated', board };
      } catch (err) {
        if (isPrismaError(err, PRISMA_ERROR.RECORD_NOT_FOUND)) {
          return { status: 'not-found' };
        }
        if (isUniqueViolationOf(err, KEY_UNIQUE_CONSTRAINT)) {
          return { status: 'key-taken' };
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
