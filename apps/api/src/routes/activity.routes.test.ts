import {
  ACTIVITY_PAGE_DEFAULT_LIMIT,
  activityListResponseSchema,
  commentResponseSchema,
  labelResponseSchema,
  type Activity,
  type ActivityListResponse,
  type BoardRole,
  type Card,
} from '@streamline/shared';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RankCollisionError } from '../repositories/board-transaction.js';
import { createCardRepository, type CardRepository } from '../repositories/card.repository.js';
import type { DbClient } from '../repositories/db.js';
import type { BoardMembership } from '../services/board-access.service.js';
import { createCardService } from '../services/card.service.js';
import { createTokenService, type TokenService } from '../services/token.service.js';
import {
  ACTORS,
  client,
  columnAt,
  createCard,
  createTestUser,
  expectStatus,
  seedBoard,
  type Actor,
  type BoardFixture,
  type UserClient,
} from '../test/board-fixture.js';
import { buildTestApp, createTestConfig, createTestDb, resetDatabase } from '../test/helpers.js';

let db: DbClient;
let app: Express;
let tokens: TokenService;
let fx: BoardFixture;

beforeAll(() => {
  db = createTestDb();
  app = buildTestApp(db);
  tokens = createTokenService(createTestConfig());
});

beforeEach(async () => {
  await resetDatabase(db);
  fx = await seedBoard(app, db, tokens);
});

afterAll(async () => {
  await db.$disconnect();
});

const as = (actor: Actor): UserClient => client(app, fx.users[actor]);
const boardPath = (suffix = '') => `/boards/${fx.boardId}${suffix}`;
const backlog = () => columnAt(fx, 0);
const todo = () => columnAt(fx, 1);
const inProgress = () => columnAt(fx, 2);

function membership(actor: BoardRole): BoardMembership {
  return { boardId: fx.boardId, userId: fx.users[actor].id, role: actor };
}

async function boardFeed(query = '', actor: Actor = 'VIEWER'): Promise<ActivityListResponse> {
  const response = await as(actor).get(boardPath(`/activity${query}`));
  expectStatus(response, 200);
  return activityListResponseSchema.parse(response.body);
}

async function cardFeed(cardId: string, query = ''): Promise<ActivityListResponse> {
  const response = await as('VIEWER').get(boardPath(`/cards/${cardId}/activity${query}`));
  expectStatus(response, 200);
  return activityListResponseSchema.parse(response.body);
}

/** All entries of the board, oldest first. */
async function history(): Promise<Activity[]> {
  return (await boardFeed('?limit=100')).activities.reverse();
}

async function newCard(title: string, columnId = todo().id): Promise<Card> {
  return createCard(app, fx.users.OWNER, fx.boardId, columnId, title);
}

