import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/helpers.js';
import { createBoardTransactionRunner } from './board-transaction.js';
import type { DbClient } from './db.js';

let db: DbClient;

beforeAll(() => {
  db = createTestDb();
});

afterAll(async () => {
  await db.$disconnect();
});

async function isolationOf(
  run: ReturnType<typeof createBoardTransactionRunner>,
  repeatable: boolean,
) {
  return run(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ level: string }[]>`
        SELECT current_setting('transaction_isolation') AS "level"`;
      return row?.level;
    },
    repeatable ? { isolationLevel: 'RepeatableRead' } : {},
  );
}

describe('createBoardTransactionRunner', () => {
  it('runs READ COMMITTED by default and REPEATABLE READ on request', async () => {
    const run = createBoardTransactionRunner(db, null);

    expect(await isolationOf(run, false)).toBe('read committed');
    expect(await isolationOf(run, true)).toBe('repeatable read');
  });

  it('applies lock_timeout to the transaction only', async () => {
    const run = createBoardTransactionRunner(db, null, { lockTimeoutMs: 123 });

    const inside = await run(async (tx) => {
      const [row] = await tx.$queryRaw<{ value: string }[]>`
        SELECT current_setting('lock_timeout') AS "value"`;
      return row?.value;
    });

    expect(inside).toBe('123ms');
  });
});
