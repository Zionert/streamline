import {
  boardResponseSchema,
  columnListResponseSchema,
  columnResponseSchema,
  errorResponseSchema,
  isValidRank,
  RANK_MAX_LENGTH,
  rankBetween,
  type BoardRole,
  type Column,
} from '@streamline/shared';
import type { Express } from 'express';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createColumnRepository,
  type ColumnRepository,
} from '../repositories/column.repository.js';
import type { DbClient } from '../repositories/db.js';
import { createColumnService } from '../services/column.service.js';
import { createTokenService, type TokenService } from '../services/token.service.js';
import { buildTestApp, createTestConfig, createTestDb, resetDatabase } from '../test/helpers.js';

type Actor = BoardRole | 'OUTSIDER';

interface TestUser {
  id: string;
  token: string;
}

interface DefaultColumns {
  backlog: Column;
  todo: Column;
  inProgress: Column;
  done: Column;
}

interface Fixture {
  boardId: string;
  users: Record<Actor, TestUser>;
  /** The four default columns of the board, in order. */
  cols: DefaultColumns;
  /** Another board (owned by OUTSIDER) and one of its columns. */
  otherBoardId: string;
  otherColumnId: string;
}

const ACTORS: readonly Actor[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'OUTSIDER'];

let db: DbClient;
let app: Express;
let tokens: TokenService;
let fx: Fixture;
let userCounter = 0;

beforeAll(() => {
  db = createTestDb();
  app = buildTestApp(db);
  tokens = createTokenService(createTestConfig());
});

beforeEach(async () => {
  await resetDatabase(db);
  fx = await seed();
});

afterAll(async () => {
  await db.$disconnect();
});

async function createUser(label: string): Promise<TestUser> {
  userCounter += 1;
  const user = await db.user.create({
    data: {
      email: `${label.toLowerCase()}-${userCounter}@example.com`,
      passwordHash: 'not-a-real-hash',
      name: label,
    },
  });
  return { id: user.id, token: await tokens.signAccessToken(user.id) };
}

function as(user: TestUser, test: Test): Test {
  return test.set('Authorization', `Bearer ${user.token}`);
}

function expectStatus(response: Response, status: number, code?: string): void {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  if (code !== undefined) {
    expect(errorResponseSchema.parse(response.body).error.code).toBe(code);
  }
}

async function createBoard(owner: TestUser, name: string): Promise<string> {
  const response = await as(owner, request(app).post('/boards')).send({ name });
  expectStatus(response, 201);
  return boardResponseSchema.parse(response.body).board.id;
}

async function listColumns(boardId: string, user: TestUser = fx.users.OWNER): Promise<Column[]> {
  const response = await as(user, request(app).get(`/boards/${boardId}/columns`));
  expectStatus(response, 200);
  return columnListResponseSchema.parse(response.body).columns;
}

async function seed(): Promise<Fixture> {
  const users = {} as Record<Actor, TestUser>;
  for (const actor of ACTORS) {
    users[actor] = await createUser(actor);
  }
  const boardId = await createBoard(users.OWNER, 'Roadmap');
  await db.boardMember.createMany({
    data: (['ADMIN', 'MEMBER', 'VIEWER'] as const).map((role) => ({
      boardId,
      userId: users[role].id,
      role,
    })),
  });
  const otherBoardId = await createBoard(users.OUTSIDER, 'Elsewhere');
  const otherColumn = await db.column.findFirstOrThrow({ where: { boardId: otherBoardId } });

  fx = { boardId, users, cols: {} as DefaultColumns, otherBoardId, otherColumnId: otherColumn.id };
  const [backlog, todo, inProgress, done] = await listColumns(boardId, users.OWNER);
  if (!backlog || !todo || !inProgress || !done) throw new Error('Expected 4 default columns');
  fx.cols = { backlog, todo, inProgress, done };
  return fx;
}

const columnsPath = (suffix = ''): string => `/boards/${fx.boardId}/columns${suffix}`;

function owner(test: Test): Test {
  return as(fx.users.OWNER, test);
}

function parseColumn(response: Response): Column {
  return columnResponseSchema.parse(response.body).column;
}

async function titles(boardId = fx.boardId): Promise<string[]> {
  return (await listColumns(boardId)).map((column) => column.title);
}

