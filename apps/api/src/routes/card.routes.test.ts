import {
  boardResponseSchema,
  cardListResponseSchema,
  cardResponseSchema,
  columnListResponseSchema,
  errorResponseSchema,
  isValidRank,
  RANK_MAX_LENGTH,
  rankBetween,
  type BoardRole,
  type Card,
  type Column,
} from '@streamline/shared';
import type { Express } from 'express';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '../generated/prisma/client.js';
import { BoardBusyError } from '../repositories/board-transaction.js';
import { createBoardMemberRepository } from '../repositories/board-member.repository.js';
import { createCardRepository, type CardRepository } from '../repositories/card.repository.js';
import type { DbClient } from '../repositories/db.js';
import type { BoardMembership } from '../services/board-access.service.js';
import { createCardService } from '../services/card.service.js';
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
  cols: DefaultColumns;
  /** Another board (owned by OUTSIDER), one of its columns and one of its cards. */
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

function owner(test: Test): Test {
  return as(fx.users.OWNER, test);
}

function expectStatus(response: Response, status: number, code?: string): void {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  if (code !== undefined) {
    expect(errorResponseSchema.parse(response.body).error.code).toBe(code);
  }
}

async function createBoard(user: TestUser, name: string): Promise<string> {
  const response = await as(user, request(app).post('/boards')).send({ name });
  expectStatus(response, 201);
  return boardResponseSchema.parse(response.body).board.id;
}

async function listColumns(boardId: string, user: TestUser): Promise<Column[]> {
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
  const [otherColumn] = await listColumns(otherBoardId, users.OUTSIDER);
  if (!otherColumn) throw new Error('Expected default columns');

  const [backlog, todo, inProgress, done] = await listColumns(boardId, users.OWNER);
  if (!backlog || !todo || !inProgress || !done) throw new Error('Expected 4 default columns');
  return {
    boardId,
    users,
    cols: { backlog, todo, inProgress, done },
    otherBoardId,
    otherColumnId: otherColumn.id,
  };
}

const cardsPath = (suffix = ''): string => `/boards/${fx.boardId}/cards${suffix}`;

function parseCard(response: Response): Card {
  return cardResponseSchema.parse(response.body).card;
}

