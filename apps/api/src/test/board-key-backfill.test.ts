import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BOARD_KEY_PATTERN } from '@streamline/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '../generated/prisma/client.js';
import type { DbClient } from '../repositories/db.js';
import { createTestDb, resetDatabase } from './helpers.js';
import { API_ROOT } from './test-database.js';

/** The backfill block of the migration that introduced board keys, exactly as deployed. */
function backfillSql(): string {
  const file = path.join(
    API_ROOT,
    'prisma/migrations/20261112014500_cards_and_board_keys/migration.sql',
  );
  const sql = readFileSync(file, 'utf8');
  const match = /-- backfill:begin\r?\n([\s\S]*?)-- backfill:end/.exec(sql);
  if (!match?.[1]) throw new Error('Backfill markers not found in the migration');
  return match[1];
}

interface BoardRow {
  name: string;
  key: string;
  ownerId: string;
}

class Rollback extends Error {}

let db: DbClient;

beforeAll(() => {
  db = createTestDb();
});

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function user(name: string): Promise<string> {
  const created = await db.user.create({
    data: { email: `${name}@example.com`, passwordHash: 'x', name },
  });
  return created.id;
}

let created = 0;

/** A board as it existed before the migration: only the OWNER membership defines the owner. */
async function legacyBoard(
  name: string,
  members: readonly { userId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' }[],
): Promise<string> {
  created += 1;
  const board = await db.board.create({
    data: {
      name,
      // Placeholders; the backfill recomputes both columns.
      key: `T${String.fromCharCode(65 + (created % 26))}${String.fromCharCode(65 + Math.floor(created / 26))}`,
      ownerId: members[0]?.userId ?? (await user(`placeholder-${String(created)}`)),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, created)),
      members: { create: [...members] },
    },
  });
  return board.id;
}

/**
 * Runs the backfill on the current rows as if the columns were new, reads the outcome with `read`
 * and rolls everything back (the DDL included).
 */
async function runBackfill<T>(read: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let result: { value: T } | undefined;
  await db
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "Board" ALTER COLUMN "key" DROP NOT NULL, ALTER COLUMN "ownerId" DROP NOT NULL',
      );
      await tx.$executeRawUnsafe('UPDATE "Board" SET "key" = NULL, "ownerId" = NULL');
      await tx.$executeRawUnsafe(backfillSql());
      result = { value: await read(tx) };
      throw new Rollback();
    })
    .catch((err: unknown) => {
      if (!(err instanceof Rollback)) throw err;
    });
  if (!result) throw new Error('The backfill did not run');
  return result.value;
}

async function backfilledBoards(): Promise<Map<string, BoardRow>> {
  return runBackfill(async (tx) => {
    const rows = await tx.$queryRaw<(BoardRow & { id: string })[]>`
      SELECT "id", "name", "key", "ownerId" FROM "Board"`;
    return new Map(rows.map(({ id, ...row }) => [id, row]));
  });
}

describe('board key backfill in the migration', () => {
  it('derives unique keys per owner from the names and takes the owner from OWNER', async () => {
    const ann = await user('ann');
    const bob = await user('bob');
    const owned = (userId: string) => [{ userId, role: 'OWNER' as const }];

    const ids = {
      sprint1: await legacyBoard('Sprint Board', owned(ann)),
      sprint2: await legacyBoard('Sprint Board', owned(ann)),
      sprint3: await legacyBoard('sprint board!', owned(ann)),
      polish: await legacyBoard('Żółta łódź', owned(ann)),
      cyrillic: await legacyBoard('Дошка проєкту', owned(ann)),
      single: await legacyBoard('Roadmap', owned(ann)),
      digits: await legacyBoard('2027', owned(ann)),
      digits2: await legacyBoard('???', owned(ann)),
      long: await legacyBoard('a b c d e f', owned(ann)),
      long2: await legacyBoard('A B C D E', owned(ann)),
      bobs: await legacyBoard('Sprint Board', [
        { userId: bob, role: 'OWNER' },
        { userId: ann, role: 'ADMIN' },
      ]),
    };

    const rows = await backfilledBoards();
    const keyOf = (id: string) => rows.get(id)?.key;

    expect(
      Object.fromEntries(Object.entries(ids).map(([label, id]) => [label, keyOf(id)])),
    ).toEqual({
      sprint1: 'SB',
      sprint2: 'SBA',
      sprint3: 'SBB',
      polish: 'ZL',
      cyrillic: 'DP',
      single: 'RO',
      digits: 'BRD',
      digits2: 'BRDA',
      long: 'ABCDE',
      long2: 'ABCDA',
      bobs: 'SB',
    });
    expect(rows.get(ids.bobs)?.ownerId).toBe(bob);
    expect(rows.get(ids.sprint1)?.ownerId).toBe(ann);
    for (const row of rows.values()) expect(row.key).toMatch(BOARD_KEY_PATTERN);
    const perOwner = [...rows.values()].map((row) => `${row.ownerId}:${row.key}`);
    expect(new Set(perOwner).size).toBe(perOwner.length);
  });

  it('promotes the most privileged member of a board without an OWNER', async () => {
    const ann = await user('ann');
    const bob = await user('bob');
    const id = await legacyBoard('Orphan', [
      { userId: ann, role: 'MEMBER' },
      { userId: bob, role: 'ADMIN' },
    ]);

    const { roles, ownerId } = await runBackfill(async (tx) => ({
      roles: await tx.boardMember.findMany({
        where: { boardId: id },
        select: { userId: true, role: true },
      }),
      ownerId: (await tx.board.findUniqueOrThrow({ where: { id } })).ownerId,
    }));

    expect(ownerId).toBe(bob);
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: bob, role: 'OWNER' },
        { userId: ann, role: 'MEMBER' },
      ]),
    );
  });

  it('removes boards without any member', async () => {
    const ann = await user('ann');
    const kept = await legacyBoard('Kept', [{ userId: ann, role: 'OWNER' }]);
    const orphan = await legacyBoard('Nobody', []);

    const rows = await backfilledBoards();

    expect(rows.has(kept)).toBe(true);
    expect(rows.has(orphan)).toBe(false);
  });
});
