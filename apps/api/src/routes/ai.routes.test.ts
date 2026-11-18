import {
  AI_ERROR_CODES,
  AI_MESSAGES_PAGE_DEFAULT_LIMIT,
  aiBoardConversationResponseSchema,
  aiConversationResponseSchema,
  aiMessageListResponseSchema,
  aiStatusResponseSchema,
  type AiConversation,
} from '@streamline/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbClient } from '../repositories/db.js';
import { createTokenService, type TokenService } from '../services/token.service.js';
import {
  ACTORS,
  client,
  expectStatus,
  seedBoard,
  type Actor,
  type BoardFixture,
  type UserClient,
} from '../test/board-fixture.js';
import { buildTestApp, createTestConfig, createTestDb, resetDatabase } from '../test/helpers.js';

const AI_ON = {
  AI_ENABLED: 'true',
  LLM_BASE_URL: 'http://localhost:11434/v1',
  LLM_MODEL: 'test-model',
};

let db: DbClient;
let app: Express;
let disabledApp: Express;
let tokens: TokenService;
let fx: BoardFixture;

beforeAll(() => {
  db = createTestDb();
  app = buildTestApp(db, AI_ON);
  disabledApp = buildTestApp(db);
  tokens = createTokenService(createTestConfig());
});

beforeEach(async () => {
  await resetDatabase(db);
  fx = await seedBoard(app, db, tokens);
});

afterAll(async () => {
  await db.$disconnect();
});

const as = (actor: Actor, target: Express = app): UserClient => client(target, fx.users[actor]);
const boardChatPath = (boardId = fx.boardId) => `/ai/boards/${boardId}/conversation`;
const messagesPath = (conversationId: string) => `/ai/conversations/${conversationId}/messages`;

async function openBoardChat(actor: Actor = 'MEMBER', query = '', boardId = fx.boardId) {
  const response = await as(actor).get(`${boardChatPath(boardId)}${query}`);
  expectStatus(response, 200);
  return aiBoardConversationResponseSchema.parse(response.body);
}

async function startProjectSession(actor: Actor = 'MEMBER'): Promise<AiConversation> {
  const response = await as(actor).post('/ai/project-sessions');
  expectStatus(response, 201);
  return aiConversationResponseSchema.parse(response.body).conversation;
}

/** Stores `count` messages one second apart (oldest first), alternating user and assistant. */
async function addMessages(conversationId: string, count: number, start = Date.UTC(2026, 10, 18)) {
  await db.aiMessage.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      conversationId,
      role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
      content: `message ${String(index + 1)}`,
      createdAt: new Date(start + index * 1000),
    })),
  });
}

const contents = (messages: { content: string }[]) => messages.map((message) => message.content);

describe('GET /ai/status', () => {
  it('reports the enabled assistant and its model', async () => {
    const response = await as('VIEWER').get('/ai/status');
    expectStatus(response, 200);
    expect(aiStatusResponseSchema.parse(response.body)).toEqual({
      enabled: true,
      model: 'test-model',
    });
  });

  it('reports a disabled assistant without a model', async () => {
    const response = await as('VIEWER', disabledApp).get('/ai/status');
    expectStatus(response, 200);
    expect(aiStatusResponseSchema.parse(response.body)).toEqual({ enabled: false, model: null });
  });

  it('requires authentication', async () => {
    expectStatus(await request(app).get('/ai/status'), 401, 'UNAUTHORIZED');
    expectStatus(await request(disabledApp).get('/ai/status'), 401, 'UNAUTHORIZED');
  });
});

describe('a disabled assistant', () => {
  it.each([
    ['get', '/ai/boards/BOARD/conversation'],
    ['delete', '/ai/boards/BOARD/conversation'],
    ['post', '/ai/project-sessions'],
    ['get', '/ai/conversations/some-id/messages'],
    ['get', '/ai/unknown-route'],
  ] as const)('answers %s %s with 404 AI_DISABLED', async (method, path) => {
    const response = await as('OWNER', disabledApp)[method](path.replace('BOARD', fx.boardId));
    expectStatus(response, 404, AI_ERROR_CODES.AI_DISABLED);
  });

  it('creates no conversation', async () => {
    await as('OWNER', disabledApp).get(boardChatPath());
    await as('OWNER', disabledApp).post('/ai/project-sessions');
    expect(await db.aiConversation.count()).toBe(0);
  });
});

