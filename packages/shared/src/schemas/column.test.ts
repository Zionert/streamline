import { describe, expect, it } from 'vitest';

import {
  COLUMN_CATEGORIES,
  COLUMN_ERROR_CODES,
  COLUMN_TITLE_MAX_LENGTH,
  COLUMN_WIP_LIMIT_MAX,
  columnCategorySchema,
  columnListResponseSchema,
  columnSchema,
  columnTitleSchema,
  createColumnSchema,
  DEFAULT_BOARD_COLUMNS,
  moveColumnSchema,
  renameColumnSchema,
  updateColumnSettingsSchema,
} from './column.js';

const validColumn = {
  id: 'col-1',
  boardId: 'board-1',
  title: 'To Do',
  rank: 'U',
  category: 'TODO',
  wipLimit: null,
  wipStrict: false,
  createdAt: '2026-11-11T10:00:00.000Z',
  updatedAt: '2026-11-11T10:00:00.000Z',
};

describe('columnCategorySchema', () => {
  it.each(COLUMN_CATEGORIES)('accepts %s', (category) => {
    expect(columnCategorySchema.parse(category)).toBe(category);
  });

  it.each(['done', 'REVIEW', ''])('rejects %j', (category) => {
    expect(columnCategorySchema.safeParse(category).success).toBe(false);
  });
});

describe('columnTitleSchema', () => {
  it('trims the title', () => {
    expect(columnTitleSchema.parse('  Review  ')).toBe('Review');
  });

  it.each(['', '   '])('rejects a blank title %j', (title) => {
    expect(columnTitleSchema.safeParse(title).success).toBe(false);
  });

  it('accepts exactly the maximum length and measures it after trimming', () => {
    expect(columnTitleSchema.safeParse('a'.repeat(COLUMN_TITLE_MAX_LENGTH)).success).toBe(true);
    expect(columnTitleSchema.safeParse(` ${'a'.repeat(COLUMN_TITLE_MAX_LENGTH)} `).success).toBe(
      true,
    );
  });

  it('rejects a title longer than the maximum', () => {
    expect(columnTitleSchema.safeParse('a'.repeat(COLUMN_TITLE_MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });
});

describe('createColumnSchema', () => {
  it('accepts a title alone (append at the end)', () => {
    expect(createColumnSchema.parse({ title: ' Review ' })).toEqual({ title: 'Review' });
  });

  it('accepts neighbour ids and null open ends', () => {
    expect(createColumnSchema.parse({ title: 'R', afterId: 'a', beforeId: 'b' })).toEqual({
      title: 'R',
      afterId: 'a',
      beforeId: 'b',
    });
    expect(createColumnSchema.parse({ title: 'R', afterId: null }).afterId).toBeNull();
  });

  it('rejects a rank sent by the client and other unknown keys', () => {
    expect(createColumnSchema.safeParse({ title: 'R', rank: 'U' }).success).toBe(false);
    expect(createColumnSchema.safeParse({ title: 'R', category: 'DONE' }).success).toBe(false);
  });

  it('rejects the same column as both neighbours', () => {
    expect(createColumnSchema.safeParse({ title: 'R', afterId: 'a', beforeId: 'a' }).success).toBe(
      false,
    );
  });

  it.each([{}, { title: '' }, { title: 'R', afterId: '' }, { title: 'R', beforeId: 5 }])(
    'rejects %j',
    (body) => {
      expect(createColumnSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('renameColumnSchema', () => {
  it('requires a title and rejects unknown keys', () => {
    expect(renameColumnSchema.parse({ title: ' Doing ' })).toEqual({ title: 'Doing' });
    expect(renameColumnSchema.safeParse({}).success).toBe(false);
    expect(renameColumnSchema.safeParse({ title: 'Doing', rank: 'a' }).success).toBe(false);
  });
});

describe('moveColumnSchema', () => {
  it.each([
    { afterId: 'a' },
    { beforeId: 'b' },
    { afterId: 'a', beforeId: 'b' },
    { afterId: null },
    { beforeId: null },
    { afterId: null, beforeId: 'b' },
  ])('accepts %j', (body) => {
    expect(moveColumnSchema.parse(body)).toEqual(body);
  });

  it.each([
    {},
    { afterId: undefined },
    { afterId: 'a', beforeId: 'a' },
    { afterId: 'a', rank: 'U' },
    { afterId: '' },
    { afterId: 1 },
  ])('rejects %j', (body) => {
    expect(moveColumnSchema.safeParse(body).success).toBe(false);
  });
});

describe('updateColumnSettingsSchema', () => {
  it.each([
    { category: 'DONE' },
    { wipLimit: 1 },
    { wipLimit: COLUMN_WIP_LIMIT_MAX },
    { wipLimit: null },
    { wipStrict: true },
    { category: 'IN_PROGRESS', wipLimit: 3, wipStrict: false },
  ])('accepts %j', (body) => {
    expect(updateColumnSettingsSchema.parse(body)).toEqual(body);
  });

  it.each([
    {},
    { wipLimit: 0 },
    { wipLimit: COLUMN_WIP_LIMIT_MAX + 1 },
    { wipLimit: 2.5 },
    { wipLimit: '3' },
    { category: 'REVIEW' },
    { wipStrict: 'yes' },
    { title: 'Done' },
    { category: 'DONE', rank: 'U' },
  ])('rejects %j', (body) => {
    expect(updateColumnSettingsSchema.safeParse(body).success).toBe(false);
  });
});

describe('columnSchema', () => {
  it('accepts a column response', () => {
    expect(columnSchema.parse(validColumn)).toEqual(validColumn);
    expect(columnListResponseSchema.parse({ columns: [validColumn] }).columns).toHaveLength(1);
  });

  it('rejects an invalid rank', () => {
    expect(columnSchema.safeParse({ ...validColumn, rank: 'U0' }).success).toBe(false);
  });
});

describe('DEFAULT_BOARD_COLUMNS', () => {
  it('covers every category once, in workflow order', () => {
    expect(DEFAULT_BOARD_COLUMNS.map((column) => column.category)).toEqual(COLUMN_CATEGORIES);
  });
});

describe('COLUMN_ERROR_CODES', () => {
  it('uses the key as the code', () => {
    for (const [key, value] of Object.entries(COLUMN_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});
