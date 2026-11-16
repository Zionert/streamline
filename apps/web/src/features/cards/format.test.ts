import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './format';

const now = new Date('2026-11-15T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('formatRelativeTime', () => {
  it('describes recent moments relative to now', () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe('just now');
    expect(formatRelativeTime(ago(-5_000), now)).toBe('just now');
    expect(formatRelativeTime(ago(60_000), now)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(26 * 3_600_000), now)).toBe('yesterday');
    expect(formatRelativeTime(ago(3 * 86_400_000), now)).toBe('3 days ago');
  });

  it('shows a date from a week ago on', () => {
    expect(formatRelativeTime('2026-11-01T12:00:00.000Z', now)).toMatch(/^1 Nov 2026$/);
  });
});
