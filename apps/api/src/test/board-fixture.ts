import {
  boardResponseSchema,
  cardResponseSchema,
  columnListResponseSchema,
  errorResponseSchema,
  type BoardRole,
  type Card,
  type Column,
} from '@streamline/shared';
import type { Express } from 'express';
import request, { type Response, type Test } from 'supertest';
import { expect } from 'vitest';

import type { DbClient } from '../repositories/db.js';
import type { TokenService } from '../services/token.service.js';

/** A board role, or a registered user who is not a member of the board. */
export type Actor = BoardRole | 'OUTSIDER';

export const ACTORS: readonly Actor[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'OUTSIDER'];

export interface TestUser {
  id: string;
  name: string;
  token: string;
}

export interface BoardFixture {
  boardId: string;
  users: Record<Actor, TestUser>;
  /** The four default columns of the board, in order. */
  columns: Column[];
  /** Another board, owned by OUTSIDER, and one of its columns. */
  otherBoardId: string;
  otherColumnId: string;
}

/** Supertest requests sent as one user. */
export interface UserClient {
  get(path: string): Test;
  post(path: string): Test;
  put(path: string): Test;
  patch(path: string): Test;
  delete(path: string): Test;
}

let userCounter = 0;

export async function createTestUser(
  db: DbClient,
  tokens: TokenService,
  name: string,
): Promise<TestUser> {
  userCounter += 1;
  const user = await db.user.create({
    data: {
      email: `${name.toLowerCase()}-${String(userCounter)}@example.com`,
      passwordHash: 'not-a-real-hash',
      name,
    },
  });
  return { id: user.id, name, token: await tokens.signAccessToken(user.id) };
}

export function client(app: Express, user: TestUser): UserClient {
  const auth = (test: Test) => test.set('Authorization', `Bearer ${user.token}`);
  return {
    get: (path) => auth(request(app).get(path)),
    post: (path) => auth(request(app).post(path)),
    put: (path) => auth(request(app).put(path)),
    patch: (path) => auth(request(app).patch(path)),
    delete: (path) => auth(request(app).delete(path)),
  };
}

export function expectStatus(response: Response, status: number, code?: string): void {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  if (code !== undefined) {
    expect(errorResponseSchema.parse(response.body).error.code).toBe(code);
  }
}

async function createBoard(app: Express, user: TestUser, name: string): Promise<string> {
  const response = await client(app, user).post('/boards').send({ name });
  expectStatus(response, 201);
  return boardResponseSchema.parse(response.body).board.id;
}

async function listColumns(app: Express, user: TestUser, boardId: string): Promise<Column[]> {
  const response = await client(app, user).get(`/boards/${boardId}/columns`);
  expectStatus(response, 200);
  return columnListResponseSchema.parse(response.body).columns;
}

/**
 * A board "Roadmap" (key `RO`) owned by OWNER with an ADMIN, a MEMBER and a VIEWER, and another
 * board of OUTSIDER.
 */
export async function seedBoard(
  app: Express,
  db: DbClient,
  tokens: TokenService,
): Promise<BoardFixture> {
  const users = {} as Record<Actor, TestUser>;
  for (const actor of ACTORS) {
    users[actor] = await createTestUser(db, tokens, actor.charAt(0) + actor.slice(1).toLowerCase());
  }
  const boardId = await createBoard(app, users.OWNER, 'Roadmap');
  await db.boardMember.createMany({
    data: (['ADMIN', 'MEMBER', 'VIEWER'] as const).map((role) => ({
      boardId,
      userId: users[role].id,
      role,
    })),
  });
  const otherBoardId = await createBoard(app, users.OUTSIDER, 'Elsewhere');
  const [otherColumn] = await listColumns(app, users.OUTSIDER, otherBoardId);
  if (!otherColumn) throw new Error('Expected default columns');
  return {
    boardId,
    users,
    columns: await listColumns(app, users.OWNER, boardId),
    otherBoardId,
    otherColumnId: otherColumn.id,
  };
}

/** The column at `index` of the fixture (0 = Backlog, 1 = To Do, 2 = In Progress, 3 = Done). */
export function columnAt(fixture: BoardFixture, index: number): Column {
  const column = fixture.columns[index];
  if (!column) throw new Error(`No column at ${String(index)}`);
  return column;
}

export async function createCard(
  app: Express,
  user: TestUser,
  boardId: string,
  columnId: string,
  title: string,
): Promise<Card> {
  const response = await client(app, user)
    .post(`/boards/${boardId}/cards`)
    .send({ columnId, title });
  expectStatus(response, 201);
  return cardResponseSchema.parse(response.body).card;
}