describe('recorded changes', () => {
  it('records card changes with self-describing payloads', async () => {
    const card = await newCard('Draft');
    const owner = as('OWNER');
    expectStatus(
      await owner
        .patch(boardPath(`/cards/${card.id}`))
        .send({ title: 'Final', priority: 'HIGH', description: 'Long text', dueDate: null }),
      200,
    );
    expectStatus(
      await owner.patch(boardPath(`/cards/${card.id}/move`)).send({ columnId: inProgress().id }),
      200,
    );
    expectStatus(await owner.delete(boardPath(`/cards/${card.id}`)), 204);

    const entries = await history();
    expect(entries.map(({ type, cardId, actor }) => ({ type, cardId, actor }))).toEqual(
      ['CARD_CREATED', 'CARD_UPDATED', 'CARD_MOVED', 'CARD_DELETED'].map((type) => ({
        type,
        cardId: card.id,
        actor: { id: fx.users.OWNER.id, name: fx.users.OWNER.name },
      })),
    );
    expect(entries.map((entry) => entry.payload)).toEqual([
      { card: { key: 'RO-1', title: 'Draft' }, column: { id: todo().id, name: 'To Do' } },
      {
        card: { key: 'RO-1', title: 'Final' },
        // dueDate was null already; the description itself is not stored.
        fields: ['title', 'description', 'priority'],
        title: { from: 'Draft', to: 'Final' },
      },
      {
        card: { key: 'RO-1', title: 'Final' },
        from: { id: todo().id, name: 'To Do' },
        to: { id: inProgress().id, name: 'In Progress' },
      },
      {
        card: { key: 'RO-1', title: 'Final' },
        column: { id: inProgress().id, name: 'In Progress' },
      },
    ]);
  });

  it('records neither a reorder within a column nor an update that changes nothing', async () => {
    const a = await newCard('A');
    await newCard('B');
    const before = await history();

    expectStatus(
      await as('OWNER')
        .patch(boardPath(`/cards/${a.id}/move`))
        .send({ columnId: todo().id }),
      200,
    );
    expectStatus(
      await as('OWNER')
        .patch(boardPath(`/cards/${a.id}`))
        .send({ title: 'A' }),
      200,
    );

    expect(await history()).toEqual(before);
  });

  it('records label and comment changes on cards', async () => {
    const card = await newCard('Card');
    const label = labelResponseSchema.parse(
      (await as('OWNER').post(boardPath('/labels')).send({ name: 'Bug', color: 'RED' })).body,
    ).label;
    const labelPath = boardPath(`/cards/${card.id}/labels/${label.id}`);
    expectStatus(await as('MEMBER').put(labelPath), 200);
    expectStatus(await as('MEMBER').put(labelPath), 200); // No-op: no second entry.
    expectStatus(await as('MEMBER').delete(labelPath), 200);
    const comment = commentResponseSchema.parse(
      (
        await as('ADMIN')
          .post(boardPath(`/cards/${card.id}/comments`))
          .send({ body: 'Hi' })
      ).body,
    ).comment;

    const entries = (await history()).slice(1);
    const labelRef = { id: label.id, name: 'Bug', color: 'RED' };
    expect(
      entries.map(({ type, payload, actor }) => ({ type, payload, actor: actor?.id })),
    ).toEqual([
      {
        type: 'CARD_LABEL_ADDED',
        payload: { card: { key: 'RO-1', title: 'Card' }, label: labelRef },
        actor: fx.users.MEMBER.id,
      },
      {
        type: 'CARD_LABEL_REMOVED',
        payload: { card: { key: 'RO-1', title: 'Card' }, label: labelRef },
        actor: fx.users.MEMBER.id,
      },
      {
        type: 'COMMENT_ADDED',
        payload: { card: { key: 'RO-1', title: 'Card' }, commentId: comment.id },
        actor: fx.users.ADMIN.id,
      },
    ]);
  });

  it('records column changes', async () => {
    const owner = as('OWNER');
    const created = await owner.post(boardPath('/columns')).send({ title: 'Review' });
    expectStatus(created, 201);
    const columnId = (created.body as { column: { id: string } }).column.id;
    expectStatus(
      await owner.patch(boardPath(`/columns/${columnId}`)).send({ title: 'Code review' }),
      200,
    );
    expectStatus(
      await owner.patch(boardPath(`/columns/${columnId}/move`)).send({ afterId: null }),
      200,
    );
    expectStatus(
      await owner
        .patch(boardPath(`/columns/${columnId}/settings`))
        .send({ category: 'IN_PROGRESS', wipLimit: 3, wipStrict: false }),
      200,
    );
    expectStatus(await owner.delete(boardPath(`/columns/${columnId}`)), 204);

    const entries = await history();
    expect(entries.every((entry) => entry.cardId === null)).toBe(true);
    expect(entries.map(({ type, payload }) => ({ type, payload }))).toEqual([
      { type: 'COLUMN_CREATED', payload: { column: { id: columnId, name: 'Review' } } },
      {
        type: 'COLUMN_RENAMED',
        payload: {
          column: { id: columnId, name: 'Code review' },
          name: { from: 'Review', to: 'Code review' },
        },
      },
      { type: 'COLUMN_MOVED', payload: { column: { id: columnId, name: 'Code review' } } },
      {
        type: 'COLUMN_SETTINGS_CHANGED',
        payload: {
          column: { id: columnId, name: 'Code review' },
          // wipStrict was already false.
          changes: {
            category: { from: 'TODO', to: 'IN_PROGRESS' },
            wipLimit: { from: null, to: 3 },
          },
        },
      },
      { type: 'COLUMN_DELETED', payload: { column: { id: columnId, name: 'Code review' } } },
    ]);
  });

  it('records membership changes', async () => {
    const newcomer = await createTestUser(db, tokens, 'Newcomer');
    const { email } = await db.user.findUniqueOrThrow({ where: { id: newcomer.id } });
    const admin = as('ADMIN');
    expectStatus(await admin.post(boardPath('/members')).send({ email, role: 'VIEWER' }), 201);
    expectStatus(
      await admin.patch(boardPath(`/members/${newcomer.id}`)).send({ role: 'MEMBER' }),
      200,
    );
    expectStatus(
      await admin.patch(boardPath(`/members/${newcomer.id}`)).send({ role: 'MEMBER' }),
      200,
    ); // Same role: no entry.
    expectStatus(await admin.delete(boardPath(`/members/${newcomer.id}`)), 204);
    expectStatus(await as('VIEWER').delete(boardPath(`/members/${fx.users.VIEWER.id}`)), 204);

    const entries = await boardFeed('?limit=100', 'OWNER');
    const member = { id: newcomer.id, name: 'Newcomer' };
    expect(
      entries.activities.reverse().map(({ type, payload, actor }) => ({ type, payload, actor })),
    ).toEqual([
      {
        type: 'MEMBER_ADDED',
        payload: { member, role: 'VIEWER' },
        actor: { id: fx.users.ADMIN.id, name: fx.users.ADMIN.name },
      },
      {
        type: 'MEMBER_ROLE_CHANGED',
        payload: { member, role: { from: 'VIEWER', to: 'MEMBER' } },
        actor: { id: fx.users.ADMIN.id, name: fx.users.ADMIN.name },
      },
      {
        type: 'MEMBER_REMOVED',
        payload: { member, role: 'MEMBER' },
        actor: { id: fx.users.ADMIN.id, name: fx.users.ADMIN.name },
      },
      {
        type: 'MEMBER_LEFT',
        payload: { member: { id: fx.users.VIEWER.id, name: fx.users.VIEWER.name }, role: 'VIEWER' },
        actor: { id: fx.users.VIEWER.id, name: fx.users.VIEWER.name },
      },
    ]);
  });

  it('keeps entries readable after the card, the column and the actor are gone', async () => {
    const helper = await createTestUser(db, tokens, 'Helper');
    await db.boardMember.create({
      data: { boardId: fx.boardId, userId: helper.id, role: 'MEMBER' },
    });
    const card = await createCard(app, helper, fx.boardId, backlog().id, 'Temporary');
    expectStatus(await as('OWNER').delete(boardPath(`/cards/${card.id}`)), 204);
    expectStatus(await as('OWNER').delete(boardPath(`/columns/${backlog().id}`)), 204);
    await db.user.delete({ where: { id: helper.id } });

    const [created] = await history();
    expect(created).toMatchObject({
      type: 'CARD_CREATED',
      cardId: card.id,
      actor: null,
      payload: { card: { key: 'RO-1', title: 'Temporary' }, column: { name: 'Backlog' } },
    });
  });

  it('deletes the entries with the board', async () => {
    await newCard('Card');
    expectStatus(await as('OWNER').delete(boardPath()), 204);
    expect(await db.activity.count({ where: { boardId: fx.boardId } })).toBe(0);
  });
});

