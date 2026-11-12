import type { AddressInfo } from 'node:net';

import {
  boardEventSchemas,
  boardResponseSchema,
  boardRoom,
  cardResponseSchema,
  columnListResponseSchema,
  columnResponseSchema,
  RANK_MAX_LENGTH,
  SOCKET_ID_HEADER,
  WS_ERROR_CODES,
  type BoardEventName,
  type BoardEventPayloads,
  type BoardJoinAck,
  type Card,
  type ClientToServerEvents,
  type Column,
  type ServerToClientEvents,
} from '@streamline/shared';
import { SignJWT } from 'jose';
import { pino } from 'pino';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import request, { type Test } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbClient } from '../repositories/db.js';
import { createStreamLineServer, type StreamLineServer } from '../server-factory.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  createTokenService,
  type TokenService,
} from '../services/token.service.js';
import { createTestConfig, createTestDb, resetDatabase, TEST_JWT_SECRET } from '../test/helpers.js';

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface TestUser {
  id: string;
  name: string;
  token: string;
}

interface Received {
  name: string;
  payload: unknown;
}

/** How long to wait for an event that must arrive. */
const EVENT_TIMEOUT_MS = 3000;
/** Pause after which an event that should not arrive is considered not sent. */
const QUIET_MS = 150;

let db: DbClient;
let server: StreamLineServer;
let url: string;
let tokens: TokenService;
let clients: TestSocket[] = [];
let userCounter = 0;

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let boardId: string;
let columns: Column[];

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitFor<T>(probe: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + EVENT_TIMEOUT_MS;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await delay(10);
  }
}

/** Collects every event a socket receives. */
class Recorder {
  readonly events: Received[] = [];

  constructor(socket: TestSocket) {
    socket.onAny((name: string, payload: unknown) => {
      this.events.push({ name, payload });
    });
  }

  names(): string[] {
    return this.events.map((event) => event.name);
  }

  has(name: string): boolean {
    return this.events.some((event) => event.name === name);
  }

  clear(): void {
    this.events.length = 0;
  }

  /** Waits for the first (not yet consumed) event with the name; returns its payload. */
  async take(name: string): Promise<unknown> {
    const index = await waitFor(() => {
      const found = this.events.findIndex((event) => event.name === name);
      return found < 0 ? undefined : found;
    }, `event ${name}`);
    const [event] = this.events.splice(index, 1);
    return event?.payload;
  }

  /** Waits for a board event and validates its payload against the shared schema. */
  async takeBoardEvent<E extends BoardEventName>(name: E): Promise<BoardEventPayloads[E]> {
    const payload = await this.take(name);
    return boardEventSchemas[name].parse(payload) as BoardEventPayloads[E];
  }
}

function socketOptions(auth: Record<string, unknown>) {
  return { auth, transports: ['websocket'], reconnection: false, forceNew: true };
}

function connect(token: string): Promise<TestSocket> {
  const socket: TestSocket = connectClient(url, socketOptions({ token }));
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Connects and expects the handshake to fail; returns the error code sent by the server. */
function connectError(auth: Record<string, unknown>): Promise<unknown> {
  const socket: TestSocket = connectClient(url, socketOptions(auth));
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('Connected unexpectedly')));
    socket.once('connect_error', (err: Error) => {
      resolve('data' in err && typeof err.data === 'object' && err.data !== null ? err.data : null);
    });
  });
}

function join(socket: TestSocket, id: string): Promise<BoardJoinAck> {
  return socket.timeout(EVENT_TIMEOUT_MS).emitWithAck('board:join', { boardId: id });
}

async function joined(socket: TestSocket, id = boardId): Promise<void> {
  const ack = await join(socket, id);
  expect(ack).toMatchObject({ ok: true });
}

/** A connected socket of the user that has joined the board, with its received events. */
async function viewer(user: TestUser, id = boardId) {
  const socket = await connect(user.token);
  const recorder = new Recorder(socket);
  await joined(socket, id);
  // Presence updates caused by the join itself are not interesting to the tests.
  await delay(20);
  recorder.clear();
  return { socket, recorder };
}

