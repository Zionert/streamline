import { isValidRank, RANK_MAX_LENGTH, type BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../errors/app-error.js';
import {
  BoardBusyError,
  RankCollisionError,
  type BoardLockMode,
  type ColumnRecord,
  type ColumnRepository,
  type ColumnStore,
} from '../repositories/column.repository.js';
import { createRecordingBoardEvents } from '../test/board-events.js';
import type { BoardMembership } from './board-access.service.js';
import {
  createColumnService,
  MAX_RANK_ATTEMPTS,
  resolveInsertIndex,
  toColumn,
} from './column.service.js';

const now = new Date('2026-11-11T10:00:00.000Z');

function record(id: string, rank: string, category: ColumnRecord['category'] = 'TODO') {
  return {
    id,
    boardId: 'board-1',
    title: id.toUpperCase(),
    rank,
    category,
    wipLimit: null,
    wipStrict: false,
    createdAt: now,
    updatedAt: now,
  } satisfies ColumnRecord;
}

interface FakeOptions {
  boardExists?: boolean;
  /** Number of rank writes (create / updateRank) that fail with a collision. */
  collisions?: number;
  /** Number of cards per column id (default 0). */
  cardCounts?: Record<string, number>;
}

/** In-memory repository; a transaction restores the rows when its callback throws. */
function fakeColumns(initial: ColumnRecord[], options: FakeOptions = {}) {
  let rows = initial.map((row) => ({ ...row }));
  let collisions = options.collisions ?? 0;
  const locks: BoardLockMode[] = [];
  const setRanks = vi.fn(
    (_boardId: string, assignments: readonly { id: string; rank: string }[]) => {
      for (const { id, rank } of assignments) {
        const row = rows.find((entry) => entry.id === id);
        if (row) row.rank = rank;
      }
      return Promise.resolve();
    },
  );

  const collide = (): void => {
    if (collisions > 0) {
      collisions -= 1;
      throw new RankCollisionError();
    }
  };
  const find = (id: string) => rows.find((row) => row.id === id) ?? null;

  const store: ColumnStore = {
    lockBoard: (_boardId, mode) => {
      locks.push(mode);
      return Promise.resolve(options.boardExists ?? true);
    },
    listForBoard: () =>
      Promise.resolve([...rows].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))),
    findInBoard: (_boardId, id) => Promise.resolve(find(id)),
    countByCategory: (_boardId, category) =>
      Promise.resolve(rows.filter((row) => row.category === category).length),
    countCards: (_boardId, columnId) => Promise.resolve(options.cardCounts?.[columnId] ?? 0),
    create: (data) => {
      collide();
      const created = { ...record(`new-${rows.length}`, data.rank, data.category), ...data };
      rows.push(created);
      return Promise.resolve(created);
    },
    rename: (_boardId, id, title) => {
      const row = find(id);
      if (row) row.title = title;
      return Promise.resolve(row);
    },
    updateRank: (_boardId, id, rank) => {
      collide();
      const row = find(id);
      if (row) row.rank = rank;
      return Promise.resolve(row);
    },
    updateSettings: (_boardId, id, data) => {
      const row = find(id);
      if (row) {
        if (data.category !== undefined) row.category = data.category;
        if (data.wipLimit !== undefined) row.wipLimit = data.wipLimit;
        if (data.wipStrict !== undefined) row.wipStrict = data.wipStrict;
      }
      return Promise.resolve(row);
    },
    delete: (_boardId, id) => {
      const before = rows.length;
      rows = rows.filter((row) => row.id !== id);
      return Promise.resolve(rows.length < before);
    },
    setRanks,
  };

  /** Records transaction starts (a generic method cannot be wrapped by `vi.fn` directly). */
  const transaction = vi.fn();
  const repository: ColumnRepository = {
    ...store,
    async transaction(fn) {
      transaction();
      const snapshot = rows.map((row) => ({ ...row }));
      try {
        return await fn(store);
      } catch (err) {
        rows = snapshot;
        throw err;
      }
    },
  };
  const ordered = async () => (await store.listForBoard('board-1')).map((row) => row.id);
  return { repository, store, locks, transaction, setRanks, ordered };
}

const as = (role: BoardRole): BoardMembership => ({ boardId: 'board-1', userId: 'u1', role });

const defaults = () => [
  record('a', 'F', 'BACKLOG'),
  record('b', 'U'),
  record('c', 'k', 'IN_PROGRESS'),
  record('d', 'r', 'DONE'),
];