describe('atomicity', () => {
  it('writes no entry for a rejected change', async () => {
    await db.column.update({
      where: { id: inProgress().id },
      data: { wipLimit: 1, wipStrict: true },
    });
    const card = await newCard('Card');
    await newCard('Blocker', inProgress().id);
    const before = await db.activity.count();

    expectStatus(
      await as('OWNER')
        .patch(boardPath(`/cards/${card.id}/move`))
        .send({ columnId: inProgress().id }),
      409,
      'WIP_LIMIT_EXCEEDED',
    );
    expectStatus(
      await as('VIEWER').post(boardPath('/cards')).send({ columnId: todo().id, title: 'X' }),
      403,
    );
    expectStatus(await as('OWNER').delete(boardPath(`/columns/${todo().id}`)), 409);

    expect(await db.activity.count()).toBe(before);
  });

  /** A card repository whose transactions fail right after writing their activity entry. */
  function failingAfterActivity(real: CardRepository): CardRepository {
    return {
      ...real,
      transaction: (fn) =>
        real.transaction((store) =>
          fn({
            ...store,
            async recordActivity(data) {
              await store.recordActivity(data);
              throw new Error('Injected failure after the activity entry');
            },
          }),
        ),
    };
  }

  it('rolls the change back together with its entry when the transaction fails', async () => {
    const card = await newCard('Original');
    const before = await db.activity.count();
    const service = createCardService({ cards: failingAfterActivity(createCardRepository(db)) });

    await expect(
      service.update(membership('OWNER'), card.id, { title: 'Changed' }),
    ).rejects.toThrow('Injected failure');
    await expect(
      service.move(membership('OWNER'), card.id, { columnId: inProgress().id }),
    ).rejects.toThrow('Injected failure');
    await expect(service.delete(membership('OWNER'), card.id)).rejects.toThrow('Injected failure');

    expect(await db.activity.count()).toBe(before);
    expect(await db.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      title: 'Original',
      columnId: todo().id,
    });
    expect(await db.cardTransition.count({ where: { cardId: card.id } })).toBe(1);
  });

  it('keeps only the entry of the committed attempt when a write is retried', async () => {
    const card = await newCard('Card');
    const real = createCardRepository(db);
    let attempts = 0;
    // The first attempt writes everything, then fails like a rank collision and is retried.
    const retrying: CardRepository = {
      ...real,
      transaction: (fn) =>
        real.transaction(async (store) => {
          attempts += 1;
          const result = await fn(store);
          if (attempts === 1) throw new RankCollisionError();
          return result;
        }),
    };

    await createCardService({ cards: retrying }).move(membership('MEMBER'), card.id, {
      columnId: inProgress().id,
    });

    expect(attempts).toBe(2);
    const moves = await db.activity.findMany({ where: { cardId: card.id, type: 'CARD_MOVED' } });
    expect(moves).toHaveLength(1);
    expect(await db.cardTransition.count({ where: { cardId: card.id } })).toBe(2);
  });
});

