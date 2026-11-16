import {
  cardListResponseSchema,
  cardResponseSchema,
  LABELS_PER_BOARD_MAX,
  LABELS_PER_CARD_MAX,
  labelListResponseSchema,
  labelResponseSchema,
  type Card,
  type Label,
} from '@streamline/shared';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbClient } from '../repositories/db.js';
import { createTokenService, type TokenService } from '../services/token.service.js';
import {
  ACTORS,
  client,
  columnAt,
  createCard,
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
const labelsPath = (suffix = '', boardId = fx.boardId) => `/boards/${boardId}/labels${suffix}`;
const cardLabelPath = (cardId: string, labelId: string) =>
  `/boards/${fx.boardId}/cards/${cardId}/labels/${labelId}`;

async function createLabel(name: string, color = 'GREEN', actor: Actor = 'OWNER'): Promise<Label> {
  const response = await as(actor).post(labelsPath()).send({ name, color });
  expectStatus(response, 201);
  return labelResponseSchema.parse(response.body).label;
}

async function attach(cardId: string, labelId: string, actor: Actor = 'OWNER'): Promise<Card> {
  const response = await as(actor).put(cardLabelPath(cardId, labelId));
  expectStatus(response, 200);
  return cardResponseSchema.parse(response.body).card;
}

async function listLabels(): Promise<Label[]> {
  const response = await as('VIEWER').get(labelsPath());
  expectStatus(response, 200);
  return labelListResponseSchema.parse(response.body).labels;
}

const todo = () => columnAt(fx, 1);

describe('label endpoints', () => {
  it('creates, lists, updates and deletes labels', async () => {
    const bug = await createLabel('  Bug ', 'RED');
    const feature = await createLabel('Feature', 'BLUE');
    expect(bug).toMatchObject({ boardId: fx.boardId, name: 'Bug', color: 'RED' });

    expect((await listLabels()).map((label) => label.name)).toEqual(['Bug', 'Feature']);

    const renamed = await as('MEMBER')
      .patch(labelsPath(`/${bug.id}`))
      .send({ name: 'Defect' });
    expectStatus(renamed, 200);
    expect(labelResponseSchema.parse(renamed.body).label).toMatchObject({
      id: bug.id,
      name: 'Defect',
      color: 'RED',
    });
    const recolored = await as('MEMBER')
      .patch(labelsPath(`/${bug.id}`))
      .send({ color: 'PINK' });
    expect(labelResponseSchema.parse(recolored.body).label).toMatchObject({
      name: 'Defect',
      color: 'PINK',
    });

    expectStatus(await as('ADMIN').delete(labelsPath(`/${feature.id}`)), 204);
    expect((await listLabels()).map((label) => label.id)).toEqual([bug.id]);
  });

  it.each(ACTORS)('applies the role matrix for %s', async (actor) => {
    const label = await createLabel('Existing');
    const canWrite = ['OWNER', 'ADMIN', 'MEMBER'].includes(actor);
    const writeStatus = actor === 'OUTSIDER' ? 404 : canWrite ? 201 : 403;

    expectStatus(await as(actor).get(labelsPath()), actor === 'OUTSIDER' ? 404 : 200);
    expectStatus(
      await as(actor).post(labelsPath()).send({ name: 'New', color: 'GRAY' }),
      writeStatus,
    );
    expectStatus(
      await as(actor)
        .patch(labelsPath(`/${label.id}`))
        .send({ color: 'GRAY' }),
      writeStatus === 201 ? 200 : writeStatus,
    );
    expectStatus(
      await as(actor).delete(labelsPath(`/${label.id}`)),
      writeStatus === 201 ? 204 : writeStatus,
    );
  });

  it.each([
    [{ name: '', color: 'RED' }],
    [{ name: 'x'.repeat(31), color: 'RED' }],
    [{ name: 'Bug', color: 'red' }],
    [{ name: 'Bug' }],
    [{ name: 'Bug', color: 'RED', boardId: 'x' }],
  ])('rejects an invalid label %j with 400', async (body) => {
    expectStatus(await as('OWNER').post(labelsPath()).send(body), 400, 'VALIDATION_ERROR');
  });

  it('leaves updatedAt alone when an update changes nothing', async () => {
    const bug = await createLabel('Bug', 'RED');

    const response = await as('MEMBER')
      .patch(labelsPath(`/${bug.id}`))
      .send({ name: 'Bug', color: 'RED' });

    expectStatus(response, 200);
    expect(labelResponseSchema.parse(response.body).label).toEqual(bug);
  });

  it('rejects an empty update with 400', async () => {
    const label = await createLabel('Bug');
    expectStatus(
      await as('OWNER')
        .patch(labelsPath(`/${label.id}`))
        .send({}),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('keeps names unique per board regardless of case (409 LABEL_NAME_TAKEN)', async () => {
    const bug = await createLabel('Bug');
    const other = await createLabel('Other');

    expectStatus(
      await as('OWNER').post(labelsPath()).send({ name: 'bug', color: 'RED' }),
      409,
      'LABEL_NAME_TAKEN',
    );
    expectStatus(
      await as('OWNER')
        .patch(labelsPath(`/${other.id}`))
        .send({ name: ' BUG ' }),
      409,
      'LABEL_NAME_TAKEN',
    );
    // Renaming a label to a different case of its own name is fine.
    expectStatus(
      await as('OWNER')
        .patch(labelsPath(`/${bug.id}`))
        .send({ name: 'BUG' }),
      200,
    );
    // Another board may use the same name.
    expectStatus(
      await as('OUTSIDER')
        .post(labelsPath('', fx.otherBoardId))
        .send({ name: 'Bug', color: 'RED' }),
      201,
    );
  });

  it(`allows at most ${String(LABELS_PER_BOARD_MAX)} labels per board (409 LABEL_LIMIT_REACHED)`, async () => {
    await db.label.createMany({
      data: Array.from({ length: LABELS_PER_BOARD_MAX }, (_, i) => ({
        boardId: fx.boardId,
        name: `Label ${String(i)}`,
        color: 'GRAY' as const,
      })),
    });

    expectStatus(
      await as('OWNER').post(labelsPath()).send({ name: 'One more', color: 'RED' }),
      409,
      'LABEL_LIMIT_REACHED',
    );
  });

  it('keeps the limit under concurrent creation', async () => {
    await db.label.createMany({
      data: Array.from({ length: LABELS_PER_BOARD_MAX - 1 }, (_, i) => ({
        boardId: fx.boardId,
        name: `Label ${String(i)}`,
        color: 'GRAY' as const,
      })),
    });

    const responses = await Promise.all(
      ['A', 'B', 'C'].map((name) => as('OWNER').post(labelsPath()).send({ name, color: 'RED' })),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409, 409]);
    expect(await db.label.count({ where: { boardId: fx.boardId } })).toBe(LABELS_PER_BOARD_MAX);
  });

  it('returns 404 LABEL_NOT_FOUND for labels of another board', async () => {
    const foreign = labelResponseSchema.parse(
      (
        await as('OUTSIDER')
          .post(labelsPath('', fx.otherBoardId))
          .send({ name: 'Foreign', color: 'RED' })
      ).body,
    ).label;

    expectStatus(
      await as('OWNER')
        .patch(labelsPath(`/${foreign.id}`))
        .send({ color: 'BLUE' }),
      404,
      'LABEL_NOT_FOUND',
    );
    expectStatus(await as('OWNER').delete(labelsPath(`/${foreign.id}`)), 404, 'LABEL_NOT_FOUND');
    expect(await db.label.count({ where: { id: foreign.id } })).toBe(1);
  });

  it('deletes the labels with the board', async () => {
    await createLabel('Bug');
    expectStatus(await as('OWNER').delete(`/boards/${fx.boardId}`), 204);
    expect(await db.label.count({ where: { boardId: fx.boardId } })).toBe(0);
  });
});

describe('card labels', () => {
  it('attaches and removes labels idempotently, keeping the board label order', async () => {
    const bug = await createLabel('Bug', 'RED');
    const feature = await createLabel('Feature', 'BLUE');
    const card = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'Card');
    expect(card.labelIds).toEqual([]);

    const first = await attach(card.id, feature.id, 'MEMBER');
    expect(first.labelIds).toEqual([feature.id]);
    expect(first.updatedAt > card.updatedAt).toBe(true);
    const both = await attach(card.id, bug.id);
    // Board order (creation order), not attachment order.
    expect(both.labelIds).toEqual([bug.id, feature.id]);

    const again = await attach(card.id, bug.id);
    expect(again).toEqual(both);
    expect(await db.cardLabel.count({ where: { cardId: card.id } })).toBe(2);

    const removed = await as('ADMIN').delete(cardLabelPath(card.id, bug.id));
    expectStatus(removed, 200);
    expect(cardResponseSchema.parse(removed.body).card.labelIds).toEqual([feature.id]);
    const removedAgain = await as('ADMIN').delete(cardLabelPath(card.id, bug.id));
    expectStatus(removedAgain, 200);
    expect(cardResponseSchema.parse(removedAgain.body).card).toEqual(
      cardResponseSchema.parse(removed.body).card,
    );
  });

  it('includes labelIds in every card response', async () => {
    const bug = await createLabel('Bug');
    const card = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'Card');
    await attach(card.id, bug.id);
    const owner = as('OWNER');
    const path = `/boards/${fx.boardId}/cards`;

    const list = cardListResponseSchema.parse((await owner.get(path)).body);
    expect(list.columns.flatMap((column) => column.cards).map((c) => c.labelIds)).toEqual([
      [bug.id],
    ]);
    const byKey = cardResponseSchema.parse((await owner.get(`${path}/${card.key}`)).body).card;
    expect(byKey.labelIds).toEqual([bug.id]);
    const updated = await owner.patch(`${path}/${card.id}`).send({ title: 'Renamed' });
    expect(cardResponseSchema.parse(updated.body).card.labelIds).toEqual([bug.id]);
    const moved = await owner
      .patch(`${path}/${card.id}/move`)
      .send({ columnId: columnAt(fx, 2).id });
    expect(cardResponseSchema.parse(moved.body).card.labelIds).toEqual([bug.id]);
  });

  it('removes a deleted label from every card', async () => {
    const bug = await createLabel('Bug');
    const keep = await createLabel('Keep');
    const a = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'A');
    const b = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'B');
    await attach(a.id, bug.id);
    await attach(a.id, keep.id);
    await attach(b.id, bug.id);

    expectStatus(await as('OWNER').delete(labelsPath(`/${bug.id}`)), 204);

    const cards = cardListResponseSchema
      .parse((await as('OWNER').get(`/boards/${fx.boardId}/cards`)).body)
      .columns.flatMap((column) => column.cards);
    expect(cards.map((card) => [card.title, card.labelIds])).toEqual([
      ['A', [keep.id]],
      ['B', []],
    ]);
  });

  it(`allows at most ${String(LABELS_PER_CARD_MAX)} labels per card (409 CARD_LABEL_LIMIT_REACHED)`, async () => {
    const card = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'Card');
    const labels: Label[] = [];
    for (let i = 0; i <= LABELS_PER_CARD_MAX; i++) labels.push(await createLabel(`L${String(i)}`));
    for (const label of labels.slice(0, LABELS_PER_CARD_MAX)) await attach(card.id, label.id);

    const extra = labels[LABELS_PER_CARD_MAX];
    if (!extra) throw new Error('Expected one more label');
    expectStatus(
      await as('OWNER').put(cardLabelPath(card.id, extra.id)),
      409,
      'CARD_LABEL_LIMIT_REACHED',
    );
    // Attaching an already attached label is still fine at the limit.
    const first = labels[0];
    if (!first) throw new Error('Expected a label');
    expectStatus(await as('OWNER').put(cardLabelPath(card.id, first.id)), 200);
  });

  it.each(ACTORS)('applies the role matrix for %s', async (actor) => {
    const label = await createLabel('Bug');
    const card = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'Card');
    const status = actor === 'OUTSIDER' ? 404 : actor === 'VIEWER' ? 403 : 200;

    expectStatus(await as(actor).put(cardLabelPath(card.id, label.id)), status);
    expectStatus(await as(actor).delete(cardLabelPath(card.id, label.id)), status);
  });

  it('refuses labels and cards of another board with 404', async () => {
    const label = await createLabel('Bug');
    const card = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'Card');
    const foreignLabel = labelResponseSchema.parse(
      (
        await as('OUTSIDER')
          .post(labelsPath('', fx.otherBoardId))
          .send({ name: 'Foreign', color: 'RED' })
      ).body,
    ).label;
    const foreignCard = await createCard(
      app,
      fx.users.OUTSIDER,
      fx.otherBoardId,
      fx.otherColumnId,
      'Foreign',
    );

    expectStatus(
      await as('OWNER').put(cardLabelPath(card.id, foreignLabel.id)),
      404,
      'LABEL_NOT_FOUND',
    );
    expectStatus(
      await as('OWNER').delete(cardLabelPath(card.id, foreignLabel.id)),
      404,
      'LABEL_NOT_FOUND',
    );
    expectStatus(await as('OWNER').put(cardLabelPath(foreignCard.id, label.id)), 404, 'NOT_FOUND');
    expectStatus(await as('OWNER').put(cardLabelPath('missing', label.id)), 404, 'NOT_FOUND');
    expect(await db.cardLabel.count()).toBe(0);
  });

  it('deletes label assignments together with the card', async () => {
    const label = await createLabel('Bug');
    const card = await createCard(app, fx.users.OWNER, fx.boardId, todo().id, 'Card');
    await attach(card.id, label.id);

    expectStatus(await as('OWNER').delete(`/boards/${fx.boardId}/cards/${card.id}`), 204);

    expect(await db.cardLabel.count()).toBe(0);
    expect(await db.label.count({ where: { id: label.id } })).toBe(1);
  });
});
