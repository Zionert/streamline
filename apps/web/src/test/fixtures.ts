import type {
  AuthResponse,
  Board,
  BoardMember,
  Card,
  Column,
  ColumnCards,
  PublicUser,
} from '@streamline/shared';

export const testUser: PublicUser = {
  id: 'user-1',
  email: 'jan@example.com',
  name: 'Jan Kowalski',
  createdAt: '2026-11-11T10:00:00.000Z',
};

export function sessionWith(accessToken: string, user: PublicUser = testUser): AuthResponse {
  return { accessToken, user };
}

const TIMESTAMP = '2026-11-11T10:00:00.000Z';

export function boardWith(overrides: Partial<Board> = {}): Board {
  return {
    id: 'board-1',
    name: 'Sprint board',
    key: 'SB',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    role: 'OWNER',
    ...overrides,
  };
}

export function columnWith(overrides: Partial<Column> & Pick<Column, 'id' | 'rank'>): Column {
  return {
    boardId: 'board-1',
    title: overrides.id,
    category: 'TODO',
    wipLimit: null,
    wipStrict: false,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

/** The four default columns of a new board, ranked `a` < `h` < `p` < `x`. */
export function defaultColumns(boardId = 'board-1'): Column[] {
  return [
    columnWith({ id: 'col-backlog', title: 'Backlog', rank: 'a', category: 'BACKLOG', boardId }),
    columnWith({ id: 'col-todo', title: 'To Do', rank: 'h', category: 'TODO', boardId }),
    columnWith({
      id: 'col-progress',
      title: 'In Progress',
      rank: 'p',
      category: 'IN_PROGRESS',
      wipLimit: 3,
      boardId,
    }),
    columnWith({ id: 'col-done', title: 'Done', rank: 'x', category: 'DONE', boardId }),
  ];
}

export function memberWith(overrides: Partial<BoardMember> = {}): BoardMember {
  return {
    userId: testUser.id,
    name: testUser.name,
    email: testUser.email,
    role: 'OWNER',
    joinedAt: TIMESTAMP,
    ...overrides,
  };
}

/** A card of board-1 (key `SB-<number>`), MEDIUM priority, unassigned unless overridden. */
export function cardWith(
  overrides: Partial<Card> & Pick<Card, 'id' | 'number' | 'columnId' | 'rank'>,
): Card {
  return {
    key: `SB-${String(overrides.number)}`,
    boardId: 'board-1',
    title: `Card ${String(overrides.number)}`,
    description: null,
    priority: 'MEDIUM',
    assigneeId: null,
    dueDate: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

/** Body of `GET /boards/:boardId/cards`: every given column with its cards (in rank order). */
export function cardListFor(
  columns: readonly Column[],
  cards: readonly Card[] = [],
): {
  columns: ColumnCards[];
} {
  return {
    columns: columns.map((column) => ({
      columnId: column.id,
      cards: cards
        .filter((card) => card.columnId === column.id)
        .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)),
    })),
  };
}
