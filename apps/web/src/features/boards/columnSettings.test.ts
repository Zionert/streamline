import { updateColumnSettingsSchema } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { columnWith } from '@/test/fixtures';

import { buildSettingsChanges } from './columnSettings';

const column = columnWith({ id: 'c1', rank: 'a', category: 'TODO', wipLimit: 3, wipStrict: false });

describe('buildSettingsChanges', () => {
  it('returns nothing when the values are unchanged', () => {
    expect(
      buildSettingsChanges(column, { category: 'TODO', wipLimit: '3', wipStrict: false }),
    ).toEqual({});
  });

  it('returns only the changed fields', () => {
    expect(
      buildSettingsChanges(column, { category: 'DONE', wipLimit: ' 3 ', wipStrict: true }),
    ).toEqual({ category: 'DONE', wipStrict: true });
  });

  it('turns an empty WIP limit into null (no limit)', () => {
    expect(
      buildSettingsChanges(column, { category: 'TODO', wipLimit: '  ', wipStrict: false }),
    ).toEqual({ wipLimit: null });
  });

  it('keeps an invalid WIP limit for the shared schema to reject', () => {
    const changes = buildSettingsChanges(column, {
      category: 'TODO',
      wipLimit: '2.5',
      wipStrict: false,
    });
    expect(changes).toEqual({ wipLimit: 2.5 });
    expect(updateColumnSettingsSchema.safeParse(changes).success).toBe(false);
    expect(
      updateColumnSettingsSchema.safeParse(
        buildSettingsChanges(column, { category: 'TODO', wipLimit: 'abc', wipStrict: false }),
      ).success,
    ).toBe(false);
  });
});