async function createCard(
  columnId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<Card> {
  const response = await owner(request(app).post(cardsPath())).send({ columnId, title, ...extra });
  expectStatus(response, 201);
  return parseCard(response);
}

function moveCard(cardId: string, body: object, user: TestUser = fx.users.OWNER): Test {
  return as(user, request(app).patch(cardsPath(`/${cardId}/move`))).send(body);
}

async function listCards(): Promise<{ columnId: string; cards: Card[] }[]> {
  const response = await owner(request(app).get(cardsPath()));
  expectStatus(response, 200);
  return cardListResponseSchema.parse(response.body).columns;
}

async function cardsIn(columnId: string): Promise<Card[]> {
  return (await listCards()).find((column) => column.columnId === columnId)?.cards ?? [];
}

async function titlesIn(columnId: string): Promise<string[]> {
  return (await cardsIn(columnId)).map((card) => card.title);
}

function transitionsOf(cardId: string) {
  return db.cardTransition.findMany({
    where: { cardId },
    orderBy: [{ movedAt: 'asc' }, { id: 'asc' }],
  });
}

async function setWip(columnId: string, wipLimit: number | null, wipStrict: boolean) {
  await db.column.update({ where: { id: columnId }, data: { wipLimit, wipStrict } });
}

/** Asserts the invariants of a column's card list: valid, short, unique, ascending ranks. */
function expectValidRanks(cards: readonly Card[]): void {
  const ranks = cards.map((card) => card.rank);
  for (const rank of ranks) {
    expect(isValidRank(rank), rank).toBe(true);
    expect(rank.length).toBeLessThanOrEqual(RANK_MAX_LENGTH);
  }
  expect(new Set(ranks).size).toBe(ranks.length);
  expect([...ranks].sort()).toEqual(ranks);
}

/** Waits until `count` sessions of the test database are blocked waiting for a lock. */
async function waitForLockWaiters(count: number, timeoutMs = 1500): Promise<void> {
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
 * Starts requests while a test transaction holds the lock taken by `lock`, and releases the lock only once
 * `waiters` of them are blocked on it, so they really run concurrently.
 */
async function whileLocked(
  lock: (tx: Prisma.TransactionClient) => Promise<unknown>,
  waiters: number,
  start: () => Promise<Response[]>,
): Promise<Response[]> {
  let pending: Promise<Response[]> | undefined;
  await db.$transaction(async (tx) => {
    await lock(tx);
    const started = start();
    pending = started;
    await waitForLockWaiters(waiters).catch((err: unknown) => {
      // The requests fail once the lock is released; do not leave their rejection unhandled.
      started.catch(() => undefined);
      throw err;
    });
  });
  if (!pending) throw new Error('Requests were not started');
  return pending;
}

const ownerMembership = (): BoardMembership => ({
  boardId: fx.boardId,
  userId: fx.users.OWNER.id,
  role: 'OWNER',
});

describe('role matrix', () => {
  interface MatrixRow {
    name: string;
    request: (actor: TestUser, card: Card) => Test;
    expected: Record<Actor, number>;
  }

  const rows: MatrixRow[] = [
    {
      name: 'GET /cards',
      request: (actor) => as(actor, request(app).get(cardsPath())),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 200, OUTSIDER: 404 },
    },
    {
      name: 'POST /cards',
      request: (actor) =>
        as(actor, request(app).post(cardsPath())).send({ columnId: fx.cols.todo.id, title: 'X' }),
      expected: { OWNER: 201, ADMIN: 201, MEMBER: 201, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'GET /cards/:cardKey',
      request: (actor, card) => as(actor, request(app).get(cardsPath(`/${card.key}`))),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 200, OUTSIDER: 404 },
    },
    {
      name: 'PATCH /cards/:cardId',
      request: (actor, card) =>
        as(actor, request(app).patch(cardsPath(`/${card.id}`))).send({ title: 'Edited' }),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'PATCH /cards/:cardId/move',
      request: (actor, card) => moveCard(card.id, { columnId: fx.cols.done.id }, actor),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'DELETE /cards/:cardId',
      request: (actor, card) => as(actor, request(app).delete(cardsPath(`/${card.id}`))),
      expected: { OWNER: 204, ADMIN: 204, MEMBER: 204, VIEWER: 403, OUTSIDER: 404 },
    },
  ];

  const cases = rows.flatMap((row) =>
    ACTORS.map((actor) => ({ ...row, actor, status: row.expected[actor] })),
  );

  it.each(cases)('$name as $actor -> $status', async ({ request: send, actor, status }) => {
    const card = await createCard(fx.cols.todo.id, 'Card');
    const code = { 403: 'FORBIDDEN', 404: 'NOT_FOUND' }[status as 403 | 404] as string | undefined;

    expectStatus(await send(fx.users[actor], card), status, code);
  });

  it('leaves cards unchanged after forbidden requests', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card');
    const before = await listCards();

    await as(fx.users.VIEWER, request(app).post(cardsPath())).send({
      columnId: fx.cols.todo.id,
      title: 'X',
    });
    await as(fx.users.VIEWER, request(app).patch(cardsPath(`/${card.id}`))).send({ title: 'X' });
    await moveCard(card.id, { columnId: fx.cols.done.id }, fx.users.VIEWER);
    await as(fx.users.VIEWER, request(app).delete(cardsPath(`/${card.id}`)));

    expect(await listCards()).toEqual(before);
    expect(await transitionsOf(card.id)).toHaveLength(1);
  });

  it('checks the role before validating the body', async () => {
    const response = await as(fx.users.VIEWER, request(app).post(cardsPath())).send({ rank: 'U' });

    expectStatus(response, 403, 'FORBIDDEN');
  });

  it.each([
    ['get', ''],
    ['post', ''],
    ['get', '/RO-1'],
    ['patch', '/x'],
    ['patch', '/x/move'],
    ['delete', '/x'],
  ] as const)('%s /cards%s requires authentication', async (method, suffix) => {
    expectStatus(await request(app)[method](cardsPath(suffix)).send({}), 401, 'UNAUTHORIZED');
  });
});

