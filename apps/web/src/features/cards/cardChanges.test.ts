import { describe, expect, it } from 'vitest';

import { cardWith } from '@/test/fixtures';

import { getCardChanges } from './cardChanges';

const card = cardWith({
  id: 'c1',
  number: 1,
  columnId: 'A',
  rank: 'b',
  title: 'Fix login',
  description: 'Steps',
  assigneeId: 'u1',
});

describe('getCardChanges', () => {
  it('keeps only the changed, validated fields', () => {
    expect(getCardChanges(card, { title: '  New title ' })).toEqual({
      ok: true,
      changes: { title: 'New title' },
    });
    expect(getCardChanges(card, { assigneeId: null, priority: 'HIGH' })).toEqual({
      ok: true,
      changes: { assigneeId: null, priority: 'HIGH' },
    });
  });

  it('reports no changes for equal values (after trimming)', () => {
    expect(getCardChanges(card, { title: ' Fix login ' })).toEqual({ ok: true, changes: null });
    expect(getCardChanges(card, { assigneeId: 'u1', dueDate: null })).toEqual({
      ok: true,
      changes: null,
    });
  });

  it('turns an empty description into null', () => {
    expect(getCardChanges(card, { description: '   ' })).toEqual({
      ok: true,
      changes: { description: null },
    });
  });

  it('returns the schema message for invalid values', () => {
    expect(getCardChanges(card, { title: '  ' })).toEqual({
      ok: false,
      error: 'Card title is required',
    });
    expect(getCardChanges(card, { dueDate: '2026-02-31' })).toMatchObject({ ok: false });
  });
});
