import {
  commentListResponseSchema,
  commentResponseSchema,
  COMMENTS_PAGE_DEFAULT_LIMIT,
  type Card,
  type Comment,
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
let card: Card;

beforeAll(() => {
  db = createTestDb();
  app = buildTestApp(db);
  tokens = createTokenService(createTestConfig());
});

beforeEach(async () => {
  await resetDatabase(db);
  fx = await seedBoard(app, db, tokens);
  card = await createCard(app, fx.users.OWNER, fx.boardId, columnAt(fx, 1).id, 'Card');
});

afterAll(async () => {
  await db.$disconnect();
});

const as = (actor: Actor): UserClient => client(app, fx.users[actor]);
const commentsPath = (suffix = '', cardId = card.id, boardId = fx.boardId) =>
  `/boards/${boardId}/cards/${cardId}/comments${suffix}`;

async function addComment(body: string, actor: Actor = 'MEMBER'): Promise<Comment> {
  const response = await as(actor).post(commentsPath()).send({ body });
  expectStatus(response, 201);
  return commentResponseSchema.parse(response.body).comment;
}

async function listComments(query = '', actor: Actor = 'VIEWER') {
  const response = await as(actor).get(`${commentsPath()}${query}`);
  expectStatus(response, 200);
  return commentListResponseSchema.parse(response.body);
}

describe('creating and listing comments', () => {
  it('creates a trimmed comment with its author and lists comments oldest first', async () => {
    const first = await addComment('  First\nline  ', 'MEMBER');
    const second = await addComment('Second', 'ADMIN');

    expect(first).toMatchObject({
      cardId: card.id,
      boardId: fx.boardId,
      author: { id: fx.users.MEMBER.id, name: fx.users.MEMBER.name },
      body: 'First\nline',
      editedAt: null,
    });
    const page = await listComments();
    expect(page).toEqual({ comments: [first, second], nextCursor: null });
  });

  it('pages through the comments with a cursor', async () => {
    const created: Comment[] = [];
    for (let i = 0; i < 5; i++) created.push(await addComment(`Comment ${String(i)}`));

    const first = await listComments('?limit=2');
    expect(first.comments.map((c) => c.body)).toEqual(['Comment 0', 'Comment 1']);
    expect(first.nextCursor).not.toBeNull();
    const second = await listComments(`?limit=2&cursor=${first.nextCursor ?? ''}`);
    expect(second.comments.map((c) => c.body)).toEqual(['Comment 2', 'Comment 3']);
    const third = await listComments(`?limit=2&cursor=${second.nextCursor ?? ''}`);
    expect(third).toEqual({ comments: [created[4]], nextCursor: null });
  });

  it('orders comments written in the same millisecond by id', async () => {
    const createdAt = new Date('2026-11-15T10:00:00.000Z');
    await db.comment.createMany({
      data: ['c', 'a', 'b'].map((suffix) => ({
        id: `comment-${suffix}`,
        cardId: card.id,
        boardId: fx.boardId,
        authorId: fx.users.MEMBER.id,
        body: suffix,
        createdAt,
      })),
    });

    const first = await listComments('?limit=2');
    const second = await listComments(`?limit=2&cursor=${first.nextCursor ?? ''}`);
    expect([...first.comments, ...second.comments].map((c) => c.body)).toEqual(['a', 'b', 'c']);
    expect(second.nextCursor).toBeNull();
  });

  it(`returns ${String(COMMENTS_PAGE_DEFAULT_LIMIT)} comments per page by default`, async () => {
    await db.comment.createMany({
      data: Array.from({ length: COMMENTS_PAGE_DEFAULT_LIMIT + 1 }, (_, i) => ({
        cardId: card.id,
        boardId: fx.boardId,
        authorId: fx.users.MEMBER.id,
        body: `Comment ${String(i)}`,
        createdAt: new Date(Date.UTC(2026, 10, 15, 10, 0, i)),
      })),
    });

    const page = await listComments();
    expect(page.comments).toHaveLength(COMMENTS_PAGE_DEFAULT_LIMIT);
    expect(page.nextCursor).not.toBeNull();
  });

  it.each(['?limit=0', '?limit=101', '?limit=abc', '?cursor=bad'])(
    'rejects the query %s with 400',
    async (query) => {
      expectStatus(await as('VIEWER').get(`${commentsPath()}${query}`), 400, 'VALIDATION_ERROR');
    },
  );

  it.each([[{}], [{ body: '   ' }], [{ body: 'x'.repeat(5001) }], [{ body: 'ok', authorId: 'x' }]])(
    'rejects the body %j with 400',
    async (body) => {
      expectStatus(await as('MEMBER').post(commentsPath()).send(body), 400, 'VALIDATION_ERROR');
    },
  );

  it.each(ACTORS)('applies the role matrix for %s', async (actor) => {
    const read = actor === 'OUTSIDER' ? 404 : 200;
    const write = actor === 'OUTSIDER' ? 404 : actor === 'VIEWER' ? 403 : 201;

    expectStatus(await as(actor).get(commentsPath()), read);
    expectStatus(await as(actor).post(commentsPath()).send({ body: 'Hi' }), write);
  });

  it('returns 404 for a card of another board or a missing card', async () => {
    const foreign = await createCard(
      app,
      fx.users.OUTSIDER,
      fx.otherBoardId,
      fx.otherColumnId,
      'Foreign',
    );

    expectStatus(await as('OWNER').get(commentsPath('', foreign.id)), 404, 'NOT_FOUND');
    expectStatus(
      await as('OWNER').post(commentsPath('', foreign.id)).send({ body: 'Hi' }),
      404,
      'NOT_FOUND',
    );
    expectStatus(await as('OWNER').get(commentsPath('', 'missing')), 404, 'NOT_FOUND');
    expect(await db.comment.count()).toBe(0);
  });

  it('deletes the comments together with the card', async () => {
    await addComment('Hi');
    expectStatus(await as('OWNER').delete(`/boards/${fx.boardId}/cards/${card.id}`), 204);
    expect(await db.comment.count()).toBe(0);
  });

  it('keeps a comment whose author account was deleted, without an author', async () => {
    const comment = await addComment('Orphan', 'MEMBER');
    await db.user.delete({ where: { id: fx.users.MEMBER.id } });

    const page = await listComments();
    expect(page.comments).toEqual([{ ...comment, author: null }]);
  });
});

describe('editing comments', () => {
  it('lets the author edit the body and marks the comment as edited', async () => {
    const comment = await addComment('Draft', 'MEMBER');

    const response = await as('MEMBER')
      .patch(commentsPath(`/${comment.id}`))
      .send({ body: ' Final ' });

    expectStatus(response, 200);
    const edited = commentResponseSchema.parse(response.body).comment;
    expect(edited).toMatchObject({ id: comment.id, body: 'Final', createdAt: comment.createdAt });
    expect(edited.editedAt).not.toBeNull();
  });

  it('does not mark a comment as edited when the body stays the same', async () => {
    const comment = await addComment('Same', 'MEMBER');

    const response = await as('MEMBER')
      .patch(commentsPath(`/${comment.id}`))
      .send({ body: 'Same' });

    expectStatus(response, 200);
    expect(commentResponseSchema.parse(response.body).comment).toEqual(comment);
  });

  it.each(['OWNER', 'ADMIN', 'VIEWER'] as const)(
    'forbids %s to edit a comment of someone else',
    async (actor) => {
      const comment = await addComment('Mine', 'MEMBER');
      const code = actor === 'VIEWER' ? 'FORBIDDEN' : 'COMMENT_FORBIDDEN';

      expectStatus(
        await as(actor)
          .patch(commentsPath(`/${comment.id}`))
          .send({ body: 'Hacked' }),
        403,
        code,
      );
      expect((await db.comment.findUniqueOrThrow({ where: { id: comment.id } })).body).toBe('Mine');
    },
  );

  it('forbids an author who became a VIEWER to edit or delete their comment', async () => {
    const comment = await addComment('Mine', 'MEMBER');
    await db.boardMember.update({
      where: { boardId_userId: { boardId: fx.boardId, userId: fx.users.MEMBER.id } },
      data: { role: 'VIEWER' },
    });

    expectStatus(
      await as('MEMBER')
        .patch(commentsPath(`/${comment.id}`))
        .send({ body: 'X' }),
      403,
    );
    expectStatus(await as('MEMBER').delete(commentsPath(`/${comment.id}`)), 403);
  });

  it('returns 404 for a comment of another card, a missing comment or a non-member', async () => {
    const comment = await addComment('Mine', 'MEMBER');
    const other = await createCard(app, fx.users.OWNER, fx.boardId, columnAt(fx, 1).id, 'Other');

    expectStatus(
      await as('MEMBER')
        .patch(commentsPath(`/${comment.id}`, other.id))
        .send({ body: 'X' }),
      404,
      'COMMENT_NOT_FOUND',
    );
    expectStatus(
      await as('MEMBER').patch(commentsPath('/missing')).send({ body: 'X' }),
      404,
      'COMMENT_NOT_FOUND',
    );
    expectStatus(
      await as('OUTSIDER')
        .patch(commentsPath(`/${comment.id}`))
        .send({ body: 'X' }),
      404,
      'NOT_FOUND',
    );
    expectStatus(
      await as('MEMBER')
        .patch(commentsPath(`/${comment.id}`))
        .send({ body: '' }),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('deleting comments', () => {
  it('lets the author delete their comment', async () => {
    const comment = await addComment('Mine', 'MEMBER');

    expectStatus(await as('MEMBER').delete(commentsPath(`/${comment.id}`)), 204);
    expect(await db.comment.count()).toBe(0);
  });

  it.each(['OWNER', 'ADMIN'] as const)('lets %s delete any comment', async (actor) => {
    const comment = await addComment('Someone else', 'MEMBER');

    expectStatus(await as(actor).delete(commentsPath(`/${comment.id}`)), 204);
    expect(await db.comment.count()).toBe(0);
  });

  it('forbids a MEMBER to delete a comment of someone else', async () => {
    const comment = await addComment('Admin comment', 'ADMIN');

    expectStatus(
      await as('MEMBER').delete(commentsPath(`/${comment.id}`)),
      403,
      'COMMENT_FORBIDDEN',
    );
    expectStatus(await as('VIEWER').delete(commentsPath(`/${comment.id}`)), 403, 'FORBIDDEN');
    expect(await db.comment.count()).toBe(1);
  });

  it('returns 404 for a comment of another card, a missing comment or a non-member', async () => {
    const comment = await addComment('Mine', 'MEMBER');
    const other = await createCard(app, fx.users.OWNER, fx.boardId, columnAt(fx, 1).id, 'Other');

    expectStatus(
      await as('OWNER').delete(commentsPath(`/${comment.id}`, other.id)),
      404,
      'COMMENT_NOT_FOUND',
    );
    expectStatus(await as('OWNER').delete(commentsPath('/missing')), 404, 'COMMENT_NOT_FOUND');
    expectStatus(await as('OUTSIDER').delete(commentsPath(`/${comment.id}`)), 404, 'NOT_FOUND');
    expect(await db.comment.count()).toBe(1);
  });
});
