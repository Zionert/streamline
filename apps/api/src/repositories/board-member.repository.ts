import type {
  BoardMember as BoardMemberRecord,
  BoardRole,
  User,
} from '../generated/prisma/client.js';
import {
  insertActivity,
  type ActivityRecord,
  type NewActivityData,
} from './activity.repository.js';
import {
  createBoardTransactionRunner,
  lockBoardRow,
  type BoardTransactionOptions,
  type QueryClient,
} from './board-transaction.js';
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
  | { status: 'created'; member: BoardMemberWithUser; activity: ActivityRecord }
  | { status: 'already-member' }
  /** The board or the user was deleted in the meantime. */
  | { status: 'missing-reference' };

export type UpdateBoardMemberRoleResult =
  | { status: 'updated'; member: BoardMemberWithUser; activity: ActivityRecord | null }
  | { status: 'not-found' }
  /** The member is the OWNER, whose role never changes through this method. */
  | { status: 'owner' };

export type RemoveBoardMemberResult =
  | { status: 'removed'; activity: ActivityRecord }
  | { status: 'not-found' }
  /** The member is the OWNER, who can never be removed. */
  | { status: 'owner' };

/**
 * Builds the activity entry of a membership change from the rows read in its transaction (the
 * repository writes it in the same transaction). Returning `null` writes no entry.
 */
export type DescribeMemberChange<Args extends unknown[]> = (
  ...args: Args
) => NewActivityData | null;

export interface BoardMemberRepository {
  find(boardId: string, userId: string): Promise<BoardMemberRecord | null>;
  findWithUser(boardId: string, userId: string): Promise<BoardMemberWithUser | null>;
  /** Members ordered by role (OWNER first), then by join date. */
  listForBoard(boardId: string): Promise<BoardMemberWithUser[]>;
  /**
   * Adds the member and writes the activity entry described by `describe` in one transaction
   * (holding the shared board lock).
   */
  add(
    data: AddBoardMemberData,
    describe: (member: BoardMemberWithUser) => NewActivityData,
  ): Promise<AddBoardMemberResult>;
  /**
   * Changes the member's role unless the member is the OWNER (the member row is locked while it
   * is checked and updated), with the activity entry from `describe`, in one transaction.
   */
  updateRoleUnlessOwner(
    boardId: string,
    userId: string,
    role: BoardRole,
    describe: DescribeMemberChange<[before: BoardMemberWithUser, after: BoardMemberWithUser]>,
  ): Promise<UpdateBoardMemberRoleResult>;
  /**
   * Removes the member unless it is the OWNER and, in the same transaction, unassigns them from
   * the board's cards and writes the activity entry from `describe`.
   */
  removeUnlessOwner(
    boardId: string,
    userId: string,
    describe: (removed: BoardMemberWithUser) => NewActivityData,
  ): Promise<RemoveBoardMemberResult>;
}

const userSelect = { select: { id: true, name: true, email: true } } as const;

/** Locks the member row (`mode`) and reads it with its user; `null` if it does not exist. */
async function lockMember(
  tx: QueryClient,
  boardId: string,
  userId: string,
  mode: 'update' | 'no-key-update',
): Promise<BoardMemberWithUser | null> {
  const rows =
    mode === 'update'
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "BoardMember"
          WHERE "boardId" = ${boardId} AND "userId" = ${userId} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "BoardMember"
          WHERE "boardId" = ${boardId} AND "userId" = ${userId} FOR NO KEY UPDATE`;
  if (rows.length === 0) return null;
  return tx.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    include: { user: userSelect },
  });
}

/**
 * Board memberships. Every change locks the board row (`FOR SHARE`) first, like the card and
 * column writes, and is recorded in the activity log in its transaction. Waits for locks at
 * most `lockTimeoutMs` (`BoardBusyError` otherwise).
 */
export function createBoardMemberRepository(
  db: DbClient,
  options: Partial<BoardTransactionOptions> = {},
): BoardMemberRepository {
  const run = createBoardTransactionRunner(db, null, options);

  async function record(tx: QueryClient, draft: NewActivityData | null) {
    return draft ? insertActivity(tx, draft) : null;
  }

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

    async add(data, describe) {
      try {
        return await run(async (tx): Promise<AddBoardMemberResult> => {
          if (!(await lockBoardRow(tx, data.boardId, 'shared'))) {
            return { status: 'missing-reference' };
          }
          const member = await tx.boardMember.create({ data, include: { user: userSelect } });
          const activity = await insertActivity(tx, describe(member));
          return { status: 'created', member, activity };
        });
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

    updateRoleUnlessOwner(boardId, userId, role, describe) {
      return run(async (tx): Promise<UpdateBoardMemberRoleResult> => {
        if (!(await lockBoardRow(tx, boardId, 'shared'))) return { status: 'not-found' };
        const before = await lockMember(tx, boardId, userId, 'no-key-update');
        if (!before) return { status: 'not-found' };
        // The OWNER row can never be modified here, even by a concurrent request (it is locked).
        if (before.role === 'OWNER') return { status: 'owner' };
        const member = await tx.boardMember.update({
          where: { id: before.id },
          data: { role },
          include: { user: userSelect },
        });
        return { status: 'updated', member, activity: await record(tx, describe(before, member)) };
      });
    },

    removeUnlessOwner(boardId, userId, describe) {
      return run(async (tx): Promise<RemoveBoardMemberResult> => {
        if (!(await lockBoardRow(tx, boardId, 'shared'))) return { status: 'not-found' };
        // Locking the row first waits for transactions that hold it (card assignments), so the
        // update below also sees cards they assigned to the user.
        const member = await lockMember(tx, boardId, userId, 'update');
        if (!member) return { status: 'not-found' };
        if (member.role === 'OWNER') return { status: 'owner' };
        await tx.boardMember.delete({ where: { id: member.id } });
        await tx.card.updateMany({
          where: { boardId, assigneeId: userId },
          data: { assigneeId: null },
        });
        return { status: 'removed', activity: await insertActivity(tx, describe(member)) };
      });
    },
  };
}
