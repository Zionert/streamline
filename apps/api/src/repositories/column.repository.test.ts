import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createColumnService } from '../services/column.service.js';
import { createTestDb, resetDatabase } from '../test/helpers.js';
import { BoardBusyError, createColumnRepository, RankCollisionError } from './column.repository.js';
import type { DbClient } from './db.js';

let db: DbClient;
let boardId: string;

beforeAll(() => {
  db = createTestDb();
});

beforeEach(async () => {
  await resetDatabase(db);
  const owner = await db.user.create({
    data: { email: 'owner@example.com', passwordHash: 'x', name: 'Owner' },
  });
  const board = await db.board.create({
    data: {
      name: 'Board',
      key: 'BO',
      ownerId: owner.id,
      columns: { create: [{ title: 'Done', rank: 'U', category: 'DONE' }] },
    },
  });
  boardId = board.id;
});

afterAll(async () => {
  await db.$disconnect();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ColumnRepository.transaction', () => {
  it('reports a collision on (boardId, rank) as RankCollisionError', async () => {
    const columns = createColumnRepository(db);

    await expect(
      columns.transaction((store) =>
        store.create({ boardId, title: 'Twin', rank: 'U', category: 'TODO' }),
      ),
    ).rejects.toBeInstanceOf(RankCollisionError);
    expect(await db.column.count({ where: { boardId } })).toBe(1);
  });

  it('rethrows unique violations of other constraints unchanged', async () => {
    const columns = createColumnRepository(db);
    const user = { email: 'twin@example.com', passwordHash: 'x', name: 'Twin' };
    await db.user.create({ data: user });

    const error: unknown = await columns
      .transaction(async () => {
        await db.user.create({ data: user });
      })
      .catch((err: unknown) => err);

    expect(error).not.toBeInstanceOf(RankCollisionError);
    expect(error).toMatchObject({ code: 'P2002' });
  });

  it('fails fast with BoardBusyError when a lock is held longer than lockTimeoutMs', async () => {
    const columns = createColumnRepository(db, { lockTimeoutMs: 100 });

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR UPDATE`;
      const started = Date.now();

      await expect(
        columns.transaction((store) => store.lockBoard(boardId, 'shared')),
      ).rejects.toBeInstanceOf(BoardBusyError);
      expect(Date.now() - started).toBeLessThan(1500);
    });
  });

  it('reports a transaction exceeding timeoutMs as BoardBusyError', async () => {
    const columns = createColumnRepository(db, { timeoutMs: 50 });

    await expect(columns.transaction(() => sleep(200))).rejects.toBeInstanceOf(BoardBusyError);
  });
});

describe('column service with a busy board', () => {
  it('answers 503 BOARD_BUSY and changes nothing when the board stays locked', async () => {
    const service = createColumnService({
      columns: createColumnRepository(db, { lockTimeoutMs: 100 }),
    });
    const owner = { boardId, userId: 'owner', role: 'OWNER' as const };

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR UPDATE`;

      await expect(service.create(owner, { title: 'Late' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'BOARD_BUSY',
      });
    });
    expect(await db.column.count({ where: { boardId } })).toBe(1);
  });
});
