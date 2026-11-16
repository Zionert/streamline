import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/helpers.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  BoardBusyError,
  createBoardTransactionRunner,
  isBoardBusyFailure,
} from './board-transaction.js';
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

function postgresError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('failed', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { driverAdapterError: Object.assign(new Error('driver'), { cause: { code } }) },
  });
}

describe('isBoardBusyFailure', () => {
  it('recognises lock timeouts, deadlocks and transaction API errors', () => {
    expect(isBoardBusyFailure(postgresError('55P03'))).toBe(true);
    expect(isBoardBusyFailure(postgresError('40P01'))).toBe(true);
    expect(
      isBoardBusyFailure(
        new Prisma.PrismaClientKnownRequestError('expired', { code: 'P2028', clientVersion: 't' }),
      ),
    ).toBe(true);
  });

  it('rejects other errors', () => {
    expect(isBoardBusyFailure(postgresError('23505'))).toBe(false);
    expect(isBoardBusyFailure(new Error('40P01'))).toBe(false);
  });
});

describe('createBoardTransactionRunner and deadlocks', () => {
  it('reports the transaction PostgreSQL aborts to break a deadlock as BoardBusyError', async () => {
    // The lock timeout must outlast PostgreSQL's deadlock detection (1 s by default).
    const run = createBoardTransactionRunner(db, null, {
      lockTimeoutMs: 8000,
      maxWaitMs: 2000,
      timeoutMs: 15000,
    });
    // Arbitrary advisory lock keys, unused anywhere else.
    const [first, second] = [918_273_001, 918_273_002];
    let holding = 0;
    let bothHolding: () => void = () => undefined;
    const bothHoldTheirFirstLock = new Promise<void>((resolve) => {
      bothHolding = resolve;
    });

    const lockInOrder = (a: number, b: number) =>
      run(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${a})::text`;
        holding += 1;
        if (holding === 2) bothHolding();
        await bothHoldTheirFirstLock;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${b})::text`;
        return 'done';
      });

    const results = await Promise.allSettled([
      lockInOrder(first, second),
      lockInOrder(second, first),
    ]);

    const rejected = results.filter((result) => result.status === 'rejected');
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BoardBusyError);
  }, 20_000);
});