/** Supertest requests as the user, optionally sending the socket id of the change's origin. */
function as(user: TestUser, origin?: TestSocket) {
  const send = (test: Test) => {
    test.set('Authorization', `Bearer ${user.token}`);
    if (origin?.id) test.set(SOCKET_ID_HEADER, origin.id);
    return test;
  };
  return {
    get: (path: string) => send(request(server.app).get(path)),
    post: (path: string) => send(request(server.app).post(path)),
    patch: (path: string) => send(request(server.app).patch(path)),
    delete: (path: string) => send(request(server.app).delete(path)),
  };
}

async function createUser(name: string): Promise<TestUser> {
  userCounter += 1;
  const user = await db.user.create({
    data: {
      email: `${name.toLowerCase()}-${userCounter}@example.com`,
      passwordHash: 'not-a-real-hash',
      name,
    },
  });
  return { id: user.id, name, token: await tokens.signAccessToken(user.id) };
}

async function addMember(user: TestUser, role: 'ADMIN' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
  const { email } = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const response = await as(owner).post(`/boards/${boardId}/members`).send({ email, role });
  expect(response.status).toBe(201);
}

async function createCard(columnId: string, title: string): Promise<Card> {
  const response = await as(owner).post(`/boards/${boardId}/cards`).send({ columnId, title });
  expect(response.status).toBe(201);
  return cardResponseSchema.parse(response.body).card;
}

function column(index: number): Column {
  const found = columns[index];
  if (!found) throw new Error(`No column at ${index}`);
  return found;
}

beforeAll(async () => {
  db = createTestDb();
  const config = createTestConfig();
  tokens = createTokenService(config);
  server = createStreamLineServer({ config, logger: pino({ level: 'silent' }), db });
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.httpServer.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
  await resetDatabase(db);
  owner = await createUser('Owner');
  member = await createUser('Member');
  outsider = await createUser('Outsider');
  const created = await as(owner).post('/boards').send({ name: 'Realtime board' });
  expect(created.status).toBe(201);
  boardId = boardResponseSchema.parse(created.body).board.id;
  await addMember(member);
  const list = await as(owner).get(`/boards/${boardId}/columns`);
  columns = columnListResponseSchema.parse(list.body).columns;
});

afterEach(() => {
  for (const socket of clients) socket.disconnect();
  clients = [];
});

afterAll(async () => {
  await server.realtime.close();
  await db.$disconnect();
});

describe('handshake', () => {
  it('accepts a valid access token', async () => {
    const socket = await connect(owner.token);

    expect(socket.connected).toBe(true);
  });

  it('works over HTTP long-polling as well, next to the REST API', async () => {
    const socket: TestSocket = connectClient(url, {
      auth: { token: owner.token },
      transports: ['polling'],
      reconnection: false,
      forceNew: true,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    await expect(join(socket, boardId)).resolves.toMatchObject({ ok: true });
    // REST requests on the same HTTP server are still served by the app.
    expect((await request(server.httpServer).get('/health')).status).toBe(200);
  });

  it('disconnects the socket when its access token expires', async () => {
    const shortLived = createTokenService({ ...createTestConfig(), ACCESS_TOKEN_TTL_SECONDS: 1 });
    const socket = await connect(await shortLived.signAccessToken(member.id));
    const recorder = new Recorder(socket);
    await joined(socket);
    const disconnected = new Promise<string>((resolve) => {
      socket.once('disconnect', resolve);
    });

    // `exp` has a one-second resolution, so the token lives for at most one second.
    await expect(disconnected).resolves.toBe('io server disconnect');
    expect(await server.realtime.io.in(boardRoom(boardId)).fetchSockets()).toHaveLength(0);
    await as(owner).patch(`/boards/${boardId}`).send({ name: 'After expiry' });
    await delay(QUIET_MS);
    expect(recorder.has('board:updated')).toBe(false);
  });

  it('rejects a missing token with UNAUTHORIZED', async () => {
    await expect(connectError({})).resolves.toEqual({ code: WS_ERROR_CODES.UNAUTHORIZED });
  });

  it('rejects an invalid token with UNAUTHORIZED', async () => {
    await expect(connectError({ token: 'garbage' })).resolves.toEqual({
      code: WS_ERROR_CODES.UNAUTHORIZED,
    });
    await expect(connectError({ token: `${owner.token.slice(0, -2)}xx` })).resolves.toEqual({
      code: WS_ERROR_CODES.UNAUTHORIZED,
    });
  });

  it('rejects an expired token with TOKEN_EXPIRED', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner.id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(nowSeconds - 3600)
      .setExpirationTime(nowSeconds - 60)
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));

    await expect(connectError({ token: expired })).resolves.toEqual({
      code: WS_ERROR_CODES.TOKEN_EXPIRED,
    });
  });

  it('rejects a token of a user that does not exist', async () => {
    const token = await tokens.signAccessToken('no-such-user');

    await expect(connectError({ token })).resolves.toEqual({ code: WS_ERROR_CODES.UNAUTHORIZED });
  });
});