/** Asserts the invariants of a board's column list: valid, short, unique, ascending ranks. */
function expectValidRanks(columns: readonly Column[]): void {
  const ranks = columns.map((column) => column.rank);
  for (const rank of ranks) {
    expect(isValidRank(rank), rank).toBe(true);
    expect(rank.length).toBeLessThanOrEqual(RANK_MAX_LENGTH);
  }
  expect(new Set(ranks).size).toBe(ranks.length);
  expect([...ranks].sort()).toEqual(ranks);
}

/** Waits until `count` sessions of the test database are blocked waiting for a lock. */
async function waitForLockWaiters(count: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS "waiting" FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if ((row?.waiting ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`Expected ${count} sessions waiting for a lock`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Starts two requests while a test transaction holds the board row, and releases it only once
 * both are blocked on it, so they really run concurrently.
 */
async function whileBoardLocked(start: () => Promise<Response[]>): Promise<Response[]> {
  let pending: Promise<Response[]> | undefined;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${fx.boardId} FOR UPDATE`;
    const started = start();
    pending = started;
    await waitForLockWaiters(2).catch((err: unknown) => {
      // The requests fail once the lock is released; do not leave their rejection unhandled.
      started.catch(() => undefined);
      throw err;
    });
  });
  if (!pending) throw new Error('Requests were not started');
  return pending;
}

describe('default columns', () => {
  it('creates Backlog, To Do, In Progress and Done with a new board', async () => {
    const columns = await listColumns(fx.boardId);

    expect(
      columns.map(({ title, category, wipLimit, wipStrict }) => ({
        title,
        category,
        wipLimit,
        wipStrict,
      })),
    ).toEqual([
      { title: 'Backlog', category: 'BACKLOG', wipLimit: null, wipStrict: false },
      { title: 'To Do', category: 'TODO', wipLimit: null, wipStrict: false },
      { title: 'In Progress', category: 'IN_PROGRESS', wipLimit: null, wipStrict: false },
      { title: 'Done', category: 'DONE', wipLimit: null, wipStrict: false },
    ]);
    expectValidRanks(columns);
    expect(columns.every((column) => column.boardId === fx.boardId)).toBe(true);
  });

  it('deletes the columns together with the board', async () => {
    expectStatus(await owner(request(app).delete(`/boards/${fx.boardId}`)), 204);

    expect(await db.column.count({ where: { boardId: fx.boardId } })).toBe(0);
  });
});

describe('role matrix', () => {
  interface MatrixRow {
    name: string;
    request: (actor: TestUser) => Test;
    expected: Record<Actor, number>;
  }

  const rows: MatrixRow[] = [
    {
      name: 'GET /columns',
      request: (actor) => as(actor, request(app).get(columnsPath())),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 200, OUTSIDER: 404 },
    },
    {
      name: 'POST /columns',
      request: (actor) => as(actor, request(app).post(columnsPath())).send({ title: 'Review' }),
      expected: { OWNER: 201, ADMIN: 201, MEMBER: 201, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'PATCH /columns/:columnId',
      request: (actor) =>
        as(actor, request(app).patch(columnsPath(`/${fx.cols.todo.id}`))).send({ title: 'Next' }),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'PATCH /columns/:columnId/move',
      request: (actor) =>
        as(actor, request(app).patch(columnsPath(`/${fx.cols.done.id}/move`))).send({
          afterId: null,
        }),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'PATCH /columns/:columnId/settings',
      request: (actor) =>
        as(actor, request(app).patch(columnsPath(`/${fx.cols.inProgress.id}/settings`))).send({
          wipLimit: 3,
        }),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 403, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'DELETE /columns/:columnId',
      request: (actor) => as(actor, request(app).delete(columnsPath(`/${fx.cols.backlog.id}`))),
      expected: { OWNER: 204, ADMIN: 204, MEMBER: 204, VIEWER: 403, OUTSIDER: 404 },
    },
  ];

  const cases = rows.flatMap((row) =>
    ACTORS.map((actor) => ({ ...row, actor, status: row.expected[actor] })),
  );

  it.each(cases)('$name as $actor -> $status', async ({ request: send, actor, status }) => {
    const code = { 403: 'FORBIDDEN', 404: 'NOT_FOUND' }[status as 403 | 404] as string | undefined;
    expectStatus(await send(fx.users[actor]), status, code);
  });

  it('leaves the columns unchanged after forbidden requests', async () => {
    const before = await listColumns(fx.boardId);
    await as(fx.users.VIEWER, request(app).post(columnsPath())).send({ title: 'X' });
    await as(fx.users.VIEWER, request(app).delete(columnsPath(`/${fx.cols.todo.id}`)));
    await as(fx.users.MEMBER, request(app).patch(columnsPath(`/${fx.cols.todo.id}/settings`))).send(
      { wipLimit: 1 },
    );

    expect(await listColumns(fx.boardId)).toEqual(before);
  });

  it('checks the role before validating the body', async () => {
    const response = await as(fx.users.VIEWER, request(app).post(columnsPath())).send({
      rank: 'U',
    });

    expectStatus(response, 403, 'FORBIDDEN');
  });

  it.each([
    ['get', ''],
    ['post', ''],
    ['patch', '/x'],
    ['patch', '/x/move'],
    ['patch', '/x/settings'],
    ['delete', '/x'],
  ] as const)('%s /columns%s requires authentication', async (method, suffix) => {
    expectStatus(await request(app)[method](columnsPath(suffix)).send({}), 401, 'UNAUTHORIZED');
  });
});

describe('column ids from other boards', () => {
  it.each([
    ['patch', '', { title: 'Hijacked' }],
    ['patch', '/move', { afterId: null }],
    ['patch', '/settings', { wipLimit: 1 }],
    ['delete', '', undefined],
  ] as const)('%s /columns/:foreignId%s -> 404', async (method, suffix, body) => {
    const response = await owner(
      request(app)[method](columnsPath(`/${fx.otherColumnId}${suffix}`)),
    ).send(body);

    expectStatus(response, 404, 'NOT_FOUND');
    const foreign = await db.column.findUniqueOrThrow({ where: { id: fx.otherColumnId } });
    expect(foreign.title).not.toBe('Hijacked');
    expect(foreign.wipLimit).toBeNull();
  });

  it('returns 404 for an unknown column id', async () => {
    const response = await owner(request(app).patch(columnsPath('/does-not-exist'))).send({
      title: 'X',
    });

    expectStatus(response, 404, 'NOT_FOUND');
  });

  it('rejects a neighbour from another board with NEIGHBOR_NOT_FOUND', async () => {
    const create = await owner(request(app).post(columnsPath())).send({
      title: 'X',
      afterId: fx.otherColumnId,
    });
    const move = await owner(request(app).patch(columnsPath(`/${fx.cols.todo.id}/move`))).send({
      beforeId: fx.otherColumnId,
    });

    expectStatus(create, 404, 'NEIGHBOR_NOT_FOUND');
    expectStatus(move, 404, 'NEIGHBOR_NOT_FOUND');
  });
});

describe('validation', () => {
  it.each([
    ['post', '', { title: 'Review', rank: 'U' }],
    ['post', '', { title: '' }],
    ['post', '', { title: 'a'.repeat(101) }],
    ['post', '', { title: 'Review', category: 'DONE' }],
    ['post', '', { title: 'Review', afterId: 'a', beforeId: 'a' }],
    ['patch', '/:todo', { title: '   ' }],
    ['patch', '/:todo', { title: 'Next', rank: 'U' }],
    ['patch', '/:todo/move', {}],
    ['patch', '/:todo/move', { rank: 'U' }],
    ['patch', '/:todo/move', { afterId: 'x', rank: 'U' }],
    ['patch', '/:todo/settings', {}],
    ['patch', '/:todo/settings', { wipLimit: 0 }],
    ['patch', '/:todo/settings', { wipLimit: 1000 }],
    ['patch', '/:todo/settings', { category: 'REVIEW' }],
    ['patch', '/:todo/settings', { title: 'Done' }],
  ] as const)('%s /columns%s %j -> 400', async (method, suffix, body) => {
    const before = await listColumns(fx.boardId);
    const path = columnsPath(suffix.replace(':todo', fx.cols.todo.id));

    const response = await owner(request(app)[method](path)).send(body);

    expectStatus(response, 400, 'VALIDATION_ERROR');
    expect(await listColumns(fx.boardId)).toEqual(before);
  });

  it('rejects a column as its own neighbour', async () => {
    const response = await owner(request(app).patch(columnsPath(`/${fx.cols.todo.id}/move`))).send({
      afterId: fx.cols.todo.id,
    });

    expectStatus(response, 400, 'VALIDATION_ERROR');
  });
});

describe('POST /boards/:boardId/columns', () => {
  it('appends a TODO column without a WIP limit at the end', async () => {
    const response = await as(fx.users.MEMBER, request(app).post(columnsPath())).send({
      title: '  Review  ',
    });

    expectStatus(response, 201);
    const column = parseColumn(response);
    expect(column).toMatchObject({
      boardId: fx.boardId,
      title: 'Review',
      category: 'TODO',
      wipLimit: null,
      wipStrict: false,
    });
    expect(column.rank > fx.cols.done.rank).toBe(true);
    expect(await titles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done', 'Review']);
  });

  it('inserts between two adjacent neighbours', async () => {
    const response = await owner(request(app).post(columnsPath())).send({
      title: 'Ready',
      afterId: fx.cols.todo.id,
      beforeId: fx.cols.inProgress.id,
    });

    expectStatus(response, 201);
    expect(await titles()).toEqual(['Backlog', 'To Do', 'Ready', 'In Progress', 'Done']);
    expectValidRanks(await listColumns(fx.boardId));
  });

  it.each([
    [{ afterId: null }, ['New', 'Backlog', 'To Do', 'In Progress', 'Done']],
    [{ beforeId: null }, ['Backlog', 'To Do', 'In Progress', 'Done', 'New']],
    [{ afterId: 'backlog' }, ['Backlog', 'New', 'To Do', 'In Progress', 'Done']],
    [{ beforeId: 'done' }, ['Backlog', 'To Do', 'In Progress', 'New', 'Done']],
  ] as const)('inserts with %j', async (position, expected) => {
    const ids: Record<string, string> = { backlog: fx.cols.backlog.id, done: fx.cols.done.id };
    const body = Object.fromEntries(
      Object.entries(position).map(([key, value]) => [key, value === null ? null : ids[value]]),
    );

    expectStatus(
      await owner(request(app).post(columnsPath())).send({ title: 'New', ...body }),
      201,
    );
    expect(await titles()).toEqual(expected);
  });

  it('creates the first column of a board without columns', async () => {
    await db.column.deleteMany({ where: { boardId: fx.boardId } });

    const response = await owner(request(app).post(columnsPath())).send({ title: 'Only' });

    expectStatus(response, 201);
    expect(isValidRank(parseColumn(response).rank)).toBe(true);
  });

  it('rejects non-adjacent neighbours with INVALID_POSITION', async () => {
    const response = await owner(request(app).post(columnsPath())).send({
      title: 'Stale',
      afterId: fx.cols.backlog.id,
      beforeId: fx.cols.done.id,
    });

    expectStatus(response, 409, 'INVALID_POSITION');
    expect(await titles()).not.toContain('Stale');
  });
});

describe('PATCH /boards/:boardId/columns/:columnId', () => {
  it('renames the column and keeps its position', async () => {
    const response = await as(
      fx.users.MEMBER,
      request(app).patch(columnsPath(`/${fx.cols.todo.id}`)),
    ).send({ title: ' Selected ' });

    expectStatus(response, 200);
    expect(parseColumn(response)).toMatchObject({ title: 'Selected', rank: fx.cols.todo.rank });
  });
});

describe('PATCH /boards/:boardId/columns/:columnId/move', () => {
  const move = (columnId: string, body: object): Test =>
    owner(request(app).patch(columnsPath(`/${columnId}/move`))).send(body);

  it('moves a column to the start', async () => {
    const response = await move(fx.cols.done.id, { afterId: null });

    expectStatus(response, 200);
    expect(parseColumn(response).rank < fx.cols.backlog.rank).toBe(true);
    expect(await titles()).toEqual(['Done', 'Backlog', 'To Do', 'In Progress']);
  });

  it('moves a column to the end', async () => {
    expectStatus(await move(fx.cols.backlog.id, { beforeId: null }), 200);

    expect(await titles()).toEqual(['To Do', 'In Progress', 'Done', 'Backlog']);
  });

  it('moves a column between two adjacent neighbours', async () => {
    const response = await move(fx.cols.done.id, {
      afterId: fx.cols.backlog.id,
      beforeId: fx.cols.todo.id,
    });

    expectStatus(response, 200);
    const columns = await listColumns(fx.boardId);
    expect(columns.map((column) => column.title)).toEqual([
      'Backlog',
      'Done',
      'To Do',
      'In Progress',
    ]);
    expect(columns[1]).toEqual(parseColumn(response));
    expectValidRanks(columns);
  });

  it('treats neighbours as adjacent when the moved column sits between them', async () => {
    const response = await move(fx.cols.todo.id, {
      afterId: fx.cols.backlog.id,
      beforeId: fx.cols.inProgress.id,
    });

    expectStatus(response, 200);
    expect(parseColumn(response).rank).toBe(fx.cols.todo.rank);
    expect(await titles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
  });

  it('moves with only afterId or only beforeId', async () => {
    expectStatus(await move(fx.cols.backlog.id, { afterId: fx.cols.inProgress.id }), 200);
    expect(await titles()).toEqual(['To Do', 'In Progress', 'Backlog', 'Done']);

    expectStatus(await move(fx.cols.done.id, { beforeId: fx.cols.todo.id }), 200);
    expect(await titles()).toEqual(['Done', 'To Do', 'In Progress', 'Backlog']);
  });

  it('rejects non-adjacent neighbours with INVALID_POSITION', async () => {
    const response = await move(fx.cols.done.id, {
      afterId: fx.cols.backlog.id,
      beforeId: fx.cols.inProgress.id,
    });

    expectStatus(response, 409, 'INVALID_POSITION');
    expect(await titles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
  });

  it('rejects neighbours given in the wrong order with INVALID_POSITION', async () => {
    const response = await move(fx.cols.done.id, {
      afterId: fx.cols.todo.id,
      beforeId: fx.cols.backlog.id,
    });

    expectStatus(response, 409, 'INVALID_POSITION');
  });
});

describe('PATCH /boards/:boardId/columns/:columnId/settings', () => {
  const settings = (columnId: string, body: object, user = fx.users.ADMIN): Test =>
    as(user, request(app).patch(columnsPath(`/${columnId}/settings`))).send(body);

  it('updates the category, WIP limit and strictness', async () => {
    const response = await settings(fx.cols.inProgress.id, {
      category: 'TODO',
      wipLimit: 5,
      wipStrict: true,
    });

    expectStatus(response, 200);
    expect(parseColumn(response)).toMatchObject({
      title: 'In Progress',
      rank: fx.cols.inProgress.rank,
      category: 'TODO',
      wipLimit: 5,
      wipStrict: true,
    });
  });

  it('changes only the given fields and removes the limit with null', async () => {
    await settings(fx.cols.inProgress.id, { wipLimit: 5, wipStrict: true });

    const response = await settings(fx.cols.inProgress.id, { wipLimit: null });

    expectStatus(response, 200);
    expect(parseColumn(response)).toMatchObject({
      category: 'IN_PROGRESS',
      wipLimit: null,
      wipStrict: true,
    });
  });

  it('refuses to change the category of the last DONE column', async () => {
    const response = await settings(fx.cols.done.id, { category: 'IN_PROGRESS' });

    expectStatus(response, 409, 'LAST_DONE_COLUMN');
    const done = await db.column.findUniqueOrThrow({ where: { id: fx.cols.done.id } });
    expect(done.category).toBe('DONE');
  });

  it('allows other settings of the last DONE column', async () => {
    expectStatus(await settings(fx.cols.done.id, { category: 'DONE', wipLimit: 10 }), 200);
  });

  it('allows changing a DONE column when another DONE column exists', async () => {
    expectStatus(await settings(fx.cols.todo.id, { category: 'DONE' }), 200);

    expectStatus(await settings(fx.cols.done.id, { category: 'TODO' }), 200);
  });
});

describe('DELETE /boards/:boardId/columns/:columnId', () => {
  const remove = (columnId: string): Test =>
    as(fx.users.MEMBER, request(app).delete(columnsPath(`/${columnId}`)));

  it('deletes a column', async () => {
    expectStatus(await remove(fx.cols.todo.id), 204);

    expect(await titles()).toEqual(['Backlog', 'In Progress', 'Done']);
  });

  it('refuses to delete the last DONE column', async () => {
    expectStatus(await remove(fx.cols.done.id), 409, 'LAST_DONE_COLUMN');

    expect(await titles()).toContain('Done');
  });

  it('deletes a DONE column that is not the last one', async () => {
    await db.column.update({ where: { id: fx.cols.todo.id }, data: { category: 'DONE' } });

    expectStatus(await remove(fx.cols.done.id), 204);
    expectStatus(await remove(fx.cols.todo.id), 409, 'LAST_DONE_COLUMN');
  });

  it('returns 404 for an already deleted column', async () => {
    expectStatus(await remove(fx.cols.todo.id), 204);

    expectStatus(await remove(fx.cols.todo.id), 404, 'NOT_FOUND');
  });
});

describe('rank collation in PostgreSQL', () => {
  it('orders ranks in the database exactly like JavaScript string comparison', async () => {
    await db.column.deleteMany({ where: { boardId: fx.boardId } });
    // Mixed case and digits: a locale-aware collation would interleave upper- and lowercase.
    const ranks = [
      'a',
      'B',
      'Z',
      'z',
      'b',
      'A',
      '0a',
      '1',
      'A1',
      'aZ',
      'Az',
      '9',
      'b0z',
      'Zz',
      'zA',
    ];
    await db.column.createMany({
      data: ranks.map((rank) => ({ boardId: fx.boardId, title: rank, rank, category: 'TODO' })),
    });

    const expected = [...ranks].sort();
    expect([...ranks].sort((x, y) => x.localeCompare(y))).not.toEqual(expected);

    const rows = await db.$queryRaw<{ rank: string }[]>`
      SELECT "rank" FROM "Column" WHERE "boardId" = ${fx.boardId} ORDER BY "rank"`;
    expect(rows.map((row) => row.rank)).toEqual(expected);
    expect((await listColumns(fx.boardId)).map((column) => column.rank)).toEqual(expected);
  });
});

describe('concurrency', () => {
  it('lets two parallel moves into the same gap both succeed with unique ranks', async () => {
    const x = parseColumn(await owner(request(app).post(columnsPath())).send({ title: 'X' }));
    const y = parseColumn(await owner(request(app).post(columnsPath())).send({ title: 'Y' }));
    const gap = { afterId: fx.cols.backlog.id, beforeId: fx.cols.todo.id };

    // Hold row locks on X and Y so both requests read the same neighbours and then block at
    // their UPDATE; releasing the locks lets them write the same rank at the same time.
    let pending: Promise<Response[]> | undefined;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Column" WHERE "id" IN (${x.id}, ${y.id}) FOR UPDATE`;
      const started = Promise.all(
        [x, y].map((column) =>
          owner(request(app).patch(columnsPath(`/${column.id}/move`))).send(gap),
        ),
      );
      pending = started;
      await waitForLockWaiters(2).catch((err: unknown) => {
        started.catch(() => undefined);
        throw err;
      });
    });
    if (!pending) throw new Error('Requests were not started');
    const responses = await pending;

    for (const response of responses) expectStatus(response, 200);
    const columns = await listColumns(fx.boardId);
    expectValidRanks(columns);
    const order = columns.map((column) => column.title);
    expect(order.slice(0, 1)).toEqual(['Backlog']);
    expect([...order.slice(1, 3)].sort()).toEqual(['X', 'Y']);
    expect(order.slice(3)).toEqual(['To Do', 'In Progress', 'Done']);
    for (const response of responses) {
      const moved = parseColumn(response);
      expect(columns.find((column) => column.id === moved.id)?.rank).toBe(moved.rank);
    }
  });

  it('retries after a rank collision and places the column next to afterId', async () => {
    const x = parseColumn(await owner(request(app).post(columnsPath())).send({ title: 'X' }));
    const y = parseColumn(await owner(request(app).post(columnsPath())).send({ title: 'Y' }));
    const real = createColumnRepository(db);
    let interfered = false;
    // Before the first attempt writes, another connection commits Y at exactly the rank the
    // attempt is about to compute, so the unique constraint must reject it.
    const columns: ColumnRepository = {
      ...real,
      transaction: (fn) =>
        real.transaction((store) =>
          fn({
            ...store,
            async listForBoard(boardId) {
              const list = await store.listForBoard(boardId);
              if (!interfered) {
                interfered = true;
                await db.column.update({
                  where: { id: y.id },
                  data: { rank: rankBetween(fx.cols.backlog.rank, fx.cols.todo.rank) },
                });
              }
              return list;
            },
          }),
        ),
    };
    const service = createColumnService({ columns });

    const moved = await service.move(
      { boardId: fx.boardId, userId: fx.users.OWNER.id, role: 'OWNER' },
      x.id,
      { afterId: fx.cols.backlog.id, beforeId: fx.cols.todo.id },
    );

    expect(interfered).toBe(true);
    const list = await listColumns(fx.boardId);
    expect(list.map((column) => column.title)).toEqual([
      'Backlog',
      'X',
      'Y',
      'To Do',
      'In Progress',
      'Done',
    ]);
    expect(list[1]?.rank).toBe(moved.rank);
    expectValidRanks(list);
  });

  it('lets exactly one of two parallel deletes of the last two DONE columns succeed', async () => {
    await db.column.update({ where: { id: fx.cols.inProgress.id }, data: { category: 'DONE' } });

    const responses = await whileBoardLocked(() =>
      Promise.all(
        [fx.cols.inProgress.id, fx.cols.done.id].map((id) =>
          owner(request(app).delete(columnsPath(`/${id}`))),
        ),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([204, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict && errorResponseSchema.parse(conflict.body).error.code).toBe(
      'LAST_DONE_COLUMN',
    );
    expect(await db.column.count({ where: { boardId: fx.boardId, category: 'DONE' } })).toBe(1);
  });

  it('keeps one DONE column when a delete races a category change', async () => {
    await db.column.update({ where: { id: fx.cols.inProgress.id }, data: { category: 'DONE' } });

    const responses = await whileBoardLocked(() =>
      Promise.all([
        owner(request(app).delete(columnsPath(`/${fx.cols.inProgress.id}`))),
        owner(request(app).patch(columnsPath(`/${fx.cols.done.id}/settings`))).send({
          category: 'TODO',
        }),
      ]),
    );

    const [deleted, changed] = responses.map((response) => response.status);
    // Whichever request runs second sees a single DONE column left and is refused.
    expect([
      [204, 409],
      [409, 200],
    ]).toContainEqual([deleted, changed]);
    expect(await db.column.count({ where: { boardId: fx.boardId, category: 'DONE' } })).toBe(1);
  });
});

describe('rebalancing', () => {
  /** Ranks 1 < 2 < 2000…01 (exactly RANK_MAX_LENGTH long) < 3: the gap before it is full. */
  const tightRank = `2${'0'.repeat(RANK_MAX_LENGTH - 2)}1`;

  beforeEach(async () => {
    const ranks: [Column, string][] = [
      [fx.cols.backlog, '1'],
      [fx.cols.todo, '2'],
      [fx.cols.inProgress, tightRank],
      [fx.cols.done, '3'],
    ];
    for (const [column, rank] of ranks) {
      await db.column.update({ where: { id: column.id }, data: { rank } });
    }
    expect(rankBetween('2', tightRank).length).toBeGreaterThan(RANK_MAX_LENGTH);
  });

  it('rebalances the board when an insert would need a too long rank', async () => {
    const response = await owner(request(app).post(columnsPath())).send({
      title: 'Ready',
      afterId: fx.cols.todo.id,
      beforeId: fx.cols.inProgress.id,
    });

    expectStatus(response, 201);
    const columns = await listColumns(fx.boardId);
    expect(columns.map((column) => column.title)).toEqual([
      'Backlog',
      'To Do',
      'Ready',
      'In Progress',
      'Done',
    ]);
    expectValidRanks(columns);
    expect(columns.every((column) => column.rank.length === 1)).toBe(true);
    expect(columns[2]).toEqual(parseColumn(response));
  });

  it('rebalances the board when a move would need a too long rank', async () => {
    const response = await owner(
      request(app).patch(columnsPath(`/${fx.cols.backlog.id}/move`)),
    ).send({ afterId: fx.cols.todo.id, beforeId: fx.cols.inProgress.id });

    expectStatus(response, 200);
    const columns = await listColumns(fx.boardId);
    expect(columns.map((column) => column.title)).toEqual([
      'To Do',
      'Backlog',
      'In Progress',
      'Done',
    ]);
    expectValidRanks(columns);
    expect(columns.every((column) => column.rank.length === 1)).toBe(true);
    expect(columns[1]).toEqual(parseColumn(response));
  });
});