describe('resolveInsertIndex', () => {
  const others = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it.each([
    [{}, 3],
    [{ afterId: null }, 0],
    [{ beforeId: null }, 3],
    [{ afterId: 'a' }, 1],
    [{ afterId: 'c' }, 3],
    [{ beforeId: 'a' }, 0],
    [{ beforeId: 'c' }, 2],
    [{ afterId: 'a', beforeId: 'b' }, 1],
    [{ afterId: null, beforeId: 'a' }, 0],
    [{ afterId: 'c', beforeId: null }, 3],
  ])('%j -> %i', (position, expected) => {
    expect(resolveInsertIndex(others, position)).toBe(expected);
  });

  it('places an item into an empty list at index 0', () => {
    expect(resolveInsertIndex([], { afterId: null, beforeId: null })).toBe(0);
  });

  it.each([
    { afterId: 'a', beforeId: 'c' },
    { afterId: 'b', beforeId: 'a' },
    { afterId: null, beforeId: 'b' },
    { afterId: 'a', beforeId: null },
  ])('rejects the non-adjacent pair %j in strict mode', (position) => {
    expect(() => resolveInsertIndex(others, position)).toThrow(
      expect.objectContaining({ code: 'INVALID_POSITION', statusCode: 409 }),
    );
  });

  it('in lenient mode places the item after afterId when afterId precedes beforeId', () => {
    expect(resolveInsertIndex(others, { afterId: 'a', beforeId: 'c' }, 'lenient')).toBe(1);
    expect(resolveInsertIndex(others, { afterId: null, beforeId: 'b' }, 'lenient')).toBe(0);
  });

  it('rejects a reversed pair even in lenient mode', () => {
    expect(() => resolveInsertIndex(others, { afterId: 'c', beforeId: 'a' }, 'lenient')).toThrow(
      ConflictError,
    );
  });

  it('reports an unknown neighbour as NEIGHBOR_NOT_FOUND', () => {
    expect(() => resolveInsertIndex(others, { beforeId: 'zzz' })).toThrow(
      expect.objectContaining({ code: 'NEIGHBOR_NOT_FOUND', statusCode: 404 }),
    );
  });
});