describe('POST /boards/:boardId/cards', () => {
  it('appends the card to the end of the column and records its first transition', async () => {
    const first = await createCard(fx.cols.todo.id, 'First');

    const response = await as(fx.users.MEMBER, request(app).post(cardsPath())).send({
      columnId: fx.cols.todo.id,
      title: '  Second  ',
      description: 'Some details',
      priority: 'HIGH',
      assigneeId: fx.users.ADMIN.id,
      dueDate: '2027-02-28',
    });

    expectStatus(response, 201);
    const card = parseCard(response);
    expect(card).toMatchObject({
      key: 'RO-2',
      number: 2,
      boardId: fx.boardId,
      columnId: fx.cols.todo.id,
      title: 'Second',
      description: 'Some details',
      priority: 'HIGH',
      assigneeId: fx.users.ADMIN.id,
      dueDate: '2027-02-28',
    });
    expect(first.rank < card.rank).toBe(true);
    expect(await titlesIn(fx.cols.todo.id)).toEqual(['First', 'Second']);

    const transitions = await transitionsOf(card.id);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      boardId: fx.boardId,
      fromColumnId: null,
      toColumnId: fx.cols.todo.id,
      movedById: fx.users.MEMBER.id,
    });
  });

  it('trims the description and stores a blank one as null', async () => {
    const blank = await createCard(fx.cols.todo.id, 'Blank', { description: '   ' });
    const padded = await createCard(fx.cols.todo.id, 'Padded', { description: '  Text \n' });

    expect(blank.description).toBeNull();
    expect(padded.description).toBe('Text');
  });

  it('applies defaults for the optional fields', async () => {
    const card = await createCard(fx.cols.backlog.id, 'Plain');

    expect(card).toMatchObject({
      key: 'RO-1',
      number: 1,
      description: null,
      priority: 'MEDIUM',
      assigneeId: null,
      dueDate: null,
    });
    expect(isValidRank(card.rank)).toBe(true);
  });

  it('numbers cards sequentially per board and never reuses a number', async () => {
    const one = await createCard(fx.cols.todo.id, 'One');
    const two = await createCard(fx.cols.done.id, 'Two');
    const three = await createCard(fx.cols.todo.id, 'Three');
    expect([one, two, three].map((card) => card.key)).toEqual(['RO-1', 'RO-2', 'RO-3']);

    expectStatus(await owner(request(app).delete(cardsPath(`/${three.id}`))), 204);
    const four = await createCard(fx.cols.todo.id, 'Four');

    expect(four).toMatchObject({ number: 4, key: 'RO-4' });
    const other = await as(
      fx.users.OUTSIDER,
      request(app).post(`/boards/${fx.otherBoardId}/cards`),
    ).send({ columnId: fx.otherColumnId, title: 'Elsewhere' });
    expect(parseCard(other)).toMatchObject({ number: 1, key: 'EL-1' });
  });

  it('gives concurrent creations distinct numbers and ranks', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        owner(request(app).post(cardsPath())).send({
          columnId: fx.cols.todo.id,
          title: `C${String(index)}`,
        }),
      ),
    );

    for (const response of responses) expectStatus(response, 201);
    const numbers = responses.map((response) => parseCard(response).number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    expectValidRanks(await cardsIn(fx.cols.todo.id));
  });

  it('rejects a column of another board with 404 COLUMN_NOT_FOUND', async () => {
    const response = await owner(request(app).post(cardsPath())).send({
      columnId: fx.otherColumnId,
      title: 'X',
    });

    expectStatus(response, 404, 'COLUMN_NOT_FOUND');
    expect(await db.card.count()).toBe(0);
    expect((await db.board.findUniqueOrThrow({ where: { id: fx.boardId } })).nextCardNumber).toBe(
      1,
    );
  });

  it('rejects an assignee who is not a member with 400 ASSIGNEE_NOT_MEMBER', async () => {
    const response = await owner(request(app).post(cardsPath())).send({
      columnId: fx.cols.todo.id,
      title: 'X',
      assigneeId: fx.users.OUTSIDER.id,
    });

    expectStatus(response, 400, 'ASSIGNEE_NOT_MEMBER');
    expect(await db.card.count()).toBe(0);
  });

  it.each([
    { title: 'No column' },
    { columnId: 'c', title: '' },
    { columnId: 'c', title: 'a'.repeat(201) },
    { columnId: 'c', title: 'X', rank: 'U' },
    { columnId: 'c', title: 'X', number: 7 },
    { columnId: 'c', title: 'X', dueDate: '2027-13-01' },
    { columnId: 'c', title: 'X', priority: 'NONE' },
    { columnId: 'c', title: 'X', description: 'a'.repeat(10_001) },
  ])('rejects %j with 400', async (body) => {
    expectStatus(await owner(request(app).post(cardsPath())).send(body), 400, 'VALIDATION_ERROR');
  });
});

describe('GET /boards/:boardId/cards', () => {
  it('lists every column in rank order with its cards in rank order', async () => {
    await createCard(fx.cols.todo.id, 'A');
    await createCard(fx.cols.done.id, 'B');
    const c = await createCard(fx.cols.todo.id, 'C');
    expectStatus(await moveCard(c.id, { columnId: fx.cols.todo.id, afterId: null }), 200);

    const columns = await listCards();

    expect(columns.map((column) => column.columnId)).toEqual([
      fx.cols.backlog.id,
      fx.cols.todo.id,
      fx.cols.inProgress.id,
      fx.cols.done.id,
    ]);
    expect(columns.map((column) => column.cards.map((card) => card.title))).toEqual([
      [],
      ['C', 'A'],
      [],
      ['B'],
    ]);
  });

  it('follows the column order after a column move', async () => {
    const response = await owner(
      request(app).patch(`/boards/${fx.boardId}/columns/${fx.cols.done.id}/move`),
    ).send({ afterId: null });
    expectStatus(response, 200);

    expect((await listCards()).map((column) => column.columnId)[0]).toBe(fx.cols.done.id);
  });
});

