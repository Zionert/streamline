import { describe, expect, it } from 'vitest';

import {
  addBoardMemberSchema,
  BOARD_NAME_MAX_LENGTH,
  BOARD_ROLES,
  boardListResponseSchema,
  boardMemberListResponseSchema,
  boardMemberSchema,
  boardNameSchema,
  boardRoleSchema,
  boardSchema,
  createBoardSchema,
  updateBoardMemberSchema,
  updateBoardSchema,
} from './board.js';

describe('boardRoleSchema', () => {
  it.each(BOARD_ROLES)('accepts %s', (role) => {
    expect(boardRoleSchema.parse(role)).toBe(role);
  });

  it.each(['owner', 'GUEST', ''])('rejects %j', (role) => {
    expect(boardRoleSchema.safeParse(role).success).toBe(false);
  });
});

describe('boardNameSchema', () => {
  it('trims the name', () => {
    expect(boardNameSchema.parse('  Sprint 1  ')).toBe('Sprint 1');
  });

  it.each(['', '   '])('rejects a blank name %j', (name) => {
    expect(boardNameSchema.safeParse(name).success).toBe(false);
  });

  it('accepts a name of exactly the maximum length', () => {
    expect(boardNameSchema.safeParse('a'.repeat(BOARD_NAME_MAX_LENGTH)).success).toBe(true);
  });

  it('rejects a name longer than the maximum', () => {
    expect(boardNameSchema.safeParse('a'.repeat(BOARD_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('measures the length after trimming', () => {
    expect(boardNameSchema.safeParse(` ${'a'.repeat(BOARD_NAME_MAX_LENGTH)} `).success).toBe(true);
  });

  it('rejects non-string values', () => {
    expect(boardNameSchema.safeParse(42).success).toBe(false);
  });
});

describe('createBoardSchema / updateBoardSchema', () => {
  it.each([createBoardSchema, updateBoardSchema])('requires a name', (schema) => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.parse({ name: ' Roadmap ' })).toEqual({ name: 'Roadmap' });
  });
});

describe('addBoardMemberSchema', () => {
  it('normalizes the email and defaults the role to MEMBER', () => {
    expect(addBoardMemberSchema.parse({ email: '  Jane@Example.COM ' })).toEqual({
      email: 'jane@example.com',
      role: 'MEMBER',
    });
  });

  it.each(['ADMIN', 'MEMBER', 'VIEWER'] as const)('accepts the role %s', (role) => {
    expect(addBoardMemberSchema.parse({ email: 'jane@example.com', role }).role).toBe(role);
  });

  it('never accepts OWNER', () => {
    expect(
      addBoardMemberSchema.safeParse({ email: 'jane@example.com', role: 'OWNER' }).success,
    ).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(addBoardMemberSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('updateBoardMemberSchema', () => {
  it.each(['ADMIN', 'MEMBER', 'VIEWER'] as const)('accepts the role %s', (role) => {
    expect(updateBoardMemberSchema.parse({ role })).toEqual({ role });
  });

  it.each([{ role: 'OWNER' }, { role: 'member' }, {}])('rejects %j', (body) => {
    expect(updateBoardMemberSchema.safeParse(body).success).toBe(false);
  });
});

describe('response schemas', () => {
  const board = {
    id: 'b1',
    name: 'Roadmap',
    createdAt: '2026-11-11T10:00:00.000Z',
    updatedAt: '2026-11-11T10:00:00.000Z',
    role: 'OWNER',
  };
  const member = {
    userId: 'u1',
    name: 'Jane',
    email: 'jane@example.com',
    role: 'VIEWER',
    joinedAt: '2026-11-11T10:00:00.000Z',
  };

  it('parses a board list', () => {
    expect(boardListResponseSchema.parse({ boards: [board] })).toEqual({ boards: [board] });
  });

  it('requires the current user role on a board', () => {
    const { role: _role, ...withoutRole } = board;
    expect(boardSchema.safeParse(withoutRole).success).toBe(false);
  });

  it('parses a member list', () => {
    expect(boardMemberListResponseSchema.parse({ members: [member] })).toEqual({
      members: [member],
    });
  });

  it('rejects a member with a non-ISO join date', () => {
    expect(boardMemberSchema.safeParse({ ...member, joinedAt: 'yesterday' }).success).toBe(false);
  });
});
