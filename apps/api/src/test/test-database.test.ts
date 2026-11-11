import { describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from './test-database.js';

describe('resolveTestDatabaseUrl', () => {
  it('uses DATABASE_URL_TEST when set', () => {
    const url = 'postgresql://u:p@localhost:5432/streamline_test?schema=public';

    expect(resolveTestDatabaseUrl({ DATABASE_URL_TEST: url })).toBe(url);
  });

  it('refuses a database whose name does not end with _test', () => {
    expect(() =>
      resolveTestDatabaseUrl({ DATABASE_URL_TEST: 'postgresql://u:p@localhost:5432/streamline' }),
    ).toThrow(/Refusing/);
  });
});