describe('GET /boards/:boardId/cards/:cardKey', () => {
  it('returns the card for the board key and number', async () => {
    await createCard(fx.cols.todo.id, 'One');
    const two = await createCard(fx.cols.todo.id, 'Two');

    const response = await as(fx.users.VIEWER, request(app).get(cardsPath('/RO-2')));

    expectStatus(response, 200);
    expect(parseCard(response)).toEqual(two);
  });

  it.each(['XY-1', 'EL-1', 'RO-99'])('returns 404 for %s', async (key) => {
    await createCard(fx.cols.todo.id, 'One');
    await as(fx.users.OUTSIDER, request(app).post(`/boards/${fx.otherBoardId}/cards`)).send({
      columnId: fx.otherColumnId,
      title: 'Elsewhere',
    });

    expectStatus(await owner(request(app).get(cardsPath(`/${key}`))), 404, 'NOT_FOUND');
  });

  it.each(['ro-1', 'RO-0', 'RO-01', 'RO1', 'R-1', 'ROADMA-1', 'RO-1x', 'RO-99999999999'])(
    'returns 400 for the malformed key %s',
    async (key) => {
      expectStatus(await owner(request(app).get(cardsPath(`/${key}`))), 400, 'VALIDATION_ERROR');
    },
  );

  it('uses the current board key after it changes', async () => {
    const card = await createCard(fx.cols.todo.id, 'One');
    expectStatus(await owner(request(app).patch(`/boards/${fx.boardId}`)).send({ key: 'SL' }), 200);

    const old = await owner(request(app).get(cardsPath('/RO-1')));
    const current = await owner(request(app).get(cardsPath('/SL-1')));

    expectStatus(old, 404, 'NOT_FOUND');
    expectStatus(current, 200);
    expect(parseCard(current)).toMatchObject({ id: card.id, key: 'SL-1', number: 1 });
    expect((await cardsIn(fx.cols.todo.id))[0]?.key).toBe('SL-1');
  });
});

describe('PATCH /boards/:boardId/cards/:cardId', () => {
  const patch = (cardId: string, body: object): Test =>
    as(fx.users.MEMBER, request(app).patch(cardsPath(`/${cardId}`))).send(body);

  it('updates the given fields only', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card', { description: 'Old' });

    const response = await patch(card.id, {
      title: ' New title ',
      priority: 'URGENT',
      assigneeId: fx.users.VIEWER.id,
      dueDate: '2027-12-31',
    });

    expectStatus(response, 200);
    expect(parseCard(response)).toMatchObject({
      title: 'New title',
      description: 'Old',
      priority: 'URGENT',
      assigneeId: fx.users.VIEWER.id,
      dueDate: '2027-12-31',
      rank: card.rank,
      columnId: card.columnId,
      key: card.key,
    });
  });

  it('clears nullable fields with null', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card', {
      description: 'Text',
      assigneeId: fx.users.MEMBER.id,
      dueDate: '2027-01-01',
    });

    const response = await patch(card.id, { description: null, assigneeId: null, dueDate: null });

    expectStatus(response, 200);
    expect(parseCard(response)).toMatchObject({
      description: null,
      assigneeId: null,
      dueDate: null,
    });
  });

  it('clears the description when it is set to whitespace only', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card', { description: 'Text' });

    const response = await patch(card.id, { description: ' \t ' });

    expectStatus(response, 200);
    expect(parseCard(response).description).toBeNull();
  });

  it('rejects an assignee who is not a member with 400 ASSIGNEE_NOT_MEMBER', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card');

    expectStatus(
      await patch(card.id, { title: 'Changed', assigneeId: fx.users.OUTSIDER.id }),
      400,
      'ASSIGNEE_NOT_MEMBER',
    );
    expect(await db.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      title: 'Card',
      assigneeId: null,
    });
  });

  it.each([{}, { columnId: 'x' }, { rank: 'U' }, { title: '' }, { priority: null }])(
    'rejects %j with 400',
    async (body) => {
      const card = await createCard(fx.cols.todo.id, 'Card');

      expectStatus(await patch(card.id, body), 400, 'VALIDATION_ERROR');
    },
  );

  it('returns 404 for a card of another board or an unknown id', async () => {
    const other = parseCard(
      await as(fx.users.OUTSIDER, request(app).post(`/boards/${fx.otherBoardId}/cards`)).send({
        columnId: fx.otherColumnId,
        title: 'Elsewhere',
      }),
    );

    expectStatus(await patch(other.id, { title: 'Hijacked' }), 404, 'NOT_FOUND');
    expectStatus(await patch('does-not-exist', { title: 'X' }), 404, 'NOT_FOUND');
    expect((await db.card.findUniqueOrThrow({ where: { id: other.id } })).title).toBe('Elsewhere');
  });
});

