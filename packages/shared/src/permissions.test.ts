import { describe, expect, it } from 'vitest';

import {
  BOARD_ACTIONS,
  BOARD_PERMISSIONS,
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
