import {
  boardListResponseSchema,
  boardMemberListResponseSchema,
  boardMemberResponseSchema,
  boardResponseSchema,
  errorResponseSchema,
  type BoardRole,
} from '@streamline/shared';
import type { Express } from 'express';
import request, { type Response, type Test } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbClient } from '../repositories/db.js';
import { createTokenService, type TokenService } from '../services/token.service.js';
import { buildTestApp, createTestConfig, createTestDb, resetDatabase } from '../test/helpers.js';

type Actor = BoardRole | 'OUTSIDER';

interface TestUser {
  id: string;
  email: string;
  token: string;
}

interface Fixture {
  boardId: string;
  /** One user per role plus a registered user who is not a member. */
  users: Record<Actor, TestUser>;
  /** A plain MEMBER used as the target of member-management requests. */
  target: TestUser;
  /** A registered user who is not a member; used for adding members. */
  candidate: TestUser;
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
  fx = await seedBoard();
});

afterAll(async () => {
  await db.$disconnect();
});

/** Inserts a user directly (no password hashing needed) and signs an access token for them. */
async function createUser(label: string): Promise<TestUser> {
  userCounter += 1;
  const user = await db.user.create({
    data: {
      email: `${label.toLowerCase()}-${userCounter}@example.com`,
      passwordHash: 'not-a-real-hash',
      name: label,
    },
  });
  return { id: user.id, email: user.email, token: await tokens.signAccessToken(user.id) };
}

async function seedBoard(): Promise<Fixture> {
  const users = {} as Record<Actor, TestUser>;
  for (const actor of ACTORS) {
    users[actor] = await createUser(actor);
  }
  const target = await createUser('Target');
  const candidate = await createUser('Candidate');

  const board = await db.board.create({
    data: {
      name: 'Roadmap',
      members: {
        create: [
          { userId: users.OWNER.id, role: 'OWNER' },
          { userId: users.ADMIN.id, role: 'ADMIN' },
          { userId: users.MEMBER.id, role: 'MEMBER' },
          { userId: users.VIEWER.id, role: 'VIEWER' },
          { userId: target.id, role: 'MEMBER' },
        ],
      },
    },
  });
  return { boardId: board.id, users, target, candidate };
}

function as(user: TestUser, test: Test): Test {
  return test.set('Authorization', `Bearer ${user.token}`);
}

function errorCode(response: Response): string {
  return errorResponseSchema.parse(response.body).error.code;
}

async function roleOf(boardId: string, userId: string): Promise<BoardRole | null> {
  const member = await db.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
  });
  return member?.role ?? null;
}

const STATUS_CODE_FOR: Record<number, string> = {
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
};

function expectStatus(response: Response, status: number): void {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  const code = STATUS_CODE_FOR[status];
  if (code) {
    expect(errorCode(response)).toBe(code);
  }
}

