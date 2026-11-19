import type {
  AiJsonValue,
  Board,
  BoardMember,
  Card,
  Column,
  ColumnCards,
  Comment,
  Label,
} from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '../../errors/app-error.js';
import type { BoardMembership } from '../board-access.service.js';
import { createBoardTools, type BoardToolServices, type BoardToolOutcome } from './board-tools.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const TIMESTAMP = '2026-11-01T10:00:00.000Z';
const membership: BoardMembership = { boardId: 'board-1', userId: 'u-me', role: 'VIEWER' };

const column = (id: string, title: string, category: Column['category']): Column => ({
  id,
  boardId: 'board-1',
  title,
  rank: 'm',
  category,
  wipLimit: null,
  wipStrict: false,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
});

const columns = [
  column('c-todo', 'To Do', 'TODO'),
  column('c-doing', 'In Progress', 'IN_PROGRESS'),
];

const card = (number: number, columnId: string, overrides: Partial<Card> = {}): Card => ({
  id: `card-${String(number)}`,
  key: `RO-${String(number)}`,
  number,
  boardId: 'board-1',
  columnId,
  title: `Card ${String(number)}`,
  description: null,
  rank: 'm',
  priority: 'MEDIUM',
  assigneeId: null,
  dueDate: null,
  labelIds: [],
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  ...overrides,
});

const members: BoardMember[] = [
  {
    userId: 'u-me',
    name: 'Ola Nowak',
    email: 'ola@example.com',
    role: 'VIEWER',
    joinedAt: TIMESTAMP,
  },
  {
    userId: 'u-2',
    name: 'Petro Ivanenko',
    email: 'petro@example.com',
    role: 'MEMBER',
    joinedAt: TIMESTAMP,
  },
];

