import { describe, expect, it } from 'vitest';

import {
  CARD_DESCRIPTION_MAX_LENGTH,
  CARD_ERROR_CODES,
  CARD_NUMBER_MAX,
  CARD_PRIORITIES,
  CARD_TITLE_MAX_LENGTH,
  cardDescriptionSchema,
  cardKeySchema,
  cardListResponseSchema,
  cardPrioritySchema,
  cardResponseSchema,
  cardSchema,
  createCardSchema,
  formatCardKey,
  moveCardSchema,
  updateCardSchema,
} from './card.js';

const validCard = {
  id: 'card-1',
  key: 'SL-12',
  number: 12,
  boardId: 'board-1',
  columnId: 'col-1',
  title: 'Write tests',
  description: null,
  rank: 'U',
  priority: 'MEDIUM',
  assigneeId: null,
  dueDate: '2027-01-31',
  createdAt: '2026-11-11T10:00:00.000Z',
  updatedAt: '2026-11-11T10:00:00.000Z',
};

describe('cardPrioritySchema', () => {
  it.each(CARD_PRIORITIES)('accepts %s', (priority) => {
    expect(cardPrioritySchema.parse(priority)).toBe(priority);
  });

  it.each(['low', 'CRITICAL', ''])('rejects %j', (priority) => {
    expect(cardPrioritySchema.safeParse(priority).success).toBe(false);
  });
});

describe('cardKeySchema', () => {
  it.each([
    ['SL-1', 'SL', 1],
    ['ABCDE-12', 'ABCDE', 12],
    ['RO-2147483647', 'RO', CARD_NUMBER_MAX],
  ])('parses %s', (key, boardKey, number) => {
    expect(cardKeySchema.parse(key)).toEqual({ boardKey, number });
  });

  it.each([
    'SL-0',
    'SL-01',
    'sl-1',
    'S-1',
    'ABCDEF-1',
    'SL1',
    'SL-',
    'SL-1a',
    ' SL-1',
    'SL--1',
    'SL-2147483648',
    'SL-99999999999999999999',
    'clxyz123',
  ])('rejects %j', (key) => {
    expect(cardKeySchema.safeParse(key).success).toBe(false);
  });

  it('round-trips with formatCardKey', () => {
    expect(cardKeySchema.parse(formatCardKey('SL', 42))).toEqual({ boardKey: 'SL', number: 42 });
  });
});

describe('createCardSchema', () => {
  it('trims the title and keeps optional fields', () => {
    expect(
      createCardSchema.parse({
        columnId: 'c1',
        title: '  Fix login  ',
        priority: 'HIGH',
        assigneeId: 'u1',
        dueDate: '2027-02-28',
        description: 'Details',
      }),
    ).toEqual({
      columnId: 'c1',
      title: 'Fix login',
      priority: 'HIGH',
      assigneeId: 'u1',
      dueDate: '2027-02-28',
      description: 'Details',
    });
  });

  it('accepts a title of exactly the maximum length', () => {
    const title = 'a'.repeat(CARD_TITLE_MAX_LENGTH);
    expect(createCardSchema.parse({ columnId: 'c1', title }).title).toBe(title);
  });

  it.each([
    { title: 'No column' },
    { columnId: 'c1', title: '   ' },
    { columnId: 'c1', title: 'a'.repeat(CARD_TITLE_MAX_LENGTH + 1) },
    { columnId: 'c1', title: 'X', description: 'a'.repeat(CARD_DESCRIPTION_MAX_LENGTH + 1) },
    { columnId: 'c1', title: 'X', dueDate: '2027-02-30' },
    { columnId: 'c1', title: 'X', dueDate: '2027-02-01T00:00:00Z' },
    { columnId: 'c1', title: 'X', priority: 'NONE' },
    { columnId: 'c1', title: 'X', rank: 'U' },
    { columnId: 'c1', title: 'X', number: 3 },
    { columnId: '', title: 'X' },
  ])('rejects %j', (body) => {
    expect(createCardSchema.safeParse(body).success).toBe(false);
  });
});

describe('cardDescriptionSchema', () => {
  it('trims the description', () => {
    expect(cardDescriptionSchema.parse('  Details \n')).toBe('Details');
  });

  it.each(['', '   ', '\n\t'])('turns the blank description %j into null', (value) => {
    expect(cardDescriptionSchema.parse(value)).toBeNull();
  });

  it('applies the length limit after trimming', () => {
    const text = 'a'.repeat(CARD_DESCRIPTION_MAX_LENGTH);
    expect(cardDescriptionSchema.parse(`  ${text}  `)).toBe(text);
    expect(cardDescriptionSchema.safeParse(`${text}a`).success).toBe(false);
  });
});

describe('updateCardSchema', () => {
  it.each([
    { title: 'New' },
    { description: null },
    { assigneeId: null },
    { dueDate: null },
    { priority: 'URGENT' },
    { assigneeId: 'u2', dueDate: '2027-12-31' },
  ])('accepts %j', (body) => {
    expect(updateCardSchema.parse(body)).toEqual(body);
  });

  it.each([
    {},
    { columnId: 'c2' },
    { rank: 'U' },
    { title: null },
    { priority: null },
    { title: '' },
  ])('rejects %j', (body) => {
    expect(updateCardSchema.safeParse(body).success).toBe(false);
  });
});

describe('moveCardSchema', () => {
  it.each([
    { columnId: 'c1' },
    { columnId: 'c1', afterId: null },
    { columnId: 'c1', afterId: 'a', beforeId: 'b' },
    { columnId: 'c1', beforeId: null },
  ])('accepts %j', (body) => {
    expect(moveCardSchema.parse(body)).toEqual(body);
  });

  it.each([
    {},
    { afterId: 'a' },
    { columnId: 'c1', afterId: 'a', beforeId: 'a' },
    { columnId: 'c1', rank: 'U' },
    { columnId: 'c1', afterId: '' },
  ])('rejects %j', (body) => {
    expect(moveCardSchema.safeParse(body).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('accepts a card and a grouped card list', () => {
    expect(cardResponseSchema.parse({ card: validCard }).card).toEqual(validCard);
    expect(
      cardListResponseSchema.parse({
        columns: [
          { columnId: 'col-1', cards: [validCard] },
          { columnId: 'col-2', cards: [] },
        ],
      }).columns,
    ).toHaveLength(2);
  });

  it.each([
    { key: 'SL12' },
    { number: 0 },
    { rank: 'U0' },
    { dueDate: '2027-01-31T00:00:00.000Z' },
    { priority: 'NONE' },
  ])('rejects a card with %j', (patch) => {
    expect(cardSchema.safeParse({ ...validCard, ...patch }).success).toBe(false);
  });
});

describe('CARD_ERROR_CODES', () => {
  it('uses the key as the code', () => {
    for (const [key, value] of Object.entries(CARD_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});
