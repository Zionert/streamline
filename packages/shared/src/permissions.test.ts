import { describe, expect, it } from 'vitest';

import {
  BOARD_ACTIONS,
  BOARD_PERMISSIONS,
  canDeleteComment,
  canEditComment,
  canLeaveBoard,
  canManageMember,
  hasBoardPermission,
  type BoardAction,
} from './permissions.js';
import { BOARD_ROLES, type BoardRole } from './schemas/board.js';

/**
 * The role matrix written out cell by cell, independently of the implementation.
 * Columns: OWNER, ADMIN, MEMBER, VIEWER.
 */
const EXPECTED: Record<BoardAction, [boolean, boolean, boolean, boolean]> = {
  'board:view': [true, true, true, true],
  'card:write': [true, true, true, false],
  'column:write': [true, true, true, false],
  'ai:use': [true, true, true, false],
  'column:settings': [true, true, false, false],
  'members:manage': [true, true, false, false],
  'board:rename': [true, true, false, false],
  'board:delete': [true, false, false, false],
  'board:transfer': [true, false, false, false],
};

const cells = BOARD_ACTIONS.flatMap((action) =>
  BOARD_ROLES.map((role, index) => ({ action, role, allowed: EXPECTED[action][index] })),
);

describe('hasBoardPermission', () => {
  it('covers every action of the matrix', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...BOARD_ACTIONS].sort());
    expect(Object.keys(BOARD_PERMISSIONS).sort()).toEqual([...BOARD_ACTIONS].sort());
  });

  it.each(cells)('$role -> $action: $allowed', ({ action, role, allowed }) => {
    expect(hasBoardPermission(role, action)).toBe(allowed);
  });
});

describe('canManageMember', () => {
  const managers: readonly BoardRole[] = ['OWNER', 'ADMIN'];
  const pairs = BOARD_ROLES.flatMap((actor) =>
    BOARD_ROLES.map((target) => ({
      actor,
      target,
      allowed: managers.includes(actor) && target !== 'OWNER',
    })),
  );

  it.each(pairs)('$actor managing $target: $allowed', ({ actor, target, allowed }) => {
    expect(canManageMember(actor, target)).toBe(allowed);
  });

  it('lets an ADMIN manage another ADMIN', () => {
    expect(canManageMember('ADMIN', 'ADMIN')).toBe(true);
  });
});

describe('canLeaveBoard', () => {
  it.each([
    ['OWNER', false],
    ['ADMIN', true],
    ['MEMBER', true],
    ['VIEWER', true],
  ] as const)('%s: %s', (role, allowed) => {
    expect(canLeaveBoard(role)).toBe(allowed);
  });
});

describe('comment permissions', () => {
  const author = 'u1';
  const writers: readonly BoardRole[] = ['OWNER', 'ADMIN', 'MEMBER'];
  const managers: readonly BoardRole[] = ['OWNER', 'ADMIN'];
  const cases = BOARD_ROLES.flatMap((role) =>
    [true, false].map((isAuthor) => ({ role, isAuthor })),
  );

  it.each(cases)('$role (author: $isAuthor) editing', ({ role, isAuthor }) => {
    const actor = { userId: isAuthor ? author : 'u2', role };
    expect(canEditComment(actor, { authorId: author })).toBe(isAuthor && writers.includes(role));
  });

  it.each(cases)('$role (author: $isAuthor) deleting', ({ role, isAuthor }) => {
    const actor = { userId: isAuthor ? author : 'u2', role };
    expect(canDeleteComment(actor, { authorId: author })).toBe(
      (isAuthor && writers.includes(role)) || managers.includes(role),
    );
  });

  it('lets nobody edit a comment whose author no longer exists, only managers delete it', () => {
    for (const role of BOARD_ROLES) {
      expect(canEditComment({ userId: 'u1', role }, { authorId: null })).toBe(false);
      expect(canDeleteComment({ userId: 'u1', role }, { authorId: null })).toBe(
        managers.includes(role),
      );
    }
  });

  it('does not let a former member who became a VIEWER edit or delete their comment', () => {
    const actor = { userId: author, role: 'VIEWER' as const };
    expect(canEditComment(actor, { authorId: author })).toBe(false);
    expect(canDeleteComment(actor, { authorId: author })).toBe(false);
  });
});
