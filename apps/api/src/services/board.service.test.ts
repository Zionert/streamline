import type { BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import type {
  BoardMemberRecord,
  BoardMemberRepository,
  BoardMemberWithUser,
} from '../repositories/board-member.repository.js';
import type { BoardRecord, BoardRepository } from '../repositories/board.repository.js';
import type { User } from '../repositories/user.repository.js';
import { createBoardAccessService, type BoardMembership } from './board-access.service.js';
import { createBoardService } from './board.service.js';

const now = new Date('2026-11-11T10:00:00.000Z');

const boardRecord: BoardRecord = { id: 'board-1', name: 'Roadmap', createdAt: now, updatedAt: now };

function memberRecord(userId: string, role: BoardRole): BoardMemberRecord {
  return { id: `m-${userId}`, boardId: 'board-1', userId, role, createdAt: now, updatedAt: now };
}

function withUser(member: BoardMemberRecord): BoardMemberWithUser {
  return { ...member, user: { id: member.userId, name: 'Jane', email: 'jane@example.com' } };
}

const candidate: User = {
  id: 'user-2',
  email: 'jane@example.com',
  passwordHash: 'hash',
  name: 'Jane',
  createdAt: now,
  updatedAt: now,
};

function fakeBoards(overrides: Partial<BoardRepository> = {}): BoardRepository {
  return {
    createWithOwner: vi.fn(() => Promise.resolve(boardRecord)),
    findById: vi.fn(() => Promise.resolve(boardRecord)),
    listForUser: vi.fn(() => Promise.resolve([])),
    rename: vi.fn(() => Promise.resolve(boardRecord)),
    delete: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

function fakeMembers(overrides: Partial<BoardMemberRepository> = {}): BoardMemberRepository {
  return {
    find: vi.fn(() => Promise.resolve(null)),
    findWithUser: vi.fn(() => Promise.resolve(null)),
    listForBoard: vi.fn(() => Promise.resolve([])),
    add: vi.fn(() => Promise.resolve({ status: 'already-member' as const })),
    updateRoleUnlessOwner: vi.fn(() => Promise.resolve(false)),
    removeUnlessOwner: vi.fn(() => Promise.resolve(false)),
    ...overrides,
  };
}

function buildService(
  options: { boards?: BoardRepository; members?: BoardMemberRepository; user?: User | null } = {},
) {
  return createBoardService({
    boards: options.boards ?? fakeBoards(),
    members: options.members ?? fakeMembers(),
    users: { findByEmail: () => Promise.resolve(options.user ?? null) },
  });
}

const as = (role: BoardRole, userId = 'user-1'): BoardMembership => ({
  boardId: 'board-1',
  userId,
  role,
});

describe('BoardService', () => {
  it('maps a created board to the OWNER view', async () => {
    const board = await buildService().create('user-1', { name: 'Roadmap' });

    expect(board).toEqual({
      id: 'board-1',
      name: 'Roadmap',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      role: 'OWNER',
    });
  });

  it('re-checks the role even when called without the route guard', async () => {
    const deleteBoard = vi.fn(() => Promise.resolve(true));
    const renameBoard = vi.fn(() => Promise.resolve(boardRecord));
    const service = buildService({
      boards: fakeBoards({ delete: deleteBoard, rename: renameBoard }),
    });

    await expect(service.delete(as('ADMIN'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.rename(as('VIEWER'), { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.addMember(as('MEMBER'), { email: candidate.email, role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(deleteBoard).not.toHaveBeenCalled();
    expect(renameBoard).not.toHaveBeenCalled();
  });

  it.each([
    ['get', (s: ReturnType<typeof buildService>) => s.get(as('VIEWER'))],
    ['rename', (s: ReturnType<typeof buildService>) => s.rename(as('OWNER'), { name: 'X' })],
    ['delete', (s: ReturnType<typeof buildService>) => s.delete(as('OWNER'))],
  ])('%s returns 404 when the board disappeared concurrently', async (_name, call) => {
    const service = buildService({
      boards: fakeBoards({
        findById: () => Promise.resolve(null),
        rename: () => Promise.resolve(null),
        delete: () => Promise.resolve(false),
      }),
    });

    await expect(call(service)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('addMember', () => {
    it('maps a concurrent duplicate to ALREADY_MEMBER', async () => {
      const service = buildService({ user: candidate });

      await expect(
        service.addMember(as('OWNER'), { email: candidate.email, role: 'MEMBER' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_MEMBER' });
    });

    it('maps a board deleted in the meantime to 404', async () => {
      const members = fakeMembers({
        add: () => Promise.resolve({ status: 'missing-reference' as const }),
      });

      await expect(
        buildService({ members, user: candidate }).addMember(as('ADMIN'), {
          email: candidate.email,
          role: 'VIEWER',
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('reports USER_NOT_FOUND without touching memberships', async () => {
      const add = vi.fn(() => Promise.resolve({ status: 'already-member' as const }));
      const members = fakeMembers({ add });

      await expect(
        buildService({ members }).addMember(as('OWNER'), {
          email: 'nobody@example.com',
          role: 'MEMBER',
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
      expect(add).not.toHaveBeenCalled();
    });
  });

  describe('updateMemberRole', () => {
    it('distinguishes a missing member (404) from the OWNER (403)', async () => {
      const missing = buildService({ members: fakeMembers() });
      const owner = buildService({
        members: fakeMembers({ find: () => Promise.resolve(memberRecord('owner', 'OWNER')) }),
      });

      await expect(
        missing.updateMemberRole(as('OWNER'), 'ghost', { role: 'VIEWER' }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        owner.updateMemberRole(as('ADMIN'), 'owner', { role: 'VIEWER' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('returns 404 when the member was removed right after the update', async () => {
      const members = fakeMembers({ updateRoleUnlessOwner: () => Promise.resolve(true) });

      await expect(
        buildService({ members }).updateMemberRole(as('OWNER'), 'user-3', { role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the updated member', async () => {
      const members = fakeMembers({
        updateRoleUnlessOwner: () => Promise.resolve(true),
        findWithUser: () => Promise.resolve(withUser(memberRecord('user-3', 'ADMIN'))),
      });

      await expect(
        buildService({ members }).updateMemberRole(as('OWNER'), 'user-3', { role: 'ADMIN' }),
      ).resolves.toEqual({
        userId: 'user-3',
        name: 'Jane',
        email: 'jane@example.com',
        role: 'ADMIN',
        joinedAt: now.toISOString(),
      });
    });
  });

  describe('removeMember', () => {
    it('refuses to let the OWNER leave without touching the repository', async () => {
      const removeUnlessOwner = vi.fn(() => Promise.resolve(true));
      const members = fakeMembers({ removeUnlessOwner });

      await expect(
        buildService({ members }).removeMember(as('OWNER'), 'user-1'),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(removeUnlessOwner).not.toHaveBeenCalled();
    });

    it('lets a VIEWER leave but not remove others', async () => {
      const members = fakeMembers({ removeUnlessOwner: () => Promise.resolve(true) });
      const service = buildService({ members });

      await expect(service.removeMember(as('VIEWER'), 'user-1')).resolves.toBeUndefined();
      await expect(service.removeMember(as('VIEWER'), 'user-3')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('forbids removing the OWNER', async () => {
      const members = fakeMembers({
        find: () => Promise.resolve(memberRecord('owner', 'OWNER')),
      });

      await expect(
        buildService({ members }).removeMember(as('ADMIN'), 'owner'),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});

describe('BoardAccessService', () => {
  it('returns 404 for non-members', async () => {
    const access = createBoardAccessService({ members: fakeMembers() });

    await expect(access.require('board-1', 'user-1', 'board:view')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('returns 403 for members lacking the role', async () => {
    const access = createBoardAccessService({
      members: fakeMembers({ find: () => Promise.resolve(memberRecord('user-1', 'MEMBER')) }),
    });

    await expect(access.require('board-1', 'user-1', 'board:rename')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('returns the membership when the role allows the action', async () => {
    const access = createBoardAccessService({
      members: fakeMembers({ find: () => Promise.resolve(memberRecord('user-1', 'ADMIN')) }),
    });

    await expect(access.require('board-1', 'user-1', 'members:manage')).resolves.toEqual({
      boardId: 'board-1',
      userId: 'user-1',
      role: 'ADMIN',
    });
  });
});
