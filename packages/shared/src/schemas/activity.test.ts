import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_PAGE_DEFAULT_LIMIT,
  ACTIVITY_PAGE_MAX_LIMIT,
  ACTIVITY_TYPES,
  activityContentSchema,
  activityListQuerySchema,
  activityListResponseSchema,
  activityPayloadSchemas,
  activitySchema,
  type ActivityContent,
} from './activity.js';

const card = { key: 'SL-12', title: 'Write tests' };
const column = { id: 'col-1', name: 'To Do' };
const label = { id: 'label-1', name: 'Bug', color: 'RED' } as const;
const member = { id: 'u2', name: 'Bob' };

/** One valid entry content per type. */
const EXAMPLES: Record<(typeof ACTIVITY_TYPES)[number], ActivityContent> = {
  CARD_CREATED: { type: 'CARD_CREATED', payload: { card, column } },
  CARD_UPDATED: {
    type: 'CARD_UPDATED',
    payload: { card, fields: ['title', 'priority'], title: { from: 'Old', to: 'Write tests' } },
  },
  CARD_MOVED: {
    type: 'CARD_MOVED',
    payload: { card, from: column, to: { id: 'col-2', name: 'Done' } },
  },
  CARD_DELETED: { type: 'CARD_DELETED', payload: { card, column } },
  CARD_LABEL_ADDED: { type: 'CARD_LABEL_ADDED', payload: { card, label } },
  CARD_LABEL_REMOVED: { type: 'CARD_LABEL_REMOVED', payload: { card, label } },
  COMMENT_ADDED: { type: 'COMMENT_ADDED', payload: { card, commentId: 'comment-1' } },
  COLUMN_CREATED: { type: 'COLUMN_CREATED', payload: { column } },
  COLUMN_RENAMED: {
    type: 'COLUMN_RENAMED',
    payload: { column, name: { from: 'Todo', to: 'To Do' } },
  },
  COLUMN_MOVED: { type: 'COLUMN_MOVED', payload: { column } },
  COLUMN_SETTINGS_CHANGED: {
    type: 'COLUMN_SETTINGS_CHANGED',
    payload: {
      column,
      changes: { wipLimit: { from: null, to: 3 }, wipStrict: { from: false, to: true } },
    },
  },
  COLUMN_DELETED: { type: 'COLUMN_DELETED', payload: { column } },
  MEMBER_ADDED: { type: 'MEMBER_ADDED', payload: { member, role: 'MEMBER' } },
  MEMBER_ROLE_CHANGED: {
    type: 'MEMBER_ROLE_CHANGED',
    payload: { member, role: { from: 'MEMBER', to: 'ADMIN' } },
  },
  MEMBER_REMOVED: { type: 'MEMBER_REMOVED', payload: { member, role: 'VIEWER' } },
  MEMBER_LEFT: { type: 'MEMBER_LEFT', payload: { member, role: 'ADMIN' } },
};

const base = {
  id: 'activity-1',
  boardId: 'board-1',
  cardId: 'card-1',
  actor: { id: 'u1', name: 'Ann' },
  createdAt: '2026-11-15T10:00:00.000Z',
};

describe('activity types', () => {
  it('has a payload schema for every type', () => {
    expect(Object.keys(activityPayloadSchemas).sort()).toEqual([...ACTIVITY_TYPES].sort());
    expect(Object.keys(EXAMPLES).sort()).toEqual([...ACTIVITY_TYPES].sort());
  });
});

describe('activityContentSchema', () => {
  it.each(ACTIVITY_TYPES)('accepts a %s entry', (type) => {
    expect(activityContentSchema.parse(EXAMPLES[type])).toEqual(EXAMPLES[type]);
  });

  it('rejects an unknown type', () => {
    expect(activityContentSchema.safeParse({ type: 'BOARD_EXPLODED', payload: {} }).success).toBe(
      false,
    );
  });

  it('rejects a payload of another type', () => {
    expect(
      activityContentSchema.safeParse({ type: 'CARD_MOVED', payload: { card, column } }).success,
    ).toBe(false);
  });

  it.each([
    { type: 'CARD_UPDATED', payload: { card, fields: [] } },
    { type: 'CARD_UPDATED', payload: { card, fields: ['rank'] } },
    { type: 'COLUMN_SETTINGS_CHANGED', payload: { column, changes: {} } },
    {
      type: 'COLUMN_SETTINGS_CHANGED',
      payload: { column, changes: { wipLimit: { from: 0, to: 2 } } },
    },
    { type: 'MEMBER_ADDED', payload: { member, role: 'GUEST' } },
    { type: 'CARD_LABEL_ADDED', payload: { card, label: { ...label, color: 'black' } } },
    { type: 'CARD_CREATED', payload: { card: { key: 'SL-1' }, column } },
  ])('rejects an invalid payload %j', (content) => {
    expect(activityContentSchema.safeParse(content).success).toBe(false);
  });
});

describe('activitySchema', () => {
  it('combines the common fields with the typed content', () => {
    const entry = { ...base, ...EXAMPLES.CARD_MOVED };

    expect(activitySchema.parse(entry)).toEqual(entry);
  });

  it('accepts entries without a card or an actor', () => {
    const entry = { ...base, cardId: null, actor: null, ...EXAMPLES.MEMBER_LEFT };

    expect(activitySchema.parse(entry)).toEqual(entry);
  });

  it.each([{ actor: { id: 'u1' } }, { createdAt: 'yesterday' }, { cardId: undefined }, { id: 1 }])(
    'rejects an entry with %j',
    (patch) => {
      expect(
        activitySchema.safeParse({ ...base, ...EXAMPLES.COLUMN_MOVED, ...patch }).success,
      ).toBe(false);
    },
  );

  it('rejects an entry without content', () => {
    expect(activitySchema.safeParse(base).success).toBe(false);
  });
});

describe('activity list schemas', () => {
  it('defaults to 30 entries per page and caps at 100', () => {
    expect(activityListQuerySchema.parse({})).toEqual({ limit: ACTIVITY_PAGE_DEFAULT_LIMIT });
    expect(activityListQuerySchema.parse({ limit: '100' }).limit).toBe(ACTIVITY_PAGE_MAX_LIMIT);
    expect(activityListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('accepts a page of entries', () => {
    const page = { activities: [{ ...base, ...EXAMPLES.COMMENT_ADDED }], nextCursor: null };

    expect(activityListResponseSchema.parse(page)).toEqual(page);
  });
});
