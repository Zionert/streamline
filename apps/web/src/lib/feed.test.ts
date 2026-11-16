import { describe, expect, it } from 'vitest';

import { mergeFeed, removeFromFeed } from './feed';

const entry = (id: string, createdAt: string, version = 1) => ({ id, createdAt, version });

const a = entry('a', '2026-11-15T10:00:00.000Z');
const b = entry('b', '2026-11-15T10:01:00.000Z');
const c = entry('c', '2026-11-15T10:01:00.000Z');
const d = entry('d', '2026-11-15T10:02:00.000Z');

describe('mergeFeed', () => {
  it('orders entries by time, then by id, in both directions', () => {
    expect(mergeFeed([], [d, c, a, b], 'oldest-first').map((e) => e.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(mergeFeed([], [a, d, b, c], 'newest-first').map((e) => e.id)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
  });

  it('never duplicates an entry and is idempotent', () => {
    const once = mergeFeed([a, b], [b, d], 'oldest-first');
    expect(once.map((e) => e.id)).toEqual(['a', 'b', 'd']);
    expect(mergeFeed(once, [b, d], 'oldest-first')).toEqual(once);
  });

  it('replaces a known entry unless the shown version is newer', () => {
    const newer = { ...b, version: 2 };
    expect(mergeFeed([a, b], [newer], 'oldest-first')[1]).toBe(newer);
    const keepNewer = (shown: typeof a, received: typeof a) => shown.version > received.version;
    expect(mergeFeed([a, newer], [b], 'oldest-first', keepNewer)[1]).toBe(newer);
  });
});

describe('removeFromFeed', () => {
  it('removes the entry and keeps the list when it is missing', () => {
    const items = [a, b];
    expect(removeFromFeed(items, 'a')).toEqual([b]);
    expect(removeFromFeed(items, 'x')).toBe(items);
  });
});
