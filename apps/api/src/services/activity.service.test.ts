import { activitySchema, encodePageCursor, type BoardRole } from '@streamline/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ActivityRepository } from '../repositories/activity.repository.js';
import { fakeActivityRecord } from '../test/activity.js';
import { createRecordingBoardEvents } from '../test/board-events.js';
import { publishActivity, toActivity } from './activity-publisher.js';
import { createActivityService } from './activity.service.js';
import type { BoardMembership } from './board-access.service.js';
import { toPage } from './pagination.js';

const as = (role: BoardRole): BoardMembership => ({ boardId: 'board-1', userId: 'u1', role });

const record = fakeActivityRecord({
  boardId: 'board-1',
  actorId: 'u1',
  cardId: 'card-1',
  content: {
    type: 'CARD_CREATED',
    payload: { card: { key: 'SL-1', title: 'Card' }, column: { id: 'c1', name: 'To Do' } },
  },
});

function fakeActivities(overrides: Partial<ActivityRepository> = {}): ActivityRepository {
  return {
    listForBoard: vi.fn(() => Promise.resolve([record])),
    listForCard: vi.fn(() => Promise.resolve([record])),
    cardExists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

describe('toPage', () => {
  const rows = [3, 2, 1].map((n) => ({ id: `r${String(n)}`, createdAt: new Date(n * 1000) }));

  it('returns the rows and no cursor when nothing is left', () => {
    expect(toPage(rows, 3)).toEqual({ items: rows, nextCursor: null });
  });

  it('cuts the extra row and points the cursor at the last returned row', () => {
    expect(toPage(rows, 2)).toEqual({
      items: rows.slice(0, 2),
      nextCursor: encodePageCursor({ id: 'r2', createdAt: new Date(2000) }),
    });
  });
});

describe('toActivity', () => {
  it('maps a row to the API shape', () => {
    const activity = toActivity(record);

    expect(activitySchema.parse(activity)).toEqual(activity);
    expect(activity).toMatchObject({ cardId: 'card-1', actor: { id: 'u1', name: 'Actor' } });
  });

  it('maps a deleted actor to null', () => {
    expect(toActivity({ ...record, actorId: null, actor: null }).actor).toBeNull();
  });
});

describe('publishActivity', () => {
  it('publishes the entry without an origin and ignores a missing entry', () => {
    const events = createRecordingBoardEvents();

    publishActivity(events, as('MEMBER'), null);
    publishActivity(events, as('MEMBER'), record);

    expect(events.events).toEqual([
      {
        name: 'activity:created',
        payload: { boardId: 'board-1', actorId: 'u1', activity: toActivity(record) },
        origin: undefined,
      },
    ]);
  });
});

describe('ActivityService', () => {
  it('lets every member read the feeds', async () => {
    const service = createActivityService({ activities: fakeActivities() });

    const page = await service.listForBoard(as('VIEWER'), { limit: 30 });
    expect(page).toEqual({ items: [toActivity(record)], nextCursor: null });
    await expect(service.listForCard(as('VIEWER'), 'card-1', { limit: 30 })).resolves.toEqual(page);
  });

  it('returns 404 for the feed of a card that is not in the board', async () => {
    const listForCard = vi.fn(() => Promise.resolve([record]));
    const service = createActivityService({
      activities: fakeActivities({ cardExists: () => Promise.resolve(false), listForCard }),
    });

    await expect(service.listForCard(as('OWNER'), 'gone', { limit: 30 })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(listForCard).not.toHaveBeenCalled();
  });
});