describe('the board conversation', () => {
  it('is created on first use, empty, and returned again afterwards', async () => {
    const first = await openBoardChat('MEMBER');
    expect(first).toMatchObject({
      conversation: { kind: 'BOARD_CHAT', boardId: fx.boardId },
      messages: [],
      nextCursor: null,
    });

    const second = await openBoardChat('MEMBER');
    expect(second.conversation).toEqual(first.conversation);
    expect(await db.aiConversation.count()).toBe(1);
  });

  it('is created once under concurrent first requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => as('MEMBER').get(boardChatPath())),
    );
    const ids = responses.map((response) => {
      expectStatus(response, 200);
      return aiBoardConversationResponseSchema.parse(response.body).conversation.id;
    });
    expect(new Set(ids).size).toBe(1);
    expect(await db.aiConversation.count()).toBe(1);
  });

  it('is separate for each user and each board', async () => {
    const owner = await openBoardChat('OWNER');
    const viewer = await openBoardChat('VIEWER');
    const elsewhere = await openBoardChat('OUTSIDER', '', fx.otherBoardId);

    expect(new Set([owner, viewer, elsewhere].map((page) => page.conversation.id)).size).toBe(3);
    expect(elsewhere.conversation.boardId).toBe(fx.otherBoardId);
  });

  it.each(ACTORS.filter((actor) => actor !== 'OUTSIDER'))('is available to %s', async (actor) => {
    await openBoardChat(actor);
    expectStatus(await as(actor).delete(boardChatPath()), 204);
  });

  it('is hidden from non-members and for unknown boards', async () => {
    for (const path of [boardChatPath(), boardChatPath('no-such-board')]) {
      expectStatus(await as('OUTSIDER').get(path), 404, 'NOT_FOUND');
      expectStatus(await as('OUTSIDER').delete(path), 404, 'NOT_FOUND');
    }
    expect(await db.aiConversation.count()).toBe(0);
  });

  it('becomes unavailable when its author loses access to the board', async () => {
    const { conversation } = await openBoardChat('VIEWER');
    await addMessages(conversation.id, 2);

    expectStatus(
      await as('OWNER').delete(`/boards/${fx.boardId}/members/${fx.users.VIEWER.id}`),
      204,
    );

    expectStatus(await as('VIEWER').get(boardChatPath()), 404, 'NOT_FOUND');
    expectStatus(await as('VIEWER').delete(boardChatPath()), 404, 'NOT_FOUND');
    expectStatus(
      await as('VIEWER').get(messagesPath(conversation.id)),
      404,
      AI_ERROR_CODES.CONVERSATION_NOT_FOUND,
    );
    expect(await db.aiMessage.count()).toBe(2);
  });

  it('returns stored tool calls with their JSON arguments and results', async () => {
    const { conversation } = await openBoardChat('MEMBER');
    await db.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'TOOL',
        content: '',
        toolName: 'search_cards',
        toolCallId: 'call-1',
        toolArgs: { query: 'login', limit: 5 },
        toolResult: [{ key: 'RO-1', done: false, tags: null }],
      },
    });

    const { messages } = await openBoardChat('MEMBER');
    expect(messages).toEqual([
      expect.objectContaining({
        conversationId: conversation.id,
        role: 'TOOL',
        toolName: 'search_cards',
        toolCallId: 'call-1',
        toolArgs: { query: 'login', limit: 5 },
        toolResult: [{ key: 'RO-1', done: false, tags: null }],
      }),
    ]);
  });
});