describe('activity feeds', () => {
  it('lists the board feed newest first and pages through it with a cursor', async () => {
    for (let i = 1; i <= 5; i++) await newCard(`Card ${String(i)}`);

    const first = await boardFeed('?limit=2');
    expect(first.activities.map((a) => a.payload)).toMatchObject([
      { card: { title: 'Card 5' } },
      { card: { title: 'Card 4' } },
    ]);
    const second = await boardFeed(`?limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(second.activities.map((a) => a.payload)).toMatchObject([
      { card: { title: 'Card 3' } },
      { card: { title: 'Card 2' } },
    ]);
    const third = await boardFeed(`?limit=2&cursor=${second.nextCursor ?? ''}`);
    expect(third.activities.map((a) => a.payload)).toMatchObject([{ card: { title: 'Card 1' } }]);
    expect(third.nextCursor).toBeNull();
  });

  it('pages correctly through entries created in the same millisecond', async () => {
    const createdAt = new Date('2026-11-15T10:00:00.000Z');
    await db.activity.createMany({
      data: ['b', 'd', 'a', 'c'].map((suffix) => ({
        id: `activity-${suffix}`,
        boardId: fx.boardId,
        actorId: fx.users.OWNER.id,
        type: 'COLUMN_MOVED' as const,
        payload: { column: { id: 'col', name: suffix } },
        createdAt,
      })),
    });

    const first = await boardFeed('?limit=3');
    const second = await boardFeed(`?limit=3&cursor=${first.nextCursor ?? ''}`);
    expect([...first.activities, ...second.activities].map((a) => a.id)).toEqual([
      'activity-d',
      'activity-c',
      'activity-b',
      'activity-a',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it(`returns ${String(ACTIVITY_PAGE_DEFAULT_LIMIT)} entries per page by default`, async () => {
    await db.activity.createMany({
      data: Array.from({ length: ACTIVITY_PAGE_DEFAULT_LIMIT + 1 }, (_, i) => ({
        boardId: fx.boardId,
        actorId: fx.users.OWNER.id,
        type: 'COLUMN_MOVED' as const,
        payload: { column: { id: 'col', name: `Column ${String(i)}` } },
        createdAt: new Date(Date.UTC(2026, 10, 15, 10, 0, i)),
      })),
    });

    const page = await boardFeed();
    expect(page.activities).toHaveLength(ACTIVITY_PAGE_DEFAULT_LIMIT);
    expect(page.nextCursor).not.toBeNull();
  });

  it('lists the entries of one card only', async () => {
    const a = await newCard('A');
    const b = await newCard('B');
    expectStatus(
      await as('OWNER')
        .patch(boardPath(`/cards/${a.id}`))
        .send({ title: 'A2' }),
      200,
    );
    expectStatus(
      await as('OWNER')
        .patch(boardPath(`/cards/${b.id}/move`))
        .send({ columnId: inProgress().id }),
      200,
    );

    const feedA = await cardFeed(a.id);
    expect(feedA.activities.map((entry) => entry.type)).toEqual(['CARD_UPDATED', 'CARD_CREATED']);
    expect(feedA.activities.every((entry) => entry.cardId === a.id)).toBe(true);
    const feedB = await cardFeed(b.id, '?limit=1');
    expect(feedB.activities.map((entry) => entry.type)).toEqual(['CARD_MOVED']);
    const restB = await cardFeed(b.id, `?limit=1&cursor=${feedB.nextCursor ?? ''}`);
    expect(restB).toMatchObject({ activities: [{ type: 'CARD_CREATED' }], nextCursor: null });
  });

  it('returns 404 for the card feed of a missing, deleted or foreign card', async () => {
    const card = await newCard('Card');
    const foreign = await createCard(
      app,
      fx.users.OUTSIDER,
      fx.otherBoardId,
      fx.otherColumnId,
      'Foreign',
    );
    expectStatus(await as('OWNER').delete(boardPath(`/cards/${card.id}`)), 204);

    for (const id of [card.id, foreign.id, 'missing']) {
      expectStatus(await as('OWNER').get(boardPath(`/cards/${id}/activity`)), 404, 'NOT_FOUND');
    }
    // The board feed still has the deleted card's history.
    expect((await history()).map((entry) => entry.type)).toEqual(['CARD_CREATED', 'CARD_DELETED']);
  });

  it.each(ACTORS)('applies the role matrix for %s', async (actor) => {
    const card = await newCard('Card');
    const status = actor === 'OUTSIDER' ? 404 : 200;

    expectStatus(await as(actor).get(boardPath('/activity')), status);
    expectStatus(await as(actor).get(boardPath(`/cards/${card.id}/activity`)), status);
  });

  it.each(['?limit=0', '?limit=101', '?limit=1.5', '?cursor=nope', '?cursor=1_a_b'])(
    'rejects the query %s with 400',
    async (query) => {
      expectStatus(await as('OWNER').get(boardPath(`/activity${query}`)), 400, 'VALIDATION_ERROR');
    },
  );

  it('does not show entries of other boards', async () => {
    await createCard(app, fx.users.OUTSIDER, fx.otherBoardId, fx.otherColumnId, 'Foreign');
    expect((await boardFeed()).activities).toEqual([]);
  });
});
