import { isValidRank, type BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import type {
  BoardMemberRecord,
  BoardMemberRepository,
  BoardMemberWithUser,
} from '../repositories/board-member.repository.js';
import type { BoardRecord, BoardRepository } from '../repositories/board.repository.js';
import type { User } from '../repositories/user.repository.js';
import { createRecordingBoardEvents } from '../test/board-events.js';
import { createBoardAccessService, type BoardMembership } from './board-access.service.js';
import {
  createBoardService,
  defaultBoardColumns,
  MAX_BOARD_KEY_ATTEMPTS,
} from './board.service.js';

const now = new Date('2026-11-11T10:00:00.000Z');

const boardRecord: BoardRecord = {
  id: 'board-1',
  name: 'Roadmap',
  key: 'RO',
  ownerId: 'user-1',
  nextCardNumber: 1,
  createdAt: now,
  updatedAt: now,
};

const created = { status: 'created' as const, board: boardRecord };

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
    createWithOwner: vi.fn(() => Promise.resolve(created)),
    findById: vi.fn(() => Promise.resolve(boardRecord)),
    listKeysForOwner: vi.fn(() => Promise.resolve([])),
    listForUser: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => Promise.resolve({ status: 'updated' as const, board: boardRecord })),
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
      key: 'RO',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      role: 'OWNER',
    });
  });

  it('creates the board with the four default columns in order', async () => {
    const createWithOwner = vi.fn(() => Promise.resolve(created));

    await buildService({ boards: fakeBoards({ createWithOwner }) }).create('user-1', {
      name: 'Roadmap',
    });

    expect(createWithOwner).toHaveBeenCalledWith({
      name: 'Roadmap',
      key: 'RO',
      ownerId: 'user-1',
      columns: expect.any(Array) as unknown,
    });
    const columns = defaultBoardColumns();
    expect(columns.map(({ title, category }) => ({ title, category }))).toEqual([
      { title: 'Backlog', category: 'BACKLOG' },
      { title: 'To Do', category: 'TODO' },
      { title: 'In Progress', category: 'IN_PROGRESS' },
      { title: 'Done', category: 'DONE' },
    ]);
    const ranks = columns.map((column) => column.rank);
    expect(ranks.every((rank) => isValidRank(rank))).toBe(true);
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('re-checks the role even when called without the route guard', async () => {
    const deleteBoard = vi.fn(() => Promise.resolve(true));
    const updateBoard = vi.fn(() =>
      Promise.resolve({ status: 'updated' as const, board: boardRecord }),
    );
    const service = buildService({
      boards: fakeBoards({ delete: deleteBoard, update: updateBoard }),
    });

    await expect(service.delete(as('ADMIN'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.update(as('VIEWER'), { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.addMember(as('MEMBER'), { email: candidate.email, role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(deleteBoard).not.toHaveBeenCalled();
    expect(updateBoard).not.toHaveBeenCalled();
  });

  it.each([
    ['get', (s: ReturnType<typeof buildService>) => s.get(as('VIEWER'))],
    ['update', (s: ReturnType<typeof buildService>) => s.update(as('OWNER'), { name: 'X' })],
    ['delete', (s: ReturnType<typeof buildService>) => s.delete(as('OWNER'))],
  ])('%s returns 404 when the board disappeared concurrently', async (_name, call) => {
    const service = buildService({
      boards: fakeBoards({
        findById: () => Promise.resolve(null),
        update: () => Promise.resolve({ status: 'not-found' as const }),
        delete: () => Promise.resolve(false),
      }),
    });

    await expect(call(service)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('board keys', () => {
    it("skips keys of the owner's other boards", async () => {
      const createWithOwner = vi.fn(() => Promise.resolve(created));
      const boards = fakeBoards({
        createWithOwner,
        listKeysForOwner: () => Promise.resolve(['SB', 'SBO']),
      });

      await buildService({ boards }).create('user-1', { name: 'Sprint Board' });

      expect(createWithOwner).toHaveBeenCalledWith(expect.objectContaining({ key: 'SBOA' }));
    });

    it('tries the next candidate when a concurrent request takes the key', async () => {
      const createWithOwner = vi
        .fn<BoardRepository['createWithOwner']>()
        .mockResolvedValueOnce({ status: 'key-taken' })
        .mockResolvedValueOnce({ status: 'key-taken' })
        .mockResolvedValue(created);

      await buildService({ boards: fakeBoards({ createWithOwner }) }).create('user-1', {
        name: 'Roadmap',
      });

      expect(createWithOwner.mock.calls.map(([data]) => data.key)).toEqual(['RO', 'ROA', 'ROAD']);
    });

    it(`gives up with BOARD_KEY_TAKEN after ${String(MAX_BOARD_KEY_ATTEMPTS)} attempts`, async () => {
      const createWithOwner = vi.fn(() => Promise.resolve({ status: 'key-taken' as const }));
      const service = buildService({ boards: fakeBoards({ createWithOwner }) });

      await expect(service.create('user-1', { name: 'Roadmap' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'BOARD_KEY_TAKEN',
      });
      expect(createWithOwner).toHaveBeenCalledTimes(MAX_BOARD_KEY_ATTEMPTS);
    });

    it('maps a key used by another board of the owner to 409 BOARD_KEY_TAKEN', async () => {
      const service = buildService({
        boards: fakeBoards({ update: () => Promise.resolve({ status: 'key-taken' as const }) }),
      });

      await expect(service.update(as('ADMIN'), { key: 'XY' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'BOARD_KEY_TAKEN',
      });
    });
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

describe('BoardService events', () => {
  function serviceWithEvents(members: BoardMemberRepository = fakeMembers()) {
    const events = createRecordingBoardEvents();
    const service = createBoardService({
      boards: fakeBoards(),
      members,
      users: { findByEmail: () => Promise.resolve(candidate) },
      events,
    });
    return { service, events: events.events };
  }

  const meta = { boardId: 'board-1', actorId: 'user-1' };
  const origin = { socketId: 's1' };

  it('broadcasts board:updated with the board without the role', async () => {
    const { service, events } = serviceWithEvents();

    await service.update(as('OWNER'), { name: 'Roadmap' }, origin);

    expect(events).toEqual([
      {
        name: 'board:updated',
        payload: {
          ...meta,
          board: {
            id: 'board-1',
            name: 'Roadmap',
            key: 'RO',
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        },
        origin,
      },
    ]);
  });

  it('closes the board room after deleting the board', async () => {
    const { service, events } = serviceWithEvents();

    await service.delete(as('OWNER'), origin);

    expect(events).toEqual([{ name: 'board:deleted', payload: meta, origin }]);
  });

  it('broadcasts member:added and member:updated', async () => {
    const member = withUser(memberRecord('user-2', 'MEMBER'));
    const { service, events } = serviceWithEvents(
      fakeMembers({
        add: vi.fn(() => Promise.resolve({ status: 'created' as const, member })),
        updateRoleUnlessOwner: vi.fn(() => Promise.resolve(true)),
        findWithUser: vi.fn(() => Promise.resolve(member)),
      }),
    );

    const added = await service.addMember(as('ADMIN'), {
      email: 'jane@example.com',
      role: 'MEMBER',
    });
    const updated = await service.updateMemberRole(as('ADMIN'), 'user-2', { role: 'MEMBER' });

    expect(events).toEqual([
      { name: 'member:added', payload: { ...meta, member: added }, origin: undefined },
      { name: 'member:updated', payload: { ...meta, member: updated }, origin: undefined },
    ]);
  });

  it('revokes the access of a removed member before announcing the removal', async () => {
    const { service, events } = serviceWithEvents(
      fakeMembers({ removeUnlessOwner: vi.fn(() => Promise.resolve(true)) }),
    );

    await service.removeMember(as('ADMIN'), 'user-2', origin);

    expect(events).toEqual([
      { name: 'revoke-access', boardId: 'board-1', userId: 'user-2', origin },
      { name: 'member:removed', payload: { ...meta, userId: 'user-2' }, origin },
    ]);
  });

  it('revokes the access of a member who leaves', async () => {
    const { service, events } = serviceWithEvents(
      fakeMembers({ removeUnlessOwner: vi.fn(() => Promise.resolve(true)) }),
    );

    await service.removeMember(as('MEMBER', 'user-3'), 'user-3');

    expect(events).toEqual([
      { name: 'revoke-access', boardId: 'board-1', userId: 'user-3', origin: undefined },
      {
        name: 'member:removed',
        payload: { boardId: 'board-1', actorId: 'user-3', userId: 'user-3' },
        origin: undefined,
      },
    ]);
  });

  it('broadcasts nothing when the change fails', async () => {
    const { service, events } = serviceWithEvents(
      fakeMembers({ find: vi.fn(() => Promise.resolve(memberRecord('user-9', 'OWNER'))) }),
    );

    await expect(service.removeMember(as('ADMIN'), 'user-9')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.delete(as('ADMIN'))).rejects.toBeInstanceOf(ForbiddenError);
    expect(events).toEqual([]);
  });
});