describe('PATCH /boards/:boardId/cards/:cardId/move', () => {
  let a: Card;
  let b: Card;
  let c: Card;

  beforeEach(async () => {
    a = await createCard(fx.cols.todo.id, 'A');
    b = await createCard(fx.cols.todo.id, 'B');
    c = await createCard(fx.cols.todo.id, 'C');
  });

  it('reorders within a column without recording a transition', async () => {
    const response = await moveCard(c.id, {
      columnId: fx.cols.todo.id,
      afterId: a.id,
      beforeId: b.id,
    });

    expectStatus(response, 200);
    expect(await titlesIn(fx.cols.todo.id)).toEqual(['A', 'C', 'B']);
    expect(await transitionsOf(c.id)).toHaveLength(1);
    expect(parseCard(response).columnId).toBe(fx.cols.todo.id);
  });

  it('treats a move to the current position as a no-op', async () => {
    const response = await moveCard(b.id, {
      columnId: fx.cols.todo.id,
      afterId: a.id,
      beforeId: c.id,
    });

    expectStatus(response, 200);
    expect(parseCard(response)).toEqual(b);
  });

  it('moves between columns and records exactly one transition', async () => {
    const response = await moveCard(
      b.id,
      { columnId: fx.cols.inProgress.id, beforeId: null },
      fx.users.MEMBER,
    );

    expectStatus(response, 200);
    expect(parseCard(response)).toMatchObject({ columnId: fx.cols.inProgress.id, key: b.key });
    expect(await titlesIn(fx.cols.todo.id)).toEqual(['A', 'C']);
    expect(await titlesIn(fx.cols.inProgress.id)).toEqual(['B']);

    const transitions = await transitionsOf(b.id);
    expect(transitions).toHaveLength(2);
    expect(transitions[1]).toMatchObject({
      boardId: fx.boardId,
      fromColumnId: fx.cols.todo.id,
      toColumnId: fx.cols.inProgress.id,
      movedById: fx.users.MEMBER.id,
    });
  });

  it('places the card between neighbours in the target column', async () => {
    const x = await createCard(fx.cols.done.id, 'X');
    const y = await createCard(fx.cols.done.id, 'Y');

    expectStatus(
      await moveCard(a.id, { columnId: fx.cols.done.id, afterId: x.id, beforeId: y.id }),
      200,
    );
    expectStatus(await moveCard(b.id, { columnId: fx.cols.done.id, afterId: null }), 200);

    expect(await titlesIn(fx.cols.done.id)).toEqual(['B', 'X', 'A', 'Y']);
    expectValidRanks(await cardsIn(fx.cols.done.id));
  });

  it('appends to the end of the target column without neighbours', async () => {
    const x = await createCard(fx.cols.done.id, 'X');

    expectStatus(await moveCard(a.id, { columnId: fx.cols.done.id }), 200);

    expect((await cardsIn(fx.cols.done.id)).map((card) => card.id)).toEqual([x.id, a.id]);
  });

  it('rejects a neighbour from another column with 404 NEIGHBOR_NOT_FOUND', async () => {
    const response = await moveCard(a.id, { columnId: fx.cols.done.id, afterId: b.id });

    expectStatus(response, 404, 'NEIGHBOR_NOT_FOUND');
    expect(await transitionsOf(a.id)).toHaveLength(1);
  });

  it('rejects non-adjacent neighbours with 409 INVALID_POSITION', async () => {
    const response = await moveCard(c.id, {
      columnId: fx.cols.todo.id,
      afterId: b.id,
      beforeId: a.id,
    });

    expectStatus(response, 409, 'INVALID_POSITION');
    expect(await titlesIn(fx.cols.todo.id)).toEqual(['A', 'B', 'C']);
  });

  it('rejects a target column of another board with 404 COLUMN_NOT_FOUND', async () => {
    expectStatus(await moveCard(a.id, { columnId: fx.otherColumnId }), 404, 'COLUMN_NOT_FOUND');
  });

  it('rejects the card as its own neighbour with 400', async () => {
    expectStatus(
      await moveCard(a.id, { columnId: fx.cols.todo.id, afterId: a.id }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it.each([{}, { afterId: null }, { columnId: 'x', rank: 'U' }])(
    'rejects %j with 400',
    async (body) => {
      expectStatus(await moveCard(a.id, body), 400, 'VALIDATION_ERROR');
    },
  );

  it('returns 404 for an unknown card', async () => {
    expectStatus(await moveCard('does-not-exist', { columnId: fx.cols.todo.id }), 404, 'NOT_FOUND');
  });

  it('writes neither the move nor the transition when the transaction fails', async () => {
    const real = createCardRepository(db);
    const cards: CardRepository = {
      ...real,
      transaction: (fn) =>
        real.transaction((store) =>
          fn({
            ...store,
            async recordTransition(data) {
              await store.recordTransition(data);
              throw new Error('Simulated failure after the transition was written');
            },
          }),
        ),
    };
    const service = createCardService({ cards });

    await expect(
      service.move(ownerMembership(), a.id, { columnId: fx.cols.done.id }),
    ).rejects.toThrow('Simulated failure');

    expect(await db.card.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      columnId: fx.cols.todo.id,
      rank: a.rank,
    });
    expect(await transitionsOf(a.id)).toHaveLength(1);
  });

  it('retries after a rank collision and places the card next to afterId', async () => {
    const x = await createCard(fx.cols.done.id, 'X');
    const y = await createCard(fx.cols.done.id, 'Y');
    const real = createCardRepository(db);
    let interfered = false;
    // Before the first attempt writes, another connection commits B at exactly the rank the
    // attempt is about to compute, so the unique constraint must reject it.
    const cards: CardRepository = {
      ...real,
      transaction: (fn) =>
        real.transaction((store) =>
          fn({
            ...store,
            async listInColumn(columnId) {
              const list = await store.listInColumn(columnId);
              if (!interfered && columnId === fx.cols.done.id) {
                interfered = true;
                await db.card.update({
                  where: { id: b.id },
                  data: { columnId: fx.cols.done.id, rank: rankBetween(x.rank, y.rank) },
                });
              }
              return list;
            },
          }),
        ),
    };

    const moved = await createCardService({ cards }).move(ownerMembership(), a.id, {
      columnId: fx.cols.done.id,
      afterId: x.id,
      beforeId: y.id,
    });

    expect(interfered).toBe(true);
    const list = await cardsIn(fx.cols.done.id);
    expect(list.map((card) => card.title)).toEqual(['X', 'A', 'B', 'Y']);
    expect(list[1]?.rank).toBe(moved.rank);
    expectValidRanks(list);
    expect(await transitionsOf(a.id)).toHaveLength(2);
  });

  it('lets two parallel moves into the same gap both succeed with unique ranks', async () => {
    const x = await createCard(fx.cols.done.id, 'X');
    const y = await createCard(fx.cols.done.id, 'Y');
    const gap = { columnId: fx.cols.done.id, afterId: x.id, beforeId: y.id };

    // Lock the target column row: both requests read the same neighbours, then block on the
    // foreign key check of their UPDATE; releasing the lock lets them write the same rank.
    const responses = await whileLocked(
      (tx) => tx.$queryRaw`SELECT "id" FROM "Column" WHERE "id" = ${fx.cols.done.id} FOR UPDATE`,
      2,
      () => Promise.all([a, b].map((card) => moveCard(card.id, gap))),
    );

    for (const response of responses) expectStatus(response, 200);
    const list = await cardsIn(fx.cols.done.id);
    expectValidRanks(list);
    const order = list.map((card) => card.title);
    expect(order[0]).toBe('X');
    expect([...order.slice(1, 3)].sort()).toEqual(['A', 'B']);
    expect(order[3]).toBe('Y');
    for (const card of [a, b]) expect(await transitionsOf(card.id)).toHaveLength(2);
  });
});

describe('WIP limits', () => {
  it('refuses to move a card into a full column with a strict limit', async () => {
    await setWip(fx.cols.inProgress.id, 1, true);
    await createCard(fx.cols.inProgress.id, 'Busy');
    const card = await createCard(fx.cols.todo.id, 'Waiting');

    const response = await moveCard(card.id, { columnId: fx.cols.inProgress.id });

    expectStatus(response, 409, 'WIP_LIMIT_EXCEEDED');
    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).columnId).toBe(
      fx.cols.todo.id,
    );
    expect(await transitionsOf(card.id)).toHaveLength(1);
  });

  it('refuses to create a card in a full column with a strict limit', async () => {
    await setWip(fx.cols.inProgress.id, 2, true);
    await createCard(fx.cols.inProgress.id, 'One');
    await createCard(fx.cols.inProgress.id, 'Two');

    const response = await owner(request(app).post(cardsPath())).send({
      columnId: fx.cols.inProgress.id,
      title: 'Three',
    });

    expectStatus(response, 409, 'WIP_LIMIT_EXCEEDED');
    expect(await titlesIn(fx.cols.inProgress.id)).toEqual(['One', 'Two']);
    // The failed creation did not use up a card number.
    expect((await createCard(fx.cols.todo.id, 'Next')).number).toBe(3);
  });

  it('lets a non-strict limit be exceeded', async () => {
    await setWip(fx.cols.inProgress.id, 1, false);
    await createCard(fx.cols.inProgress.id, 'One');
    const card = await createCard(fx.cols.todo.id, 'Two');

    expectStatus(await moveCard(card.id, { columnId: fx.cols.inProgress.id }), 200);
    await createCard(fx.cols.inProgress.id, 'Three');

    expect(await titlesIn(fx.cols.inProgress.id)).toEqual(['One', 'Two', 'Three']);
  });

  it('allows reordering inside a full (even over-full) strict column', async () => {
    const one = await createCard(fx.cols.inProgress.id, 'One');
    await createCard(fx.cols.inProgress.id, 'Two');
    await setWip(fx.cols.inProgress.id, 1, true);

    const response = await moveCard(one.id, { columnId: fx.cols.inProgress.id, beforeId: null });

    expectStatus(response, 200);
    expect(await titlesIn(fx.cols.inProgress.id)).toEqual(['Two', 'One']);
  });

  it('lets exactly one of two parallel moves take the last free slot', async () => {
    await setWip(fx.cols.inProgress.id, 2, true);
    await createCard(fx.cols.inProgress.id, 'Busy');
    const a = await createCard(fx.cols.todo.id, 'A');
    const b = await createCard(fx.cols.todo.id, 'B');

    const responses = await whileLocked(
      (tx) => tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${fx.boardId} FOR UPDATE`,
      2,
      // Different positions, so the moves cannot collide on a rank: only the WIP check stops one.
      () =>
        Promise.all([
          moveCard(a.id, { columnId: fx.cols.inProgress.id, afterId: null }),
          moveCard(b.id, { columnId: fx.cols.inProgress.id, beforeId: null }),
        ]),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict && errorResponseSchema.parse(conflict.body).error.code).toBe(
      'WIP_LIMIT_EXCEEDED',
    );
    expect(await db.card.count({ where: { columnId: fx.cols.inProgress.id } })).toBe(2);
    expect(await db.cardTransition.count({ where: { toColumnId: fx.cols.inProgress.id } })).toBe(2);
  });

  it('lets exactly one of a parallel creation and move take the last free slot', async () => {
    await setWip(fx.cols.inProgress.id, 1, true);
    const a = await createCard(fx.cols.todo.id, 'A');

    const responses = await whileLocked(
      (tx) => tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${fx.boardId} FOR UPDATE`,
      2,
      () =>
        Promise.all([
          moveCard(a.id, { columnId: fx.cols.inProgress.id }),
          owner(request(app).post(cardsPath())).send({
            columnId: fx.cols.inProgress.id,
            title: 'New',
          }),
        ]),
    );

    const statuses = responses.map((response) => response.status);
    expect([
      [200, 409],
      [409, 201],
    ]).toContainEqual(statuses);
    expect(await db.card.count({ where: { columnId: fx.cols.inProgress.id } })).toBe(1);
  });
});

describe('rebalancing', () => {
  /** Ranks 1 < 2 < 2000…01 (exactly RANK_MAX_LENGTH long) < 3: the gap before it is full. */
  const tightRank = `2${'0'.repeat(RANK_MAX_LENGTH - 2)}1`;
  let cards: Card[];

  beforeEach(async () => {
    cards = [];
    for (const [title, rank] of [
      ['P', '1'],
      ['Q', '2'],
      ['R', tightRank],
      ['S', '3'],
    ] as const) {
      const card = await createCard(fx.cols.done.id, title);
      await db.card.update({ where: { id: card.id }, data: { rank } });
      cards.push({ ...card, rank });
    }
    expect(rankBetween('2', tightRank).length).toBeGreaterThan(RANK_MAX_LENGTH);
  });

  /** Indexes of Q and R, the cards around the full gap. */
  const q = 1;
  const r = 2;

  it('rebalances the target column when a card enters a full gap', async () => {
    const moving = await createCard(fx.cols.todo.id, 'M');

    const response = await moveCard(moving.id, {
      columnId: fx.cols.done.id,
      afterId: cards[q]?.id,
      beforeId: cards[r]?.id,
    });

    expectStatus(response, 200);
    const list = await cardsIn(fx.cols.done.id);
    expect(list.map((card) => card.title)).toEqual(['P', 'Q', 'M', 'R', 'S']);
    expectValidRanks(list);
    expect(list.every((card) => card.rank.length === 1)).toBe(true);
    expect(list[2]).toEqual(parseCard(response));
    expect(await transitionsOf(moving.id)).toHaveLength(2);
  });

  it('rebalances the column when a card is reordered into a full gap', async () => {
    const response = await moveCard(cards[3]?.id ?? '', {
      columnId: fx.cols.done.id,
      afterId: cards[q]?.id,
      beforeId: cards[r]?.id,
    });

    expectStatus(response, 200);
    const list = await cardsIn(fx.cols.done.id);
    expect(list.map((card) => card.title)).toEqual(['P', 'Q', 'S', 'R']);
    expectValidRanks(list);
    expect(list.every((card) => card.rank.length === 1)).toBe(true);
    expect(list[2]).toEqual(parseCard(response));
    expect(await transitionsOf(cards[3]?.id ?? '')).toHaveLength(1);
  });

  it('rebalances the column when appending after a maximal rank', async () => {
    await db.card.update({
      where: { id: cards[3]?.id },
      data: { rank: 'z'.repeat(RANK_MAX_LENGTH) },
    });

    const created = await createCard(fx.cols.done.id, 'T');

    const list = await cardsIn(fx.cols.done.id);
    expect(list.map((card) => card.title)).toEqual(['P', 'Q', 'R', 'S', 'T']);
    expectValidRanks(list);
    expect(list[4]?.rank).toBe(created.rank);
  });
});

describe('DELETE /boards/:boardId/cards/:cardId', () => {
  it('deletes the card with its transitions', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card');
    expectStatus(await moveCard(card.id, { columnId: fx.cols.done.id }), 200);

    expectStatus(await owner(request(app).delete(cardsPath(`/${card.id}`))), 204);

    expect(await db.card.count()).toBe(0);
    expect(await transitionsOf(card.id)).toHaveLength(0);
    expectStatus(await owner(request(app).delete(cardsPath(`/${card.id}`))), 404, 'NOT_FOUND');
  });

  it('answers 503 BOARD_BUSY and keeps the card while its row stays locked', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card');
    const service = createCardService({ cards: createCardRepository(db, { lockTimeoutMs: 100 }) });

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Card" WHERE "id" = ${card.id} FOR UPDATE`;

      await expect(service.delete(ownerMembership(), card.id)).rejects.toMatchObject({
        statusCode: 503,
        code: 'BOARD_BUSY',
      });
    });
    expect(await db.card.count({ where: { id: card.id } })).toBe(1);
  });

  it('deletes cards and transitions together with the board', async () => {
    await createCard(fx.cols.todo.id, 'Card');

    expectStatus(await owner(request(app).delete(`/boards/${fx.boardId}`)), 204);

    expect(await db.card.count({ where: { boardId: fx.boardId } })).toBe(0);
    expect(await db.cardTransition.count({ where: { boardId: fx.boardId } })).toBe(0);
  });
});