describe('board:join and board:leave', () => {
  it('lets a member join and returns the users on the board', async () => {
    const socket = await connect(member.token);

    const ack = await join(socket, boardId);

    expect(ack).toEqual({
      ok: true,
      presence: [expect.objectContaining({ id: member.id, name: 'Member' }) as unknown],
    });
    expect(await server.realtime.io.in(boardRoom(boardId)).fetchSockets()).toHaveLength(1);
  });

  it('denies a non-member and a nonexistent board with NOT_FOUND', async () => {
    const socket = await connect(outsider.token);

    await expect(join(socket, boardId)).resolves.toEqual({
      ok: false,
      error: { code: WS_ERROR_CODES.NOT_FOUND, message: 'Board not found' },
    });
    await expect(join(socket, 'no-such-board')).resolves.toMatchObject({
      ok: false,
      error: { code: WS_ERROR_CODES.NOT_FOUND },
    });
    expect(await server.realtime.io.in(boardRoom(boardId)).fetchSockets()).toHaveLength(0);
  });

  it('rejects an invalid payload with VALIDATION_ERROR', async () => {
    const socket = await connect(member.token);
    // Deliberately malformed input, as a misbehaving client could send it.
    const malformed = { boardId: 42 } as unknown as { boardId: string };

    const ack: unknown = await socket
      .timeout(EVENT_TIMEOUT_MS)
      .emitWithAck('board:join', malformed);

    expect(ack).toMatchObject({ ok: false, error: { code: WS_ERROR_CODES.VALIDATION_ERROR } });
  });

  it('stops delivering events after board:leave', async () => {
    const { socket, recorder } = await viewer(member);

    const ack: unknown = await socket
      .timeout(EVENT_TIMEOUT_MS)
      .emitWithAck('board:leave', { boardId });
    expect(ack).toEqual({ ok: true });
    await as(owner).patch(`/boards/${boardId}`).send({ name: 'Renamed' });
    await delay(QUIET_MS);

    expect(recorder.has('board:updated')).toBe(false);
  });
});

