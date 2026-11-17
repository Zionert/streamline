import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useThemeStore } from '@/stores/theme';

import { readChartColors, useChartColors } from './useChartColors';

/** A small stand-in for the token rules of index.css (stylesheets are not loaded in tests). */
const TOKENS_CSS = `
:root { --cat-done: #1f8a56; --text-muted: #696c73; --cat-backlog: var(--text-muted); }
.dark { --cat-done: #86d9a8; --text-muted: #8b8d93; --cat-backlog: var(--text-muted); }
`;

let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement('style');
  style.textContent = TOKENS_CSS;
  document.head.append(style);
});

afterEach(() => {
  style.remove();
});

describe('readChartColors', () => {
  it('reads the tokens of the applied theme and resolves references between them', () => {
    expect(readChartColors()).toMatchObject({ catDone: '#1f8a56', catBacklog: '#696c73' });

    document.documentElement.classList.add('dark');

    expect(readChartColors()).toMatchObject({ catDone: '#86d9a8', catBacklog: '#8b8d93' });
  });

  it('falls back to the current colour for a token that is not defined', () => {
    expect(readChartColors().catTodo).toBe('currentColor');
  });
});

describe('useChartColors', () => {
  it('re-reads the colours when the theme changes, without a reload', () => {
    act(() => useThemeStore.getState().setPreference('light'));
    const { result } = renderHook(() => useChartColors());
    expect(result.current.catDone).toBe('#1f8a56');

    act(() => useThemeStore.getState().setPreference('dark'));

    expect(result.current.catDone).toBe('#86d9a8');
    expect(result.current.catBacklog).toBe('#8b8d93');

    act(() => useThemeStore.getState().setPreference('light'));

    expect(result.current.catDone).toBe('#1f8a56');
  });
});