describe('role matrix', () => {
  interface MatrixRow {
    name: string;
    request: (actor: TestUser) => Test;
    expected: Record<Actor, number>;
  }

  const rows: MatrixRow[] = [
    {
      name: 'GET /boards/:boardId',
      request: (actor) => as(actor, request(app).get(`/boards/${fx.boardId}`)),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 200, OUTSIDER: 404 },
    },
    {
      name: 'PATCH /boards/:boardId',
      request: (actor) =>
        as(actor, request(app).patch(`/boards/${fx.boardId}`)).send({ name: 'Renamed' }),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 403, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'DELETE /boards/:boardId',
      request: (actor) => as(actor, request(app).delete(`/boards/${fx.boardId}`)),
      expected: { OWNER: 204, ADMIN: 403, MEMBER: 403, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'GET /boards/:boardId/members',
      request: (actor) => as(actor, request(app).get(`/boards/${fx.boardId}/members`)),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 200, OUTSIDER: 404 },
    },
    {
      name: 'POST /boards/:boardId/members',
      request: (actor) =>
        as(actor, request(app).post(`/boards/${fx.boardId}/members`)).send({
          email: fx.candidate.email,
        }),
      expected: { OWNER: 201, ADMIN: 201, MEMBER: 403, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'PATCH /boards/:boardId/members/:userId (another member)',
      request: (actor) =>
        as(actor, request(app).patch(`/boards/${fx.boardId}/members/${fx.target.id}`)).send({
          role: 'VIEWER',
        }),
      expected: { OWNER: 200, ADMIN: 200, MEMBER: 403, VIEWER: 403, OUTSIDER: 404 },
    },
    {
      name: 'DELETE /boards/:boardId/members/:userId (another member)',
      request: (actor) =>
        as(actor, request(app).delete(`/boards/${fx.boardId}/members/${fx.target.id}`)),
      expected: { OWNER: 204, ADMIN: 204, MEMBER: 403, VIEWER: 403, OUTSIDER: 404 },
    },
  ];

  const cases = rows.flatMap((row) =>
    ACTORS.map((actor) => ({ ...row, actor, status: row.expected[actor] })),
  );

  it.each(cases)('$name as $actor -> $status', async ({ request: send, actor, status }) => {
    expectStatus(await send(fx.users[actor]), status);
  });

  it('checks the role before validating the body (no information for non-managers)', async () => {
    const asViewer = await as(fx.users.VIEWER, request(app).patch(`/boards/${fx.boardId}`)).send({
      name: '',
    });
    const asOutsider = await as(
      fx.users.OUTSIDER,
      request(app).patch(`/boards/${fx.boardId}`),
    ).send({ name: '' });

    expectStatus(asViewer, 403);
    expectStatus(asOutsider, 404);
  });

  it('leaves the board unchanged after a forbidden request', async () => {
    await as(fx.users.MEMBER, request(app).patch(`/boards/${fx.boardId}`)).send({ name: 'X' });
    await as(fx.users.ADMIN, request(app).delete(`/boards/${fx.boardId}`));
    await as(
      fx.users.VIEWER,
      request(app).patch(`/boards/${fx.boardId}/members/${fx.target.id}`),
    ).send({ role: 'ADMIN' });

    const board = await db.board.findUnique({ where: { id: fx.boardId } });
    expect(board?.name).toBe('Roadmap');
    expect(await roleOf(fx.boardId, fx.target.id)).toBe('MEMBER');
  });
});

describe('authentication', () => {
  const routes: { method: 'get' | 'post' | 'patch' | 'delete'; path: () => string }[] = [
    { method: 'get', path: () => '/boards' },
    { method: 'post', path: () => '/boards' },
    { method: 'get', path: () => `/boards/${fx.boardId}` },
    { method: 'patch', path: () => `/boards/${fx.boardId}` },
    { method: 'delete', path: () => `/boards/${fx.boardId}` },
    { method: 'get', path: () => `/boards/${fx.boardId}/members` },
    { method: 'post', path: () => `/boards/${fx.boardId}/members` },
    { method: 'patch', path: () => `/boards/${fx.boardId}/members/${fx.target.id}` },
    { method: 'delete', path: () => `/boards/${fx.boardId}/members/${fx.target.id}` },
  ];

  it.each(routes)('$method $path requires authentication', async ({ method, path }) => {
    expectStatus(await request(app)[method](path()).send({}), 401);
  });

  it('rejects an invalid access token', async () => {
    const response = await request(app).get('/boards').set('Authorization', 'Bearer invalid');

    expectStatus(response, 401);
  });
});

describe('GET /boards', () => {
  it('lists only boards the user is a member of, with the user role, newest first', async () => {
    const own = await as(fx.users.VIEWER, request(app).post('/boards')).send({ name: 'Mine' });
    expect(own.status).toBe(201);
    await as(fx.users.OUTSIDER, request(app).post('/boards')).send({ name: 'Not shared' });

    const response = await as(fx.users.VIEWER, request(app).get('/boards'));

    expect(response.status).toBe(200);
    const { boards } = boardListResponseSchema.parse(response.body);
    expect(boards.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: 'Mine', role: 'OWNER' },
      { name: 'Roadmap', role: 'VIEWER' },
    ]);
  });

  it('returns an empty list for a user without boards', async () => {
    const response = await as(fx.candidate, request(app).get('/boards'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ boards: [] });
  });
});

