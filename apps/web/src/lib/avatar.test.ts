import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@/test/contrast';

import {
  AVATAR_PALETTE,
  AVATAR_TEXT_COLOR,
  getInitials,
  paletteColorFor,
  splitVisible,
} from './avatar';

describe('getInitials', () => {
  it('takes the first letters of the first and last word', () => {
    expect(getInitials('Jan Kowalski')).toBe('JK');
    expect(getInitials('  anna  maria   nowak ')).toBe('AN');
  });

  it('uses one letter for a single word and "?" for an empty name', () => {
    expect(getInitials('nazar')).toBe('N');
    expect(getInitials('   ')).toBe('?');
  });

  it('keeps non-Latin letters whole', () => {
    expect(getInitials('Łukasz Żak')).toBe('ŁŻ');
  });
});

describe('paletteColorFor', () => {
  it('always returns the same palette colour for the same id', () => {
    const color = paletteColorFor('user-1');
    expect(AVATAR_PALETTE).toContain(color);
    expect(paletteColorFor('user-1')).toBe(color);
  });

  it('spreads different ids over the palette', () => {
    const colors = new Set(
      Array.from({ length: 64 }, (_, index) => paletteColorFor(`id-${index}`)),
    );
    expect(colors.size).toBeGreaterThanOrEqual(6);
  });

  it('has the eight pastel colours of the design', () => {
    expect(AVATAR_PALETTE).toEqual([
      '#F2A93B',
      '#7CC4FA',
      '#B6A2F5',
      '#86D9A8',
      '#F28FB1',
      '#F5D06B',
      '#8DD3D8',
      '#C9B79C',
    ]);
  });

  it('keeps the dark initials readable (WCAG AA) on every colour', () => {
    expect(AVATAR_TEXT_COLOR).toBe('#0F1012');
    for (const color of AVATAR_PALETTE) {
      expect(contrastRatio(color, AVATAR_TEXT_COLOR)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('splitVisible', () => {
  it('returns all items when they fit', () => {
    expect(splitVisible(['a', 'b'], 4)).toEqual({ visible: ['a', 'b'], hidden: 0 });
  });

  it('counts the items beyond the maximum', () => {
    expect(splitVisible(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toEqual({
      visible: ['a', 'b', 'c', 'd'],
      hidden: 2,
    });
  });
});
