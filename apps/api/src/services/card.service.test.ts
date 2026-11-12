import { cardSchema, type BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../errors/app-error.js';
import { BoardBusyError } from '../repositories/board-transaction.js';
import type { CardRecord, CardRepository } from '../repositories/card.repository.js';
import type { BoardMembership } from './board-access.service.js';
import { createCardService, formatDueDate, parseDueDate, toCard } from './card.service.js';

const now = new Date('2026-11-12T10:00:00.000Z');

const record: CardRecord = {
  id: 'card-1',
  boardId: 'board-1',
  columnId: 'col-1',
  number: 12,
  title: 'Write tests',
  description: null,
  rank: 'U',
  priority: 'HIGH',
  assigneeId: 'user-2',
  dueDate: parseDueDate('2027-02-28'),
  createdAt: now,
  updatedAt: now,
};

function fakeCards(overrides: Partial<CardRepository> = {}): CardRepository {
  return {
    transaction: vi.fn(() => Promise.reject(new Error('unexpected transaction'))),
    findBoardKey: vi.fn(() => Promise.resolve('SL')),
    listBoard: vi.fn(() => Promise.resolve(null)),
    findById: vi.fn(() => Promise.resolve(null)),
    findByNumber: vi.fn(() => Promise.resolve(record)),
    delete: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

const as = (role: BoardRole): BoardMembership => ({ boardId: 'board-1', userId: 'u1', role });

describe('due dates', () => {
  it('round-trips a calendar date through the UTC-midnight representation', () => {
    expect(parseDueDate('2027-02-28').toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(formatDueDate(parseDueDate('2027-12-31'))).toBe('2027-12-31');
  });
});

describe('toCard', () => {
  it('maps a record to the API shape with a derived key', () => {
    const card = toCard(record, 'SL');

    expect(cardSchema.parse(card)).toEqual(card);
    expect(card).toMatchObject({ key: 'SL-12', dueDate: '2027-02-28', priority: 'HIGH' });
  });
});

describe('CardService', () => {
  it('re-checks the role even without the route guard', async () => {
    const transaction = vi.fn(() => Promise.reject(new Error('unexpected transaction')));
    const remove = vi.fn(() => Promise.resolve(true));
    const service = createCardService({ cards: fakeCards({ transaction, delete: remove }) });

    await expect(
      service.create(as('VIEWER'), { columnId: 'col-1', title: 'X' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.update(as('VIEWER'), 'card-1', { title: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      service.move(as('VIEWER'), 'card-1', { columnId: 'col-1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.delete(as('VIEWER'), 'card-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(transaction).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('returns 404 for a key whose prefix is not the current board key', async () => {
    const findByNumber = vi.fn(() => Promise.resolve(record));

    await expect(
      createCardService({ cards: fakeCards({ findByNumber }) }).getByKey(as('VIEWER'), {
        boardKey: 'XY',
        number: 12,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(findByNumber).not.toHaveBeenCalled();
  });

  it('maps a busy board to 503 BOARD_BUSY without retrying', async () => {
    const transaction = vi.fn(() => Promise.reject(new BoardBusyError()));
    const service = createCardService({ cards: fakeCards({ transaction }) });

    await expect(service.move(as('MEMBER'), 'card-1', { columnId: 'col-1' })).rejects.toMatchObject(
      { statusCode: 503, code: 'BOARD_BUSY' },
    );
    await expect(service.update(as('MEMBER'), 'card-1', { title: 'X' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'BOARD_BUSY',
    });
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
