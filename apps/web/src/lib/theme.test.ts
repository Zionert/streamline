import { afterEach, describe, expect, it, vi } from 'vitest';

import indexHtml from '../../index.html?raw';

import { initTheme, useThemeStore } from '@/stores/theme';
import { setMediaQuery } from '@/test/matchMedia';

import {
  DARK_SCHEME_QUERY,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
} from './theme';

const html = () => document.documentElement;

describe('theme helpers', () => {
  it('defaults to light when nothing valid is stored', () => {
    expect(readStoredTheme()).toBe('light');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readStoredTheme()).toBe('light');
  });

  it('reads back a stored choice', () => {
    storeTheme('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(readStoredTheme()).toBe('system');
  });

  it('falls back to the default when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(readStoredTheme()).toBe('light');
    expect(() => storeTheme('dark')).not.toThrow();
  });

  it('resolves the system preference through prefers-color-scheme', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('toggles the dark class on <html>', () => {
    applyTheme('dark');
    expect(html()).toHaveClass('dark');
    applyTheme('light');
    expect(html()).not.toHaveClass('dark');
  });
});

describe('theme store', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it('applies the stored choice on start', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    stop = initTheme();

    expect(html()).toHaveClass('dark');
    expect(useThemeStore.getState()).toMatchObject({ preference: 'dark', resolvedTheme: 'dark' });
  });

  it('stores a new preference and applies it immediately', () => {
    stop = initTheme();

    useThemeStore.getState().setPreference('dark');
    expect(html()).toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    useThemeStore.getState().setPreference('light');
    expect(html()).not.toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('follows the operating system while the preference is "system"', () => {
    setMediaQuery(DARK_SCHEME_QUERY, true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');

    stop = initTheme();
    expect(html()).toHaveClass('dark');

    setMediaQuery(DARK_SCHEME_QUERY, false);
    expect(html()).not.toHaveClass('dark');
    expect(useThemeStore.getState().resolvedTheme).toBe('light');

    setMediaQuery(DARK_SCHEME_QUERY, true);
    expect(html()).toHaveClass('dark');
  });

  it('ignores operating system changes for an explicit choice', () => {
    stop = initTheme();
    useThemeStore.getState().setPreference('light');

    setMediaQuery(DARK_SCHEME_QUERY, true);

    expect(html()).not.toHaveClass('dark');
    expect(useThemeStore.getState().resolvedTheme).toBe('light');
  });
});

describe('pre-render theme script in index.html', () => {
  // The inline script cannot import this module, so it repeats its constants.
  const script = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';

  it('uses the same storage key, preferences, default and media query', () => {
    expect(script).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    for (const preference of THEME_PREFERENCES) {
      expect(script).toContain(`stored === '${preference}'`);
    }
    expect(script).toContain("var preference = 'light';");
    expect(readStoredTheme()).toBe('light');
    expect(script).toContain(`matchMedia('${DARK_SCHEME_QUERY}')`);
  });
});