describe('ColumnService', () => {
  it('maps records to the API shape', () => {
    expect(toColumn(record('a', 'U'))).toEqual({
      id: 'a',
      boardId: 'board-1',
      title: 'A',
      rank: 'U',
      category: 'TODO',
      wipLimit: null,
      wipStrict: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it('re-checks the role even without the route guard', async () => {
    const fake = fakeColumns(defaults());
    const service = createColumnService({ columns: fake.repository });

    await expect(service.create(as('VIEWER'), { title: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.delete(as('VIEWER'), 'b')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.updateSettings(as('MEMBER'), 'b', { wipLimit: 2 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it('creates a TODO column at the end under a shared board lock', async () => {
    const fake = fakeColumns(defaults());

    const column = await createColumnService({ columns: fake.repository }).create(as('MEMBER'), {
      title: 'Review',
    });

    expect(column).toMatchObject({ title: 'Review', category: 'TODO' });
    expect(column.rank > 'r').toBe(true);
    expect(fake.locks).toEqual(['shared']);
  });

  it('returns 404 when the board disappeared', async () => {
    const fake = fakeColumns([], { boardExists: false });

    await expect(
      createColumnService({ columns: fake.repository }).create(as('OWNER'), { title: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Board not found' });
  });

  describe('rank collisions', () => {
    it('retries in a new transaction after a collision', async () => {
      const fake = fakeColumns(defaults(), { collisions: 2 });

      const moved = await createColumnService({ columns: fake.repository }).move(
        as('MEMBER'),
        'd',
        { afterId: 'a', beforeId: 'b' },
      );

      expect(fake.transaction).toHaveBeenCalledTimes(3);
      expect(await fake.ordered()).toEqual(['a', 'd', 'b', 'c']);
      expect(isValidRank(moved.rank)).toBe(true);
    });

    it(`gives up with RANK_CONFLICT after ${MAX_RANK_ATTEMPTS} attempts`, async () => {
      const fake = fakeColumns(defaults(), { collisions: Number.POSITIVE_INFINITY });

      await expect(
        createColumnService({ columns: fake.repository }).create(as('OWNER'), { title: 'X' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'RANK_CONFLICT' });
      expect(fake.transaction).toHaveBeenCalledTimes(MAX_RANK_ATTEMPTS);
      expect(await fake.ordered()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('does not retry other errors', async () => {
      const fake = fakeColumns(defaults());

      await expect(
        createColumnService({ columns: fake.repository }).move(as('OWNER'), 'd', {
          afterId: 'a',
          beforeId: 'c',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_POSITION' });
      expect(fake.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('rebalancing', () => {
    const tight = () => [
      record('a', '1'),
      record('b', '2'),
      record('c', `2${'0'.repeat(RANK_MAX_LENGTH - 2)}1`),
      record('d', '3', 'DONE'),
    ];

    it('restarts with an exclusive lock and rewrites all ranks for an insert', async () => {
      const fake = fakeColumns(tight());

      const created = await createColumnService({ columns: fake.repository }).create(as('OWNER'), {
        title: 'New',
        afterId: 'b',
        beforeId: 'c',
      });

      expect(fake.locks).toEqual(['shared', 'exclusive']);
      expect(fake.setRanks).toHaveBeenCalledTimes(1);
      expect(await fake.ordered()).toEqual(['a', 'b', created.id, 'c', 'd']);
      const ranks = (await fake.repository.listForBoard('board-1')).map((row) => row.rank);
      expect(ranks.every((rank) => isValidRank(rank) && rank.length === 1)).toBe(true);
    });

    it('rewrites all ranks for a move, including the moved column', async () => {
      const fake = fakeColumns(tight());

      const moved = await createColumnService({ columns: fake.repository }).move(as('OWNER'), 'd', {
        afterId: 'b',
      });

      expect(fake.locks).toEqual(['shared', 'exclusive']);
      expect(await fake.ordered()).toEqual(['a', 'b', 'd', 'c']);
      expect(moved.rank.length).toBe(1);
    });
  });

  describe('move', () => {
    it('does not write when the column is already at the position', async () => {
      const fake = fakeColumns(defaults());
      const updateRank = vi.spyOn(fake.store, 'updateRank');

      const moved = await createColumnService({ columns: fake.repository }).move(as('OWNER'), 'b', {
        afterId: 'a',
      });

      expect(moved.rank).toBe('U');
      expect(updateRank).not.toHaveBeenCalled();
    });

    it('rejects the moved column as its own neighbour before any query', async () => {
      const fake = fakeColumns(defaults());

      await expect(
        createColumnService({ columns: fake.repository }).move(as('OWNER'), 'b', {
          beforeId: 'b',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(fake.transaction).not.toHaveBeenCalled();
    });

    it('returns 404 for a column of another board', async () => {
      const fake = fakeColumns(defaults());

      await expect(
        createColumnService({ columns: fake.repository }).move(as('OWNER'), 'zzz', {
          afterId: null,
        }),
      ).rejects.toMatchObject({ statusCode: 404, message: 'Column not found' });
    });
  });

  describe('last DONE column', () => {
    it('refuses to delete it, under an exclusive lock', async () => {
      const fake = fakeColumns(defaults());

      await expect(
        createColumnService({ columns: fake.repository }).delete(as('MEMBER'), 'd'),
      ).rejects.toMatchObject({ statusCode: 409, code: 'LAST_DONE_COLUMN' });
      expect(fake.locks).toEqual(['exclusive']);
      expect(await fake.ordered()).toContain('d');
    });

    it('refuses to change its category but allows other settings', async () => {
      const fake = fakeColumns(defaults());
      const service = createColumnService({ columns: fake.repository });

      await expect(
        service.updateSettings(as('ADMIN'), 'd', { category: 'TODO' }),
      ).rejects.toMatchObject({ code: 'LAST_DONE_COLUMN' });
      await expect(
        service.updateSettings(as('ADMIN'), 'd', { wipLimit: 4, wipStrict: true }),
      ).resolves.toMatchObject({ category: 'DONE', wipLimit: 4, wipStrict: true });
    });

    it('allows deleting a DONE column when another one exists', async () => {
      const fake = fakeColumns([...defaults(), record('e', 'w', 'DONE')]);

      await createColumnService({ columns: fake.repository }).delete(as('MEMBER'), 'd');

      expect(await fake.ordered()).toEqual(['a', 'b', 'c', 'e']);
    });
  });

  it('refuses to delete a column with cards, under an exclusive lock', async () => {
    const fake = fakeColumns(defaults(), { cardCounts: { b: 2 } });

    await expect(
      createColumnService({ columns: fake.repository }).delete(as('MEMBER'), 'b'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'COLUMN_NOT_EMPTY' });
    expect(fake.locks).toEqual(['exclusive']);
    expect(await fake.ordered()).toContain('b');
  });

  it('maps a missing column to 404 for rename, settings and delete', async () => {
    const service = createColumnService({ columns: fakeColumns(defaults()).repository });

    await expect(service.rename(as('OWNER'), 'zzz', { title: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      service.updateSettings(as('OWNER'), 'zzz', { wipLimit: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.delete(as('OWNER'), 'zzz')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps a busy board to 503 BOARD_BUSY without retrying', async () => {
    const fake = fakeColumns(defaults());
    const columns: ColumnRepository = {
      ...fake.repository,
      transaction: () => {
        fake.transaction();
        return Promise.reject(new BoardBusyError());
      },
    };
    const service = createColumnService({ columns });
    const busy = { statusCode: 503, code: 'BOARD_BUSY' };

    await expect(service.create(as('OWNER'), { title: 'X' })).rejects.toMatchObject(busy);
    expect(fake.transaction).toHaveBeenCalledTimes(1);
    await expect(service.move(as('OWNER'), 'a', { beforeId: null })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    await expect(service.updateSettings(as('OWNER'), 'b', { wipLimit: 1 })).rejects.toMatchObject(
      busy,
    );
    await expect(service.delete(as('OWNER'), 'b')).rejects.toMatchObject(busy);
  });
});

describe('ColumnService events', () => {
  const tight = () => [
    record('a', '1'),
    record('b', '2'),
    record('c', `2${'0'.repeat(RANK_MAX_LENGTH - 2)}1`),
    record('d', '3', 'DONE'),
  ];

  it('broadcasts each change with the actor and the origin', async () => {
    const events = createRecordingBoardEvents();
    const service = createColumnService({ columns: fakeColumns(defaults()).repository, events });
    const origin = { socketId: 's1' };

    const created = await service.create(as('MEMBER'), { title: 'New' }, origin);
    const renamed = await service.rename(as('MEMBER'), 'b', { title: 'Renamed' }, origin);
    const moved = await service.move(as('MEMBER'), 'b', { afterId: 'c', beforeId: 'd' }, origin);
    const updated = await service.updateSettings(as('ADMIN'), 'c', { wipLimit: 2 }, origin);
    await service.delete(as('MEMBER'), 'a', origin);

    const meta = { boardId: 'board-1', actorId: 'u1' };
    expect(events.events).toEqual([
      { name: 'column:created', payload: { ...meta, column: created }, origin },
      { name: 'column:updated', payload: { ...meta, column: renamed }, origin },
      { name: 'column:moved', payload: { ...meta, column: moved }, origin },
      { name: 'column:updated', payload: { ...meta, column: updated }, origin },
      { name: 'column:deleted', payload: { ...meta, columnId: 'a' }, origin },
    ]);
  });

  it('announces a rebalance with the new ranks before the created column', async () => {
    const events = createRecordingBoardEvents();
    const fake = fakeColumns(tight());
    const service = createColumnService({ columns: fake.repository, events });

    const created = await service.create(as('OWNER'), {
      title: 'New',
      afterId: 'b',
      beforeId: 'c',
    });

    expect(events.events.map((event) => event.name)).toEqual([
      'columns:rebalanced',
      'column:created',
    ]);
    const [rebalance] = events.events;
    if (rebalance?.name !== 'columns:rebalanced') throw new Error('expected a rebalance first');
    const rows = await fake.repository.listForBoard('board-1');
    expect(rebalance.payload.ranks).toEqual(
      rows.filter((row) => row.id !== created.id).map(({ id, rank }) => ({ id, rank })),
    );
  });

  it('announces a rebalance of a move including the moved column', async () => {
    const events = createRecordingBoardEvents();
    const fake = fakeColumns(tight());

    await createColumnService({ columns: fake.repository, events }).move(as('OWNER'), 'd', {
      afterId: 'b',
    });

    const [rebalance, move] = events.events;
    expect(move?.name).toBe('column:moved');
    if (rebalance?.name !== 'columns:rebalanced') throw new Error('expected a rebalance first');
    const rows = await fake.repository.listForBoard('board-1');
    expect(rebalance.payload.ranks).toEqual(rows.map(({ id, rank }) => ({ id, rank })));
  });

  it('broadcasts nothing when the change fails', async () => {
    const events = createRecordingBoardEvents();
    const service = createColumnService({ columns: fakeColumns(defaults()).repository, events });

    await expect(service.rename(as('MEMBER'), 'zzz', { title: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.delete(as('MEMBER'), 'd')).rejects.toBeInstanceOf(ConflictError);
    await expect(service.create(as('VIEWER'), { title: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(events.events).toEqual([]);
  });
});