describe('broadcasting REST changes', () => {
  it('delivers an event to the room members except the originating socket and non-members', async () => {
    const origin = await viewer(owner);
    const other = await viewer(member);
    const outsiderSocket = await connect(outsider.token);
    const outsiderEvents = new Recorder(outsiderSocket);
    await join(outsiderSocket, boardId);

    const response = await as(owner, origin.socket)
      .patch(`/boards/${boardId}/columns/${column(1).id}`)
      .send({ title: 'Ready' });
    expect(response.status).toBe(200);

    const payload = await other.recorder.takeBoardEvent('column:updated');
    expect(payload).toEqual({
      boardId,
      actorId: owner.id,
      column: columnResponseSchema.parse(response.body).column,
    });
    await delay(QUIET_MS);
    expect(origin.recorder.has('column:updated')).toBe(false);
    expect(outsiderEvents.has('column:updated')).toBe(false);
  });

  it('echoes the change to the actor when the request names no socket', async () => {
    const actor = await viewer(owner);

    await as(owner)
      .patch(`/boards/${boardId}/columns/${column(1).id}`)
      .send({ title: 'Ready' });

    await expect(actor.recorder.takeBoardEvent('column:updated')).resolves.toMatchObject({
      actorId: owner.id,
    });
  });

  it("ignores a socket id that belongs to another user's socket", async () => {
    const other = await viewer(member);

    const response = await as(owner, other.socket)
      .patch(`/boards/${boardId}/columns/${column(1).id}`)
      .send({ title: 'Ready' });

    expect(response.status).toBe(200);
    await expect(other.recorder.takeBoardEvent('column:updated')).resolves.toMatchObject({
      actorId: owner.id,
    });
  });

  it('accepts a malformed socket id header and still broadcasts', async () => {
    const other = await viewer(member);

    const response = await as(owner)
      .patch(`/boards/${boardId}/columns/${column(1).id}`)
      .set(SOCKET_ID_HEADER, 'not a socket id!')
      .send({ title: 'Ready' });

    expect(response.status).toBe(200);
    await other.recorder.takeBoardEvent('column:updated');
  });

  it('broadcasts column changes', async () => {
    const { recorder } = await viewer(member);
    const path = `/boards/${boardId}/columns`;

    const created = await as(owner).post(path).send({ title: 'Review' });
    const createdColumn = columnResponseSchema.parse(created.body).column;
    expect((await recorder.takeBoardEvent('column:created')).column).toEqual(createdColumn);

    const moved = await as(owner)
      .patch(`${path}/${createdColumn.id}/move`)
      .send({ afterId: null, beforeId: column(0).id });
    expect((await recorder.takeBoardEvent('column:moved')).column).toEqual(
      columnResponseSchema.parse(moved.body).column,
    );

    const settings = await as(owner)
      .patch(`${path}/${createdColumn.id}/settings`)
      .send({ category: 'IN_PROGRESS', wipLimit: 2, wipStrict: true });
    expect((await recorder.takeBoardEvent('column:updated')).column).toMatchObject({
      id: createdColumn.id,
      category: 'IN_PROGRESS',
      wipLimit: 2,
      wipStrict: true,
    });
    expect(settings.status).toBe(200);

    expect((await as(owner).delete(`${path}/${createdColumn.id}`)).status).toBe(204);
    expect(await recorder.takeBoardEvent('column:deleted')).toEqual({
      boardId,
      actorId: owner.id,
      columnId: createdColumn.id,
    });
  });

  it('broadcasts card changes', async () => {
    const { recorder } = await viewer(member);
    const path = `/boards/${boardId}/cards`;

    const card = await createCard(column(1).id, 'First');
    expect((await recorder.takeBoardEvent('card:created')).card).toEqual(card);

    const updated = await as(owner)
      .patch(`${path}/${card.id}`)
      .send({ title: 'Renamed', assigneeId: member.id, priority: 'HIGH' });
    expect((await recorder.takeBoardEvent('card:updated')).card).toEqual(
      cardResponseSchema.parse(updated.body).card,
    );

    const moved = await as(owner)
      .patch(`${path}/${card.id}/move`)
      .send({ columnId: column(2).id });
    expect((await recorder.takeBoardEvent('card:moved')).card).toEqual(
      cardResponseSchema.parse(moved.body).card,
    );

    expect((await as(owner).delete(`${path}/${card.id}`)).status).toBe(204);
    expect(await recorder.takeBoardEvent('card:deleted')).toEqual({
      boardId,
      actorId: owner.id,
      cardId: card.id,
    });
  });

  it('broadcasts member changes and keeps a member whose role changed in the room', async () => {
    const memberView = await viewer(member);
    const ownerView = await viewer(owner);
    const extra = await createUser('Extra');

    await addMember(extra, 'VIEWER');
    expect((await ownerView.recorder.takeBoardEvent('member:added')).member).toMatchObject({
      userId: extra.id,
      role: 'VIEWER',
    });

    await as(owner).patch(`/boards/${boardId}/members/${member.id}`).send({ role: 'VIEWER' });
    expect((await memberView.recorder.takeBoardEvent('member:updated')).member).toMatchObject({
      userId: member.id,
      role: 'VIEWER',
    });

    // Still in the room: receives later changes.
    await as(owner).patch(`/boards/${boardId}`).send({ name: 'Renamed' });
    await memberView.recorder.takeBoardEvent('board:updated');

    await as(owner).delete(`/boards/${boardId}/members/${extra.id}`);
    expect(await memberView.recorder.takeBoardEvent('member:removed')).toEqual({
      boardId,
      actorId: owner.id,
      userId: extra.id,
    });
  });

  it('broadcasts a board update without the role of the actor', async () => {
    const { recorder } = await viewer(member);

    const response = await as(owner)
      .patch(`/boards/${boardId}`)
      .send({ name: 'New name', key: 'NEW' });
    expect(response.status).toBe(200);

    const payload = await recorder.takeBoardEvent('board:updated');
    const { role: _role, ...board } = boardResponseSchema.parse(response.body).board;
    expect(payload.board).toEqual(board);
    expect(recorder.events.find((event) => event.name === 'board:updated')).toBeUndefined();
  });
});