describe('POST /boards', () => {
  it('creates a board owned by the creator', async () => {
    const response = await as(fx.candidate, request(app).post('/boards')).send({
      name: '  Sprint 1  ',
    });

    expect(response.status).toBe(201);
    const { board } = boardResponseSchema.parse(response.body);
    expect(board).toMatchObject({ name: 'Sprint 1', role: 'OWNER' });
    expect(await roleOf(board.id, fx.candidate.id)).toBe('OWNER');
    expect(await db.boardMember.count({ where: { boardId: board.id } })).toBe(1);
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 'a'.repeat(101) }, { name: 42 }])(
    'rejects invalid body %j with 400',
    async (body) => {
      const response = await as(fx.candidate, request(app).post('/boards')).send(body);

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('VALIDATION_ERROR');
    },
  );
});

describe('GET /boards/:boardId', () => {
  it('returns the board with the caller role', async () => {
    const response = await as(fx.users.MEMBER, request(app).get(`/boards/${fx.boardId}`));

    expect(boardResponseSchema.parse(response.body).board).toMatchObject({
      id: fx.boardId,
      name: 'Roadmap',
      role: 'MEMBER',
    });
  });

  it.each(['does-not-exist', 'x'.repeat(500), '%E2%9C%93', "1'%20OR%20'1'='1"])(
    'returns 404 for an unknown or malformed id %j',
    async (id) => {
      expectStatus(await as(fx.users.OWNER, request(app).get(`/boards/${id}`)), 404);
    },
  );

  it('gives the same response for a nonexistent board and a board of others', async () => {
    const missing = await as(fx.users.OUTSIDER, request(app).get('/boards/does-not-exist'));
    const foreign = await as(fx.users.OUTSIDER, request(app).get(`/boards/${fx.boardId}`));

    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe('PATCH /boards/:boardId', () => {
  it('renames the board and bumps updatedAt', async () => {
    const before = await db.board.findUniqueOrThrow({ where: { id: fx.boardId } });

    const response = await as(fx.users.ADMIN, request(app).patch(`/boards/${fx.boardId}`)).send({
      name: ' Renamed ',
    });

    expect(response.status).toBe(200);
    const { board } = boardResponseSchema.parse(response.body);
    expect(board).toMatchObject({ name: 'Renamed', role: 'ADMIN' });
    expect(new Date(board.updatedAt).getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('rejects an invalid name with 400', async () => {
    const response = await as(fx.users.OWNER, request(app).patch(`/boards/${fx.boardId}`)).send({
      name: '',
    });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /boards/:boardId', () => {
  it('deletes the board together with all memberships', async () => {
    const response = await as(fx.users.OWNER, request(app).delete(`/boards/${fx.boardId}`));

    expect(response.status).toBe(204);
    expect(await db.board.count({ where: { id: fx.boardId } })).toBe(0);
    expect(await db.boardMember.count({ where: { boardId: fx.boardId } })).toBe(0);
    expectStatus(await as(fx.users.OWNER, request(app).get(`/boards/${fx.boardId}`)), 404);
  });
});

describe('GET /boards/:boardId/members', () => {
  it('lists members ordered by role, then by join date', async () => {
    const response = await as(fx.users.VIEWER, request(app).get(`/boards/${fx.boardId}/members`));

    expect(response.status).toBe(200);
    const { members } = boardMemberListResponseSchema.parse(response.body);
    expect(members.map(({ userId, role }) => ({ userId, role }))).toEqual([
      { userId: fx.users.OWNER.id, role: 'OWNER' },
      { userId: fx.users.ADMIN.id, role: 'ADMIN' },
      { userId: fx.users.MEMBER.id, role: 'MEMBER' },
      { userId: fx.target.id, role: 'MEMBER' },
      { userId: fx.users.VIEWER.id, role: 'VIEWER' },
    ]);
    expect(members[0]).toMatchObject({ name: 'OWNER', email: fx.users.OWNER.email });
  });
});

describe('POST /boards/:boardId/members', () => {
  function addMember(body: object, actor: TestUser = fx.users.OWNER): Test {
    return as(actor, request(app).post(`/boards/${fx.boardId}/members`)).send(body);
  }

  it('adds a registered user as MEMBER by default, normalizing the email', async () => {
    const response = await addMember({ email: `  ${fx.candidate.email.toUpperCase()} ` });

    expect(response.status).toBe(201);
    const { member } = boardMemberResponseSchema.parse(response.body);
    expect(member).toMatchObject({
      userId: fx.candidate.id,
      email: fx.candidate.email,
      name: 'Candidate',
      role: 'MEMBER',
    });
    expect(await roleOf(fx.boardId, fx.candidate.id)).toBe('MEMBER');
  });

  it.each(['ADMIN', 'MEMBER', 'VIEWER'] as const)('adds a member with role %s', async (role) => {
    const response = await addMember({ email: fx.candidate.email, role }, fx.users.ADMIN);

    expect(response.status).toBe(201);
    expect(boardMemberResponseSchema.parse(response.body).member.role).toBe(role);
  });

  it('never assigns OWNER', async () => {
    const response = await addMember({ email: fx.candidate.email, role: 'OWNER' });

    expect(response.status).toBe(400);
    expect(await roleOf(fx.boardId, fx.candidate.id)).toBeNull();
  });

  it.each([{}, { email: 'not-an-email' }, { email: 'someone@example.com', role: 'GUEST' }])(
    'rejects invalid body %j with 400',
    async (body) => {
      const response = await addMember(body);

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('VALIDATION_ERROR');
    },
  );

  it('returns 404 USER_NOT_FOUND for an email without an account', async () => {
    const response = await addMember({ email: 'nobody@example.com' });

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe('USER_NOT_FOUND');
  });

  it('returns 409 ALREADY_MEMBER for an existing member', async () => {
    const response = await addMember({ email: fx.users.VIEWER.email, role: 'ADMIN' });

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('ALREADY_MEMBER');
    expect(await roleOf(fx.boardId, fx.users.VIEWER.id)).toBe('VIEWER');
  });

  it('answers concurrent duplicate additions with one 201 and 409 for the rest', async () => {
    const responses = await Promise.all(
      [1, 2, 3].map(() => addMember({ email: fx.candidate.email })),
    );

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(
      await db.boardMember.count({ where: { boardId: fx.boardId, userId: fx.candidate.id } }),
    ).toBe(1);
  });
});

describe('PATCH /boards/:boardId/members/:userId', () => {
  function changeRole(actor: TestUser, userId: string, role: string): Test {
    return as(actor, request(app).patch(`/boards/${fx.boardId}/members/${userId}`)).send({
      role,
    });
  }

  it('changes the role and returns the member', async () => {
    const response = await changeRole(fx.users.OWNER, fx.target.id, 'ADMIN');

    expect(response.status).toBe(200);
    expect(boardMemberResponseSchema.parse(response.body).member).toMatchObject({
      userId: fx.target.id,
      role: 'ADMIN',
    });
    expect(await roleOf(fx.boardId, fx.target.id)).toBe('ADMIN');
  });

  it('lets an ADMIN change the role of another ADMIN', async () => {
    await db.boardMember.update({
      where: { boardId_userId: { boardId: fx.boardId, userId: fx.target.id } },
      data: { role: 'ADMIN' },
    });

    expect((await changeRole(fx.users.ADMIN, fx.target.id, 'VIEWER')).status).toBe(200);
    expect(await roleOf(fx.boardId, fx.target.id)).toBe('VIEWER');
  });

  it('lets an ADMIN step down', async () => {
    expect((await changeRole(fx.users.ADMIN, fx.users.ADMIN.id, 'MEMBER')).status).toBe(200);
    expect(await roleOf(fx.boardId, fx.users.ADMIN.id)).toBe('MEMBER');
  });

  it.each(['OWNER', 'ADMIN'] as const)("forbids %s to change the OWNER's role", async (actor) => {
    const response = await changeRole(fx.users[actor], fx.users.OWNER.id, 'ADMIN');

    expectStatus(response, 403);
    expect(await roleOf(fx.boardId, fx.users.OWNER.id)).toBe('OWNER');
  });

  it('rejects OWNER as the new role with 400', async () => {
    const response = await changeRole(fx.users.OWNER, fx.target.id, 'OWNER');

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('VALIDATION_ERROR');
    expect(await roleOf(fx.boardId, fx.target.id)).toBe('MEMBER');
  });

  it('returns 404 for a user who is not a member', async () => {
    expectStatus(await changeRole(fx.users.OWNER, fx.candidate.id, 'VIEWER'), 404);
    expectStatus(await changeRole(fx.users.OWNER, 'does-not-exist', 'VIEWER'), 404);
  });
});

describe('DELETE /boards/:boardId/members/:userId', () => {
  function removeMember(actor: TestUser, userId: string): Test {
    return as(actor, request(app).delete(`/boards/${fx.boardId}/members/${userId}`));
  }

  it('removes the member', async () => {
    expect((await removeMember(fx.users.OWNER, fx.target.id)).status).toBe(204);
    expect(await roleOf(fx.boardId, fx.target.id)).toBeNull();
    expectStatus(await as(fx.target, request(app).get(`/boards/${fx.boardId}`)), 404);
  });

  it('lets an ADMIN remove another ADMIN', async () => {
    await db.boardMember.update({
      where: { boardId_userId: { boardId: fx.boardId, userId: fx.target.id } },
      data: { role: 'ADMIN' },
    });

    expect((await removeMember(fx.users.ADMIN, fx.target.id)).status).toBe(204);
  });

  it('forbids an ADMIN to remove the OWNER', async () => {
    expectStatus(await removeMember(fx.users.ADMIN, fx.users.OWNER.id), 403);
    expect(await roleOf(fx.boardId, fx.users.OWNER.id)).toBe('OWNER');
  });

  it.each(['ADMIN', 'MEMBER', 'VIEWER'] as const)('lets %s leave the board', async (role) => {
    const user = fx.users[role];

    expect((await removeMember(user, user.id)).status).toBe(204);
    expect(await roleOf(fx.boardId, user.id)).toBeNull();
    expectStatus(await as(user, request(app).get(`/boards/${fx.boardId}`)), 404);
  });

  it('does not let the OWNER leave the board', async () => {
    const response = await removeMember(fx.users.OWNER, fx.users.OWNER.id);

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('OWNER_CANNOT_LEAVE');
    expect(await roleOf(fx.boardId, fx.users.OWNER.id)).toBe('OWNER');
  });

  it('returns 404 when removing a user who is not a member', async () => {
    expectStatus(await removeMember(fx.users.OWNER, fx.candidate.id), 404);
    expectStatus(await removeMember(fx.users.OWNER, 'does-not-exist'), 404);
  });

  it('returns 404 to an outsider trying to leave', async () => {
    expectStatus(await removeMember(fx.users.OUTSIDER, fx.users.OUTSIDER.id), 404);
  });
});

describe('database invariants', () => {
  it('refuses a second OWNER on the same board', async () => {
    await expect(
      db.boardMember.update({
        where: { boardId_userId: { boardId: fx.boardId, userId: fx.users.ADMIN.id } },
        data: { role: 'OWNER' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await roleOf(fx.boardId, fx.users.ADMIN.id)).toBe('ADMIN');
  });

  it('allows one OWNER on each of several boards', async () => {
    const other = await as(fx.users.ADMIN, request(app).post('/boards')).send({ name: 'Other' });

    expect(other.status).toBe(201);
  });
});