const labels: Label[] = [
  {
    id: 'l-bug',
    boardId: 'board-1',
    name: 'Bug',
    color: 'RED',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
];

function setup(cards: ColumnCards[], comments: Comment[] = []) {
  const services = {
    boardService: {
      get: vi.fn((): Promise<Board> =>
        Promise.resolve({
          id: 'board-1',
          name: 'Roadmap',
          key: 'RO',
          role: 'VIEWER',
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        }),
      ),
      listMembers: vi.fn(() => Promise.resolve(members)),
    },
    columnService: { list: vi.fn(() => Promise.resolve(columns)) },
    cardService: {
      list: vi.fn(() => Promise.resolve(cards)),
      getByKey: vi.fn((_membership: BoardMembership, key: { boardKey: string; number: number }) => {
        const found = cards
          .flatMap((entry) => entry.cards)
          .find((item) => key.boardKey === 'RO' && item.number === key.number);
        return found ? Promise.resolve(found) : Promise.reject(new NotFoundError('Card not found'));
      }),
    },
    labelService: { list: vi.fn(() => Promise.resolve(labels)) },
    commentService: {
      list: vi.fn(() => Promise.resolve({ items: comments, nextCursor: null })),
    },
    analyticsService: {
      getAnalytics: vi.fn(),
      forecast: vi.fn(() =>
        Promise.reject(
          new ValidationError('Validation failed', [{ message: 'targetDate must be after today' }]),
        ),
      ),
    },
  } satisfies Record<keyof BoardToolServices, unknown>;
  return { services, tools: createBoardTools(services) };
}

async function call(
  tools: ReturnType<typeof createBoardTools>,
  name: string,
  args: unknown,
): Promise<BoardToolOutcome> {
  const checked = tools.check({ id: 'c1', name, argumentsJson: JSON.stringify(args) });
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return checked.run({ membership, now: NOW });
}

function data(outcome: BoardToolOutcome): AiJsonValue {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.data;
}

const board: ColumnCards[] = [
  {
    columnId: 'c-todo',
    cards: [
      card(1, 'c-todo', { title: 'Login form', assigneeId: 'u-me', labelIds: ['l-bug'] }),
      card(2, 'c-todo', { description: 'Mentions LOGIN in the description' }),
    ],
  },
  { columnId: 'c-doing', cards: [card(3, 'c-doing', { assigneeId: 'u-2', title: 'Payments' })] },
];

describe('board tool definitions', () => {
  it('have strict object schemas without a board argument', () => {
    const { tools } = setup(board);
    expect(tools.definitions.map((tool) => tool.name)).toEqual([
      'get_board_overview',
      'search_cards',
      'get_card',
      'get_flow_metrics',
      'get_forecast',
    ]);
    for (const tool of tools.definitions) {
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
      expect(tool.parameters).not.toHaveProperty('$schema');
      expect(JSON.stringify(tool.parameters)).not.toMatch(/board/i);
    }
  });

  it('reject unknown tools, extra keys and invalid JSON', () => {
    const { tools } = setup(board);
    const check = (name: string, argumentsJson: string) =>
      tools.check({ id: 'c', name, argumentsJson });

    expect(check('delete_card', '{}')).toMatchObject({ ok: false });
    expect(check('search_cards', '{"boardId":"other"}')).toMatchObject({ ok: false });
    expect(check('get_card', '{key:1}')).toMatchObject({ ok: false });
    expect(check('get_card', '{"key":"12"}')).toMatchObject({ ok: false });
    expect(check('get_forecast', '{"remaining":3,"targetDate":"2026-12-01"}')).toMatchObject({
      ok: false,
    });
    expect(check('get_board_overview', '')).toMatchObject({ ok: false });
  });
});

describe('search_cards', () => {
  it('lists all cards in board order with names instead of ids', async () => {
    const { tools } = setup(board);
    expect(data(await call(tools, 'search_cards', {}))).toEqual({
      total: 3,
      returned: 3,
      truncated: false,
      cards: [
        {
          key: 'RO-1',
          title: 'Login form',
          column: 'To Do',
          priority: 'MEDIUM',
          assignee: 'Ola Nowak',
          dueDate: null,
          labels: ['Bug'],
        },
        expect.objectContaining({ key: 'RO-2', assignee: null }),
        expect.objectContaining({ key: 'RO-3', column: 'In Progress', assignee: 'Petro Ivanenko' }),
      ],
    });
  });

  it.each([
    [{ query: 'login' }, ['RO-1', 'RO-2']],
    [{ query: 'ro-3' }, ['RO-3']],
    [{ assignee: 'me' }, ['RO-1']],
    [{ assignee: 'petro' }, ['RO-3']],
    [{ assignee: 'unassigned' }, ['RO-2']],
    [{ column: 'in progress' }, ['RO-3']],
    [{ column: 'progress' }, ['RO-3']],
    [{ label: 'bug' }, ['RO-1']],
    [{ query: 'login', assignee: 'me' }, ['RO-1']],
  ])('filters by %o', async (args, keys) => {
    const { tools } = setup(board);
    const result = data(await call(tools, 'search_cards', args)) as { cards: { key: string }[] };
    expect(result.cards.map((item) => item.key)).toEqual(keys);
  });

  it('explains filters that match nothing', async () => {
    const { tools } = setup(board);
    expect(data(await call(tools, 'search_cards', { column: 'QA', label: 'x' }))).toMatchObject({
      total: 0,
      notes: [
        'No column matches "QA". Columns: To Do, In Progress.',
        'No label is named "x". Labels: Bug.',
      ],
    });
  });

  it('caps the list and says that it was cut', async () => {
    const many = Array.from({ length: 60 }, (_, index) => card(index + 1, 'c-todo'));
    const { tools } = setup([{ columnId: 'c-todo', cards: many }]);

    expect(data(await call(tools, 'search_cards', {}))).toMatchObject({
      total: 60,
      returned: 30,
      truncated: true,
    });
    expect(data(await call(tools, 'search_cards', { limit: 50 }))).toMatchObject({ returned: 50 });
  });
});

describe('get_board_overview', () => {
  it('describes the board without emails or ids', async () => {
    const { tools } = setup(board);
    const result = data(await call(tools, 'get_board_overview', {}));
    expect(result).toEqual({
      board: { name: 'Roadmap', key: 'RO' },
      currentUser: 'Ola Nowak',
      columns: [
        { title: 'To Do', category: 'TODO', wipLimit: null, wipStrict: false, cards: 2 },
        {
          title: 'In Progress',
          category: 'IN_PROGRESS',
          wipLimit: null,
          wipStrict: false,
          cards: 1,
        },
      ],
      totalCards: 3,
      members: ['Ola Nowak', 'Petro Ivanenko'],
      labels: ['Bug'],
    });
    expect(JSON.stringify(result)).not.toContain('@');
  });
});

describe('get_card', () => {
  it('returns the card with its latest comments, emails redacted', async () => {
    const comments: Comment[] = Array.from({ length: 7 }, (_, index) => ({
      id: `cm-${String(index)}`,
      cardId: 'card-2',
      boardId: 'board-1',
      author: { id: 'u-2', name: 'Petro Ivanenko' },
      body: `Comment ${String(index)} by petro@example.com`,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      editedAt: null,
    }));
    const { tools, services } = setup(board, comments);

    const result = data(await call(tools, 'get_card', { key: ' ro-2 ' }));

    expect(services.cardService.getByKey).toHaveBeenCalledWith(membership, {
      boardKey: 'RO',
      number: 2,
    });
    expect(result).toMatchObject({
      key: 'RO-2',
      column: 'To Do',
      columnCategory: 'TODO',
      description: 'Mentions LOGIN in the description',
      commentCount: 7,
      createdAt: '2026-11-01',
    });
    const latest = (result as { latestComments: { body: string }[] }).latestComments;
    expect(latest.map((comment) => comment.body)).toEqual(
      [2, 3, 4, 5, 6].map((index) => `Comment ${String(index)} by [email hidden]`),
    );
  });

  it('reports an unknown key or a key of another board as not found', async () => {
    const { tools } = setup(board);
    for (const key of ['RO-99', 'XY-1']) {
      expect(await call(tools, 'get_card', { key })).toEqual({
        ok: false,
        error: `Card ${key} was not found on this board.`,
      });
    }
  });
});

describe('get_forecast', () => {
  it('reports a rejected forecast query as a failed call with the reason', async () => {
    const { tools, services } = setup(board);
    expect(await call(tools, 'get_forecast', { targetDate: '2026-11-01' })).toEqual({
      ok: false,
      error: 'targetDate must be after today',
    });
    expect(services.analyticsService.forecast).toHaveBeenCalledWith(membership, {
      mode: 'date',
      targetDate: '2026-11-01',
      timeZone: 'UTC',
      sampleDays: 30,
    });
  });
});
