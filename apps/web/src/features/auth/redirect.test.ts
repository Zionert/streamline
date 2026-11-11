import { describe, expect, it } from 'vitest';

import { getRedirectTarget } from './redirect';

describe('getRedirectTarget', () => {
  it('returns the remembered location with search and hash', () => {
    expect(
      getRedirectTarget({ from: { pathname: '/boards/1', search: '?tab=x', hash: '#c' } }),
    ).toBe('/boards/1?tab=x#c');
  });

  it.each([
    ['no state', undefined],
    ['null state', null],
    ['missing from', {}],
    ['non-string pathname', { from: { pathname: 42 } }],
    ['relative path', { from: { pathname: 'boards' } }],
    ['protocol-relative URL', { from: { pathname: '//evil.example' } }],
    ['backslash protocol-relative URL', { from: { pathname: '/\\evil.example' } }],
    ['login page', { from: { pathname: '/login' } }],
    ['register page', { from: { pathname: '/register' } }],
  ])('falls back to home for %s', (_name, state) => {
    expect(getRedirectTarget(state)).toBe('/');
  });
});