describe('message pagination', () => {
  it('returns the newest page in chronological order and pages backwards with the cursor', async () => {
    const { conversation } = await openBoardChat('MEMBER');
    await addMessages(conversation.id, 5);

    const first = await openBoardChat('MEMBER', '?limit=2');
    expect(contents(first.messages)).toEqual(['message 4', 'message 5']);
    expect(first.nextCursor).not.toBeNull();

    const second = aiMessageListResponseSchema.parse(
      (
        await as('MEMBER').get(
          `${messagesPath(conversation.id)}?limit=2&cursor=${first.nextCursor ?? ''}`,
        )
      ).body,
    );
    expect(contents(second.messages)).toEqual(['message 2', 'message 3']);

    const third = await openBoardChat('MEMBER', `?limit=2&cursor=${second.nextCursor ?? ''}`);
    expect(contents(third.messages)).toEqual(['message 1']);
    expect(third.nextCursor).toBeNull();
  });

  it('orders messages with the same timestamp by id and skips none of them', async () => {
    const { conversation } = await openBoardChat('MEMBER');
    const createdAt = new Date(Date.UTC(2026, 10, 18));
    await db.aiMessage.createMany({
      data: ['a', 'b', 'c', 'd'].map((content) => ({
        conversationId: conversation.id,
        role: 'USER' as const,
        content,
        createdAt,
      })),
    });

    const seen: string[] = [];
    let cursor: string | null = '';
    while (cursor !== null) {
      const page = await openBoardChat('MEMBER', `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.messages.map((message) => message.id));
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it(`returns ${String(AI_MESSAGES_PAGE_DEFAULT_LIMIT)} messages by default`, async () => {
    const { conversation } = await openBoardChat('MEMBER');
    await addMessages(conversation.id, AI_MESSAGES_PAGE_DEFAULT_LIMIT + 1);

    const page = await openBoardChat('MEMBER');
    expect(page.messages).toHaveLength(AI_MESSAGES_PAGE_DEFAULT_LIMIT);
    expect(page.messages[0]?.content).toBe('message 2');
    expect(page.nextCursor).not.toBeNull();
  });

  it.each(['?limit=0', '?limit=101', '?limit=abc', '?cursor=bad'])(
    'rejects the query %s',
    async (query) => {
      const { conversation } = await openBoardChat('MEMBER');
      expectStatus(await as('MEMBER').get(`${boardChatPath()}${query}`), 400, 'VALIDATION_ERROR');
      expectStatus(
        await as('MEMBER').get(`${messagesPath(conversation.id)}${query}`),
        400,
        'VALIDATION_ERROR',
      );
    },
  );
});

describe('DELETE /ai/boards/:boardId/conversation', () => {
  it("clears the caller's messages and keeps the conversation", async () => {
    const mine = await openBoardChat('MEMBER');
    const theirs = await openBoardChat('ADMIN');
    await addMessages(mine.conversation.id, 3);
    await addMessages(theirs.conversation.id, 2);

    expectStatus(await as('MEMBER').delete(boardChatPath()), 204);

    const after = await openBoardChat('MEMBER');
    expect(after.conversation.id).toBe(mine.conversation.id);
    expect(after.messages).toEqual([]);
    expect((await openBoardChat('ADMIN')).messages).toHaveLength(2);
  });

  it('succeeds without creating a conversation when none exists', async () => {
    expectStatus(await as('MEMBER').delete(boardChatPath()), 204);
    expect(await db.aiConversation.count()).toBe(0);
  });
});

describe('privacy', () => {
  it("does not reveal another user's conversation", async () => {
    const { conversation } = await openBoardChat('VIEWER');
    const session = await startProjectSession('VIEWER');

    for (const id of [conversation.id, session.id, 'no-such-conversation']) {
      expectStatus(
        await as('OWNER').get(messagesPath(id)),
        404,
        AI_ERROR_CODES.CONVERSATION_NOT_FOUND,
      );
    }
  });

  it('lets the author read the messages of their board conversation by id', async () => {
    const { conversation } = await openBoardChat('VIEWER');
    await addMessages(conversation.id, 2);

    const response = await as('VIEWER').get(messagesPath(conversation.id));
    expectStatus(response, 200);
    expect(contents(aiMessageListResponseSchema.parse(response.body).messages)).toEqual([
      'message 1',
      'message 2',
    ]);
  });
});

describe('POST /ai/project-sessions', () => {
  it('starts a new board-less conversation each time', async () => {
    const first = await startProjectSession('MEMBER');
    const second = await startProjectSession('MEMBER');

    expect(first).toMatchObject({ kind: 'PROJECT_SESSION', boardId: null });
    expect(second.id).not.toBe(first.id);

    const response = await as('MEMBER').get(messagesPath(first.id));
    expectStatus(response, 200);
    expect(aiMessageListResponseSchema.parse(response.body)).toEqual({
      messages: [],
      nextCursor: null,
    });
  });

  it('is available to a user without any board', async () => {
    expectStatus(await as('OUTSIDER').post('/ai/project-sessions').send({}), 201);
  });

  it('rejects unknown fields', async () => {
    expectStatus(
      await as('MEMBER').post('/ai/project-sessions').send({ title: 'Shop' }),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('cascading deletes', () => {
  it("deletes the board's conversations with the board", async () => {
    const owner = await openBoardChat('OWNER');
    const viewer = await openBoardChat('VIEWER');
    await addMessages(owner.conversation.id, 2);
    await addMessages(viewer.conversation.id, 2);
    const elsewhere = await openBoardChat('OUTSIDER', '', fx.otherBoardId);
    await addMessages(elsewhere.conversation.id, 1);
    const session = await startProjectSession('OWNER');

    expectStatus(await as('OWNER').delete(`/boards/${fx.boardId}`), 204);

    const remaining = await db.aiConversation.findMany({ select: { id: true } });
    expect(remaining.map(({ id }) => id).sort()).toEqual(
      [elsewhere.conversation.id, session.id].sort(),
    );
    expect(await db.aiMessage.count()).toBe(1);
  });

  it("deletes a user's conversations, messages and usage with the account", async () => {
    const { conversation } = await openBoardChat('VIEWER');
    await addMessages(conversation.id, 2);
    await startProjectSession('VIEWER');
    await db.aiUsage.create({
      data: { userId: fx.users.VIEWER.id, day: new Date('2026-11-18'), requestCount: 3 },
    });
    await openBoardChat('OWNER');

    await db.user.delete({ where: { id: fx.users.VIEWER.id } });

    expect(await db.aiConversation.count({ where: { userId: fx.users.VIEWER.id } })).toBe(0);
    expect(await db.aiConversation.count()).toBe(1);
    expect(await db.aiMessage.count()).toBe(0);
    expect(await db.aiUsage.count()).toBe(0);
  });
});

describe('database constraints', () => {
  it('requires a board for a board chat and none for a project session', async () => {
    const userId = fx.users.MEMBER.id;
    await expect(
      db.aiConversation.create({ data: { userId, kind: 'BOARD_CHAT' } }),
    ).rejects.toThrow();
    await expect(
      db.aiConversation.create({ data: { userId, kind: 'PROJECT_SESSION', boardId: fx.boardId } }),
    ).rejects.toThrow();
  });

  it('keeps one usage row per user and day', async () => {
    const data = { userId: fx.users.MEMBER.id, day: new Date('2026-11-18') };
    await db.aiUsage.create({ data });
    await expect(db.aiUsage.create({ data })).rejects.toThrow();
  });
});
