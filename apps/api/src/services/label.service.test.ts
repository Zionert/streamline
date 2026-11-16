import { labelSchema, type BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../errors/app-error.js';
import { BoardBusyError } from '../repositories/board-transaction.js';
import {
  LabelNameTakenError,
  type LabelRecord,
  type LabelRepository,
  type LabelStore,
} from '../repositories/label.repository.js';
import { createRecordingBoardEvents } from '../test/board-events.js';
import type { BoardMembership } from './board-access.service.js';
import { createLabelService, toLabel } from './label.service.js';

const now = new Date('2026-11-15T10:00:00.000Z');

const record: LabelRecord = {
  id: 'label-1',
  boardId: 'board-1',
  name: 'Bug',
  color: 'RED',
  createdAt: now,
  updatedAt: now,
};

const as = (role: BoardRole): BoardMembership => ({ boardId: 'board-1', userId: 'u1', role });

function fakeStore(overrides: Partial<LabelStore> = {}): LabelStore {
  return {
    lockBoard: () => Promise.resolve(true),
    countForBoard: () => Promise.resolve(0),
    create: (data) => Promise.resolve({ ...record, ...data }),
    lockLabel: () => Promise.resolve(record),
    update: (_boardId, _labelId, data) =>
      Promise.resolve({ ...record, ...(data.name && { name: data.name }) }),
    delete: () => Promise.resolve(true),
    ...overrides,
  };
}

function fakeLabels(
  store: LabelStore = fakeStore(),
  overrides: Partial<LabelRepository> = {},
): LabelRepository {
  return {
    transaction: (fn) => fn(store),
    listForBoard: () => Promise.resolve([record]),
    ...overrides,
  };
}

describe('LabelService', () => {
  it('maps records to the API shape', () => {
    expect(labelSchema.parse(toLabel(record))).toEqual(toLabel(record));
  });

  it('re-checks the role even without the route guard', async () => {
    const transaction = vi.fn(() => Promise.reject(new Error('unexpected transaction')));
    const service = createLabelService({ labels: fakeLabels(fakeStore(), { transaction }) });

    await expect(service.create(as('VIEWER'), { name: 'X', color: 'RED' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.update(as('VIEWER'), 'label-1', { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.delete(as('VIEWER'), 'label-1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.list(as('VIEWER'))).resolves.toHaveLength(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps a duplicate name to 409 LABEL_NAME_TAKEN and a busy board to 503', async () => {
    const taken = createLabelService({
      labels: fakeLabels(fakeStore(), {
        transaction: () => Promise.reject(new LabelNameTakenError()),
      }),
    });
    const busy = createLabelService({
      labels: fakeLabels(fakeStore(), { transaction: () => Promise.reject(new BoardBusyError()) }),
    });

    await expect(taken.create(as('MEMBER'), { name: 'Bug', color: 'RED' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LABEL_NAME_TAKEN',
    });
    await expect(taken.update(as('MEMBER'), 'label-1', { name: 'Bug' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LABEL_NAME_TAKEN',
    });
    await expect(busy.delete(as('MEMBER'), 'label-1')).rejects.toMatchObject({
      statusCode: 503,
      code: 'BOARD_BUSY',
    });
  });

  it('creates under the exclusive board lock and checks the limit', async () => {
    const lockBoard = vi.fn(() => Promise.resolve(true));
    const full = createLabelService({
      labels: fakeLabels(fakeStore({ lockBoard, countForBoard: () => Promise.resolve(50) })),
    });

    await expect(full.create(as('MEMBER'), { name: 'X', color: 'RED' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LABEL_LIMIT_REACHED',
    });
    expect(lockBoard).toHaveBeenCalledWith('board-1', 'exclusive');
  });

  it('broadcasts committed changes with the origin', async () => {
    const events = createRecordingBoardEvents();
    const service = createLabelService({ labels: fakeLabels(), events });
    const origin = { socketId: 's1' };
    const meta = { boardId: 'board-1', actorId: 'u1' };

    const created = await service.create(as('MEMBER'), { name: 'New', color: 'LIME' }, origin);
    const updated = await service.update(as('MEMBER'), 'label-1', { name: 'Renamed' }, origin);
    await service.delete(as('MEMBER'), 'label-1', origin);

    expect(events.events).toEqual([
      { name: 'label:created', payload: { ...meta, label: created }, origin },
      { name: 'label:updated', payload: { ...meta, label: updated }, origin },
      { name: 'label:deleted', payload: { ...meta, labelId: 'label-1' }, origin },
    ]);
  });

  it('returns 404 LABEL_NOT_FOUND and broadcasts nothing for a missing label', async () => {
    const events = createRecordingBoardEvents();
    const service = createLabelService({
      labels: fakeLabels(
        fakeStore({
          lockLabel: () => Promise.resolve(null),
          update: () => Promise.resolve(null),
          delete: () => Promise.resolve(false),
        }),
      ),
      events,
    });
    const notFound = { statusCode: 404, code: 'LABEL_NOT_FOUND' };

    await expect(service.update(as('MEMBER'), 'x', { color: 'RED' })).rejects.toMatchObject(
      notFound,
    );
    await expect(service.delete(as('MEMBER'), 'x')).rejects.toMatchObject(notFound);
    expect(events.events).toEqual([]);
  });

  it('skips the write and the event when the name and color are unchanged', async () => {
    const events = createRecordingBoardEvents();
    const update = vi.fn(() => Promise.resolve({ ...record, updatedAt: new Date() }));
    const service = createLabelService({ labels: fakeLabels(fakeStore({ update })), events });

    const same = await service.update(as('MEMBER'), 'label-1', { name: 'Bug', color: 'RED' });
    const sameColor = await service.update(as('MEMBER'), 'label-1', { color: 'RED' });

    expect(same).toEqual(toLabel(record));
    expect(sameColor).toEqual(toLabel(record));
    expect(update).not.toHaveBeenCalled();
    expect(events.events).toEqual([]);
  });

  it('writes a change of letter case only', async () => {
    const events = createRecordingBoardEvents();
    const update = vi.fn(() => Promise.resolve({ ...record, name: 'BUG' }));
    const service = createLabelService({ labels: fakeLabels(fakeStore({ update })), events });

    const updated = await service.update(as('MEMBER'), 'label-1', { name: 'BUG' });

    expect(update).toHaveBeenCalledOnce();
    expect(updated.name).toBe('BUG');
    expect(events.events.map((event) => event.name)).toEqual(['label:updated']);
  });
});
