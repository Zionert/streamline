import { describe, expect, it } from 'vitest';

import { encodePageCursor, pageCursorSchema, pageQuerySchema } from './pagination.js';

const position = { createdAt: new Date('2026-11-15T10:00:00.123Z'), id: 'cm3abc123xyz' };

describe('page cursors', () => {
  it('round-trips a position through its string form', () => {
    const cursor = encodePageCursor(position);

    expect(cursor).toBe(`${String(position.createdAt.getTime())}_cm3abc123xyz`);
    expect(pageCursorSchema.parse(cursor)).toEqual(position);
  });

  it.each([
    '',
    'abc',
    '123',
    '_id',
    '123_',
    '12a_id',
    '123_id with space',
    '123_a_b',
    `1_${'a'.repeat(65)}`,
  ])('rejects %j', (cursor) => {
    expect(pageCursorSchema.safeParse(cursor).success).toBe(false);
  });

  it('rejects a timestamp outside the range of dates', () => {
    expect(pageCursorSchema.safeParse('9999999999999999_id').success).toBe(false);
  });
});

describe('pageQuerySchema', () => {
  const schema = pageQuerySchema(30, 100);

  it('applies the default limit and no cursor', () => {
    expect(schema.parse({})).toEqual({ limit: 30 });
  });

  it('coerces the limit from the query string and decodes the cursor', () => {
    expect(schema.parse({ limit: '5', cursor: encodePageCursor(position) })).toEqual({
      limit: 5,
      cursor: position,
    });
  });

  it('accepts the bounds', () => {
    expect(schema.parse({ limit: '1' }).limit).toBe(1);
    expect(schema.parse({ limit: '100' }).limit).toBe(100);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '2.5' },
    { limit: 'ten' },
    { limit: ['1', '2'] },
    { cursor: 'nope' },
  ])('rejects %j', (query) => {
    expect(schema.safeParse(query).success).toBe(false);
  });

  it('ignores unknown parameters', () => {
    expect(schema.parse({ limit: '2', other: 'x' })).toEqual({ limit: 2 });
  });
});
