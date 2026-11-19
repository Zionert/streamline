import { describe, expect, it } from 'vitest';

import { linkTarget } from './linkTarget';

describe('linkTarget', () => {
  it.each(['https://example.com/a?b=1', 'http://example.com', 'mailto:team@example.com'])(
    'opens %s as an external link',
    (href) => {
      expect(linkTarget(href)).toEqual({ kind: 'external', href });
    },
  );

  it('keeps a path of this app in the router', () => {
    expect(linkTarget('/boards/b1')).toEqual({ kind: 'app', path: '/boards/b1' });
  });

  it.each([
    undefined,
    '',
    '//evil.example',
    '/\\evil.example',
    '/%5cevil.example',
    '/%2F%2Fevil.example',
    'https:\\\\evil.example',
    'https://evil.example\\@x',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://x',
    'relative/path',
    '#anchor',
  ])('shows %s as plain text', (href) => {
    expect(linkTarget(href)).toBeNull();
  });
});