describe('columns with cards', () => {
  it('cannot be deleted while they hold cards (409 COLUMN_NOT_EMPTY)', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card');
    const columnPath = `/boards/${fx.boardId}/columns/${fx.cols.todo.id}`;

    expectStatus(await owner(request(app).delete(columnPath)), 409, 'COLUMN_NOT_EMPTY');
    expect(await db.column.count({ where: { id: fx.cols.todo.id } })).toBe(1);

    expectStatus(await moveCard(card.id, { columnId: fx.cols.done.id }), 200);
    expectStatus(await owner(request(app).delete(columnPath)), 204);

    // The history survives the column: the reference becomes null.
    const transitions = await transitionsOf(card.id);
    expect(transitions.map((t) => [t.fromColumnId, t.toColumnId])).toEqual([
      [null, null],
      [null, fx.cols.done.id],
    ]);
  });
});

describe('membership changes', () => {
  it('unassigns a removed member from the cards of that board only', async () => {
    const assigned = await createCard(fx.cols.todo.id, 'Assigned', {
      assigneeId: fx.users.MEMBER.id,
    });
    const other = await createCard(fx.cols.todo.id, 'Other', { assigneeId: fx.users.ADMIN.id });
    await db.boardMember.create({
      data: { boardId: fx.otherBoardId, userId: fx.users.MEMBER.id, role: 'MEMBER' },
    });
    const elsewhere = parseCard(
      await as(fx.users.OUTSIDER, request(app).post(`/boards/${fx.otherBoardId}/cards`)).send({
        columnId: fx.otherColumnId,
        title: 'Elsewhere',
        assigneeId: fx.users.MEMBER.id,
      }),
    );

    expectStatus(
      await owner(request(app).delete(`/boards/${fx.boardId}/members/${fx.users.MEMBER.id}`)),
      204,
    );

    const byId = async (id: string) => db.card.findUniqueOrThrow({ where: { id } });
    expect((await byId(assigned.id)).assigneeId).toBeNull();
    expect((await byId(other.id)).assigneeId).toBe(fx.users.ADMIN.id);
    expect((await byId(elsewhere.id)).assigneeId).toBe(fx.users.MEMBER.id);
  });

  it('times out removing a member whose membership row stays locked', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card', { assigneeId: fx.users.MEMBER.id });
    const members = createBoardMemberRepository(db, { lockTimeoutMs: 100 });

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "BoardMember"
        WHERE "boardId" = ${fx.boardId} AND "userId" = ${fx.users.MEMBER.id} FOR SHARE`;

      await expect(
        members.removeUnlessOwner(fx.boardId, fx.users.MEMBER.id),
      ).rejects.toBeInstanceOf(BoardBusyError);
    });
    expect(await db.boardMember.count({ where: { userId: fx.users.MEMBER.id } })).toBe(1);
    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).assigneeId).toBe(
      fx.users.MEMBER.id,
    );
  });

  it('unassigns a member who leaves the board', async () => {
    const card = await createCard(fx.cols.todo.id, 'Mine', { assigneeId: fx.users.VIEWER.id });

    expectStatus(
      await as(
        fx.users.VIEWER,
        request(app).delete(`/boards/${fx.boardId}/members/${fx.users.VIEWER.id}`),
      ),
      204,
    );

    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).assigneeId).toBeNull();
  });

  it('cannot leave a card assigned to a member removed concurrently', async () => {
    const card = await createCard(fx.cols.todo.id, 'Card');

    // Hold the card row so the assignment waits after locking the membership row; the removal
    // then has to wait for the assignment, and unassigns the card after it commits.
    const responses = await whileLocked(
      (tx) => tx.$queryRaw`SELECT "id" FROM "Card" WHERE "id" = ${card.id} FOR UPDATE`,
      2,
      async () => {
        const assign = owner(request(app).patch(cardsPath(`/${card.id}`))).send({
          assigneeId: fx.users.MEMBER.id,
        });
        const assignPromise = assign.then((response) => response);
        await waitForLockWaiters(1);
        const remove = owner(
          request(app).delete(`/boards/${fx.boardId}/members/${fx.users.MEMBER.id}`),
        ).then((response) => response);
        return Promise.all([assignPromise, remove]);
      },
    );

    expect(responses.map((response) => response.status)).toEqual([200, 204]);
    expect((await db.card.findUniqueOrThrow({ where: { id: card.id } })).assigneeId).toBeNull();
  });
});