describe('rank rebalancing', () => {
  /** Ranks 1 < 2 < 2000…01 (exactly RANK_MAX_LENGTH long) < 3: the gap before it is full. */
  const tightRank = `2${'0'.repeat(RANK_MAX_LENGTH - 2)}1`;

  it('announces the new ranks of all columns before the moved column', async () => {
    for (const [index, rank] of ['1', '2', tightRank, '3'].entries()) {
      await db.column.update({ where: { id: column(index).id }, data: { rank } });
    }
    const { recorder } = await viewer(member);

    const response = await as(owner)
      .patch(`/boards/${boardId}/columns/${column(0).id}/move`)
      .send({ afterId: column(1).id, beforeId: column(2).id });
    expect(response.status).toBe(200);

    const rebalance = await recorder.takeBoardEvent('columns:rebalanced');
    await recorder.takeBoardEvent('column:moved');
    const stored = columnListResponseSchema.parse(
      (await as(owner).get(`/boards/${boardId}/columns`)).body,
    ).columns;
    expect(rebalance.ranks).toEqual(stored.map(({ id, rank }) => ({ id, rank })));
    expect(rebalance.actorId).toBe(owner.id);
  });

  it('announces the new ranks of the cards of a column', async () => {
    const target = column(3).id;
    const cards: Card[] = [];
    for (const [title, rank] of [
      ['P', '1'],
      ['Q', '2'],
      ['R', tightRank],
    ] as const) {
      const card = await createCard(target, title);
      await db.card.update({ where: { id: card.id }, data: { rank } });
      cards.push(card);
    }
    const moving = await createCard(column(1).id, 'M');
    const { recorder } = await viewer(member);

    const response = await as(owner)
      .patch(`/boards/${boardId}/cards/${moving.id}/move`)
      .send({ columnId: target, afterId: cards[1]?.id, beforeId: cards[2]?.id });
    expect(response.status).toBe(200);

    const rebalance = await recorder.takeBoardEvent('cards:rebalanced');
    const moved = await recorder.takeBoardEvent('card:moved');
    expect(rebalance.columnId).toBe(target);
    const stored = await db.card.findMany({
      where: { columnId: target, id: { not: moving.id } },
      select: { id: true, rank: true },
    });
    expect([...rebalance.ranks].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      stored.sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(rebalance.ranks.map((entry) => entry.id)).toEqual(cards.map((card) => card.id));
    expect(moved.card).toEqual(cardResponseSchema.parse(response.body).card);
  });
});

describe('access loss', () => {
  it('forces a removed member out of the room and tells all their sockets', async () => {
    const first = await viewer(member);
    const second = await connect(member.token); // Another tab, not viewing the board.
    const secondEvents = new Recorder(second);
    const ownerView = await viewer(owner);

    const response = await as(owner).delete(`/boards/${boardId}/members/${member.id}`);
    expect(response.status).toBe(204);

    expect(await first.recorder.take('board:access-revoked')).toEqual({ boardId });
    expect(await secondEvents.take('board:access-revoked')).toEqual({ boardId });
    expect((await ownerView.recorder.takeBoardEvent('member:removed')).userId).toBe(member.id);
    expect(await ownerView.recorder.take('presence:update')).toEqual({
      boardId,
      users: [expect.objectContaining({ id: owner.id }) as unknown],
    });

    await as(owner)
      .patch(`/boards/${boardId}/columns/${column(1).id}`)
      .send({ title: 'Secret' });
    await ownerView.recorder.takeBoardEvent('column:updated');
    await delay(QUIET_MS);
    expect(first.recorder.names()).not.toContain('column:updated');
    expect(first.recorder.names()).not.toContain('member:removed');
  });

  it('forces a member who leaves out of the room, notifying only their other tabs', async () => {
    const leaving = await viewer(member);
    const otherTab = await viewer(member);

    await as(member, leaving.socket).delete(`/boards/${boardId}/members/${member.id}`);

    expect(await otherTab.recorder.take('board:access-revoked')).toEqual({ boardId });
    expect(await server.realtime.io.in(boardRoom(boardId)).fetchSockets()).toHaveLength(0);
    await delay(QUIET_MS);
    expect(leaving.recorder.has('board:access-revoked')).toBe(false);
  });

  it('tells the room that the board was deleted and empties the room', async () => {
    const ownerView = await viewer(owner);
    const memberView = await viewer(member);

    const response = await as(owner, ownerView.socket).delete(`/boards/${boardId}`);
    expect(response.status).toBe(204);

    expect(await memberView.recorder.takeBoardEvent('board:deleted')).toEqual({
      boardId,
      actorId: owner.id,
    });
    await delay(QUIET_MS);
    expect(ownerView.recorder.has('board:deleted')).toBe(false);
    expect(await server.realtime.io.in(boardRoom(boardId)).fetchSockets()).toHaveLength(0);
    expect(server.realtime.presence.list(boardId)).toEqual([]);
  });
});

describe('presence', () => {
  const ids = (payload: unknown) =>
    (payload as { users: { id: string }[] }).users.map((user) => user.id);

  it('tracks joins, leaves and disconnects, counting several tabs of a user once', async () => {
    const ownerSocket = await connect(owner.token);
    const ownerEvents = new Recorder(ownerSocket);
    const ownerAck = await join(ownerSocket, boardId);
    expect(ownerAck.ok && ownerAck.presence.map((user) => user.id)).toEqual([owner.id]);
    ownerEvents.clear();

    const tab1 = await connect(member.token);
    const tab1Ack = await join(tab1, boardId);
    expect(tab1Ack.ok && tab1Ack.presence.map((user) => user.id)).toEqual([owner.id, member.id]);
    expect(ids(await ownerEvents.take('presence:update'))).toEqual([owner.id, member.id]);

    // A second tab of the same user changes nothing for the others.
    const tab2 = await connect(member.token);
    const tab2Ack = await join(tab2, boardId);
    expect(tab2Ack.ok && tab2Ack.presence.map((user) => user.id)).toEqual([owner.id, member.id]);
    tab1.disconnect();
    await delay(QUIET_MS);
    expect(ownerEvents.has('presence:update')).toBe(false);
    expect(server.realtime.presence.list(boardId).map((user) => user.id)).toEqual([
      owner.id,
      member.id,
    ]);

    // The last tab leaving removes the user.
    await tab2.timeout(EVENT_TIMEOUT_MS).emitWithAck('board:leave', { boardId });
    expect(ids(await ownerEvents.take('presence:update'))).toEqual([owner.id]);

    // A disconnect is a leave as well.
    const tab3 = await connect(member.token);
    const tab3Events = new Recorder(tab3);
    await joined(tab3);
    await ownerEvents.take('presence:update');
    tab3Events.clear();
    ownerSocket.disconnect();
    expect(ids(await tab3Events.take('presence:update'))).toEqual([member.id]);
  });
});
