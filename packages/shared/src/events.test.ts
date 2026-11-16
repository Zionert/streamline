import { describe, expect, it } from 'vitest';

import {
  BOARD_EVENT_NAMES,
  WS_CLIENT_EVENTS,
  WS_EVENTS,
  boardEventSchemas,
  boardJoinAckSchema,
  boardRoom,
  boardRoomRequestSchema,
  ECHOED_BOARD_EVENTS,
  isEchoSuppressed,
  parseBoardEvent,
  presenceUpdateEventSchema,
  userRoom,
} from './events.js';

const TIMESTAMP = '2026-11-12T10:00:00.000Z';

const column = {
  id: 'col-1',
  boardId: 'board-1',
  title: 'To Do',
  rank: 'h',
  category: 'TODO',
  wipLimit: null,
  wipStrict: false,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

const user = { id: 'u1', name: 'Ann' };

describe('WS_EVENTS', () => {
  it('uses unique "<entity>:<action>" event names', () => {
    const names = [...Object.values(WS_EVENTS), ...Object.values(WS_CLIENT_EVENTS)];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+:[a-z]+(?:-[a-z]+)*$/);
    }
  });

  it('has a payload schema for every room event except presence and access revocation', () => {
    const withoutSchema = Object.values(WS_EVENTS).filter(
      (name) => !(BOARD_EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(withoutSchema.sort()).toEqual([
      WS_EVENTS.BOARD_ACCESS_REVOKED,
      WS_EVENTS.PRESENCE_UPDATE,
    ]);
  });
});

describe('room names', () => {
  it('builds the board room name', () => {
    expect(boardRoom('abc')).toBe('board:abc');
  });

  it('builds the user room name', () => {
    expect(userRoom('u1')).toBe('user:u1');
  });
});

describe('boardRoomRequestSchema', () => {
  it('accepts a board id', () => {
    expect(boardRoomRequestSchema.parse({ boardId: 'b1' })).toEqual({ boardId: 'b1' });
  });

  it.each([[{}], [{ boardId: '' }], [{ boardId: 5 }], [{ boardId: 'b', extra: 1 }], [null]])(
    'rejects %j',
    (value) => {
      expect(boardRoomRequestSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('parseBoardEvent', () => {
  it('returns the event with its validated payload', () => {
    const payload = { boardId: 'b1', actorId: 'u1', column };
    expect(parseBoardEvent('column:moved', payload)).toEqual({ name: 'column:moved', payload });
  });

  it('returns null for unknown events and malformed payloads', () => {
    expect(parseBoardEvent('presence:update', { boardId: 'b1', users: [] })).toBeNull();
    expect(parseBoardEvent('toString', {})).toBeNull();
    expect(parseBoardEvent('column:moved', { boardId: 'b1', actorId: 'u1' })).toBeNull();
  });
});

describe('event payload schemas', () => {
  it('requires boardId and actorId on change events', () => {
    const schema = boardEventSchemas[WS_EVENTS.COLUMN_CREATED];
    expect(schema.safeParse({ boardId: 'b1', actorId: 'u1', column }).success).toBe(true);
    expect(schema.safeParse({ boardId: 'b1', column }).success).toBe(false);
  });

  it('validates rank assignments of a rebalance', () => {
    const schema = boardEventSchemas[WS_EVENTS.COLUMNS_REBALANCED];
    const valid = { boardId: 'b1', actorId: 'u1', ranks: [{ id: 'c1', rank: 'V' }] };
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, ranks: [{ id: 'c1', rank: 'a0' }] }).success).toBe(false);
  });

  it('carries a board without the role in board:updated', () => {
    const board = { id: 'b1', name: 'B', key: 'BB', createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
    const parsed = boardEventSchemas[WS_EVENTS.BOARD_UPDATED].parse({
      boardId: 'b1',
      actorId: 'u1',
      board: { ...board, role: 'OWNER' },
    });
    expect(parsed.board).toEqual(board);
  });

  it('validates presence updates and join acknowledgements', () => {
    expect(presenceUpdateEventSchema.safeParse({ boardId: 'b1', users: [user] }).success).toBe(
      true,
    );
    expect(boardJoinAckSchema.parse({ ok: true, presence: [user] })).toEqual({
      ok: true,
      presence: [user],
    });
    expect(
      boardJoinAckSchema.safeParse({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } })
        .success,
    ).toBe(true);
    expect(boardJoinAckSchema.safeParse({ ok: true }).success).toBe(false);
  });
});

describe('echo suppression', () => {
  it('delivers activity:created to the originating socket as well', () => {
    expect(isEchoSuppressed(WS_EVENTS.ACTIVITY_CREATED)).toBe(false);
    expect([...ECHOED_BOARD_EVENTS]).toEqual([WS_EVENTS.ACTIVITY_CREATED]);
  });

  it('withholds every other board event from the originating socket', () => {
    for (const name of BOARD_EVENT_NAMES.filter((event) => event !== WS_EVENTS.ACTIVITY_CREATED)) {
      expect(isEchoSuppressed(name), name).toBe(true);
    }
  });
});

describe('label, comment and activity events', () => {
  const meta = { boardId: 'b1', actorId: 'u1' };
  const label = {
    id: 'l1',
    boardId: 'b1',
    name: 'Bug',
    color: 'RED',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
  const comment = {
    id: 'cm1',
    cardId: 'c1',
    boardId: 'b1',
    author: user,
    body: 'Hi',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    editedAt: null,
  };
  const activity = {
    id: 'a1',
    boardId: 'b1',
    cardId: null,
    actor: user,
    createdAt: TIMESTAMP,
    type: 'COLUMN_CREATED',
    payload: { column: { id: 'col-1', name: 'To Do' } },
  };

  it.each([
    ['label:created', { ...meta, label }],
    ['label:updated', { ...meta, label }],
    ['label:deleted', { ...meta, labelId: 'l1' }],
    ['comment:created', { ...meta, comment }],
    ['comment:updated', { ...meta, comment }],
    ['comment:deleted', { ...meta, cardId: 'c1', commentId: 'cm1' }],
    ['activity:created', { ...meta, activity }],
  ])('parses %s', (name, payload) => {
    expect(parseBoardEvent(name, payload)).toEqual({ name, payload });
  });

  it.each([
    ['label:deleted', meta],
    ['comment:deleted', { ...meta, commentId: 'cm1' }],
    ['activity:created', { ...meta, activity: { ...activity, type: 'NOPE' } }],
  ])('rejects a malformed %s', (name, payload) => {
    expect(parseBoardEvent(name, payload)).toBeNull();
  });
});
