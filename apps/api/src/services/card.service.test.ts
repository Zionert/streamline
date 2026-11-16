import { activitySchema, cardSchema, type BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../errors/app-error.js';
import { BoardBusyError } from '../repositories/board-transaction.js';
import type { CardRecord, CardRepository, CardStore } from '../repositories/card.repository.js';
import { fakeActivityRecord } from '../test/activity.js';
import { createRecordingBoardEvents } from '../test/board-events.js';
import type { BoardMembership } from './board-access.service.js';
import {
  changedCardFields,
  createCardService,
  formatDueDate,
  parseDueDate,
  toCard,
} from './card.service.js';

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
  labels: [{ labelId: 'label-2' }, { labelId: 'label-1' }],
};

function fakeCards(overrides: Partial<CardRepository> = {}): CardRepository {
  return {
    transaction: vi.fn(() => Promise.reject(new Error('unexpected transaction'))),
    findBoardKey: vi.fn(() => Promise.resolve('SL')),
    listBoard: vi.fn(() => Promise.resolve(null)),
    findById: vi.fn(() => Promise.resolve(record)),
    findByNumber: vi.fn(() => Promise.resolve(record)),
    ...overrides,
  };
}

/** A store for one transaction: the card `record` in column `col-1` of board `SL`. */
function fakeStore(overrides: Partial<CardStore> = {}): CardStore {
  const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected ${name}`));
  return {
    lockBoard: () => Promise.resolve(true),
    findBoardKey: () => Promise.resolve('SL'),
    lockCard: () =>
      Promise.resolve({
        id: record.id,
        columnId: record.columnId,
        rank: record.rank,
        number: record.number,
        title: record.title,
      }),
    findColumn: (_boardId, columnId) =>
      Promise.resolve({ id: columnId, title: 'To Do', wipLimit: null, wipStrict: false }),
    lockColumn: unexpected('lockColumn'),
    countInColumn: unexpected('countInColumn'),
    listInColumn: unexpected('listInColumn'),
    lockMembership: () => Promise.resolve(true),
    allocateNumber: unexpected('allocateNumber'),
    create: unexpected('create'),
    findById: () => Promise.resolve(record),
    updatePosition: unexpected('updatePosition'),
    update: () => Promise.resolve(record),
    touch: () => Promise.resolve(record),
    delete: () => Promise.resolve(true),
    setRanks: unexpected('setRanks'),
    recordTransition: unexpected('recordTransition'),
    lockLabel: (_boardId, labelId) => Promise.resolve({ id: labelId, name: 'Bug', color: 'RED' }),
    listLabelIds: () => Promise.resolve([]),
    attachLabel: () => Promise.resolve(),
    detachLabel: () => Promise.resolve(true),
    recordActivity: (data) => Promise.resolve(fakeActivityRecord(data)),
    ...overrides,
  };
}

/** A repository whose transactions run on `store`. */
function withStore(store: CardStore, overrides: Partial<CardRepository> = {}): CardRepository {
  return fakeCards({ transaction: (fn) => fn(store), ...overrides });
}

const as = (role: BoardRole): BoardMembership => ({ boardId: 'board-1', userId: 'u1', role });

describe('due dates', () => {
  it('round-trips a calendar date through the UTC-midnight representation', () => {
    expect(parseDueDate('2027-02-28').toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(formatDueDate(parseDueDate('2027-12-31'))).toBe('2027-12-31');
  });
});

describe('toCard', () => {
  it('maps a record to the API shape with a derived key and its label ids in order', () => {
    const card = toCard(record, 'SL');

    expect(cardSchema.parse(card)).toEqual(card);
    expect(card).toMatchObject({
      key: 'SL-12',
      dueDate: '2027-02-28',
      priority: 'HIGH',
      labelIds: ['label-2', 'label-1'],
    });
  });
});

describe('changedCardFields', () => {
  it('lists the fields whose value differs, in the API order', () => {
    const after: CardRecord = {
      ...record,
      dueDate: null,
      title: 'New',
      assigneeId: null,
      priority: 'LOW',
      description: 'Text',
    };

    expect(changedCardFields(record, after)).toEqual([
      'title',
      'description',
      'priority',
      'assigneeId',
      'dueDate',
    ]);
  });

  it('ignores fields written with the same value', () => {
    expect(
      changedCardFields(record, {
        ...record,
        dueDate: parseDueDate('2027-02-28'),
        updatedAt: new Date(),
      }),
    ).toEqual([]);
  });
});

describe('CardService', () => {
  it('re-checks the role even without the route guard', async () => {
    const transaction = vi.fn(() => Promise.reject(new Error('unexpected transaction')));
    const service = createCardService({ cards: fakeCards({ transaction }) });

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
    await expect(service.attachLabel(as('VIEWER'), 'card-1', 'l1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.detachLabel(as('VIEWER'), 'card-1', 'l1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(transaction).not.toHaveBeenCalled();
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
    const busy = { statusCode: 503, code: 'BOARD_BUSY' };

    await expect(service.move(as('MEMBER'), 'card-1', { columnId: 'col-1' })).rejects.toMatchObject(
      busy,
    );
    await expect(service.update(as('MEMBER'), 'card-1', { title: 'X' })).rejects.toMatchObject(
      busy,
    );
    await expect(service.delete(as('MEMBER'), 'card-1')).rejects.toMatchObject(busy);
    await expect(service.attachLabel(as('MEMBER'), 'card-1', 'l1')).rejects.toMatchObject(busy);
    expect(transaction).toHaveBeenCalledTimes(4);
  });

  it('refuses a label of another board with 404 LABEL_NOT_FOUND', async () => {
    const store = fakeStore({ lockLabel: () => Promise.resolve(null) });
    const service = createCardService({ cards: withStore(store) });

    await expect(service.attachLabel(as('MEMBER'), 'card-1', 'other')).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });
    await expect(service.detachLabel(as('MEMBER'), 'card-1', 'other')).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });
  });

  it('refuses an eleventh label with 409 CARD_LABEL_LIMIT_REACHED', async () => {
    const attachLabel = vi.fn(() => Promise.resolve());
    const store = fakeStore({
      listLabelIds: () => Promise.resolve(Array.from({ length: 10 }, (_, i) => `l${String(i)}`)),
      attachLabel,
    });

    await expect(
      createCardService({ cards: withStore(store) }).attachLabel(as('MEMBER'), 'card-1', 'new'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CARD_LABEL_LIMIT_REACHED' });
    expect(attachLabel).not.toHaveBeenCalled();
  });
});

describe('CardService events', () => {
  it('broadcasts card:updated with the card and the origin, then the activity entry', async () => {
    const events = createRecordingBoardEvents();
    const store = fakeStore({ update: () => Promise.resolve({ ...record, title: 'X' }) });
    const service = createCardService({ cards: withStore(store), events });

    const card = await service.update(as('MEMBER'), 'card-1', { title: 'X' }, { socketId: 's1' });

    const [updated, activity] = events.events;
    expect(updated).toEqual({
      name: 'card:updated',
      payload: { boardId: 'board-1', actorId: 'u1', card },
      origin: { socketId: 's1' },
    });
    if (activity?.name !== 'activity:created') throw new Error('expected an activity entry');
    // The activity entry is never echo-suppressed: it is published without an origin.
    expect(activity.origin).toBeUndefined();
    expect(activitySchema.parse(activity.payload.activity)).toMatchObject({
      type: 'CARD_UPDATED',
      cardId: 'card-1',
      payload: {
        card: { key: 'SL-12', title: 'X' },
        fields: ['title'],
        title: { from: 'Write tests', to: 'X' },
      },
    });
    expect(events.events).toHaveLength(2);
  });

  it('records no activity for an update that changes nothing', async () => {
    const events = createRecordingBoardEvents();
    const recordActivity = vi.fn((data: Parameters<CardStore['recordActivity']>[0]) =>
      Promise.resolve(fakeActivityRecord(data)),
    );
    const service = createCardService({
      cards: withStore(fakeStore({ recordActivity })),
      events,
    });

    await service.update(as('MEMBER'), 'card-1', { title: record.title });

    expect(recordActivity).not.toHaveBeenCalled();
    expect(events.events.map((event) => event.name)).toEqual(['card:updated']);
  });

  it('broadcasts card:deleted with the card id, then the activity entry', async () => {
    const events = createRecordingBoardEvents();
    const service = createCardService({ cards: withStore(fakeStore()), events });

    await service.delete(as('MEMBER'), 'card-1');

    expect(events.events[0]).toEqual({
      name: 'card:deleted',
      payload: { boardId: 'board-1', actorId: 'u1', cardId: 'card-1' },
      origin: undefined,
    });
    const activity = events.events[1];
    if (activity?.name !== 'activity:created') throw new Error('expected an activity entry');
    expect(activity.payload.activity).toMatchObject({
      type: 'CARD_DELETED',
      payload: {
        card: { key: 'SL-12', title: 'Write tests' },
        column: { id: 'col-1', name: 'To Do' },
      },
    });
  });

  it('broadcasts a label change as card:updated, and nothing for a no-op', async () => {
    const events = createRecordingBoardEvents();
    const attached = fakeStore({ listLabelIds: () => Promise.resolve(['label-9']) });
    const service = createCardService({ cards: withStore(attached), events });

    await service.attachLabel(as('MEMBER'), 'card-1', 'label-9');
    expect(events.events).toEqual([]);

    await service.attachLabel(as('MEMBER'), 'card-1', 'label-3', { socketId: 's1' });
    expect(events.events.map((event) => [event.name, event.origin])).toEqual([
      ['card:updated', { socketId: 's1' }],
      ['activity:created', undefined],
    ]);
  });

  it('broadcasts nothing when the change fails', async () => {
    const events = createRecordingBoardEvents();
    const service = createCardService({
      cards: withStore(fakeStore({ lockCard: () => Promise.resolve(null) })),
      events,
    });

    await expect(service.delete(as('MEMBER'), 'card-1')).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(service.update(as('MEMBER'), 'card-1', { title: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(service.delete(as('VIEWER'), 'card-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(events.events).toEqual([]);
  });
});
