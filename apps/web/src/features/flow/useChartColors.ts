import { useState } from 'react';

import { useThemeStore } from '@/stores/theme';

/** Design tokens the charts are drawn with, by role. */
const CHART_TOKENS = {
  text: '--text',
  textSubtle: '--text-subtle',
  textMuted: '--text-muted',
  border: '--border',
  borderStrong: '--border-strong',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  primaryText: '--primary-text',
  ring: '--ring',
  catBacklog: '--cat-backlog',
  catTodo: '--cat-todo',
  catProgress: '--cat-progress',
  catDone: '--cat-done',
  warningText: '--warning-text',
  destructive: '--destructive',
} as const;

export type ChartColorRole = keyof typeof CHART_TOKENS;

/** Resolved colours (e.g. `#86d9a8`) of the chart roles in the current theme. */
export type ChartColors = Readonly<Record<ChartColorRole, string>>;

/** Used when a token cannot be read (e.g. the stylesheet is missing). */
const FALLBACK_COLOR = 'currentColor';

/** References between tokens deeper than this are treated as unresolvable. */
const MAX_VAR_DEPTH = 8;

const VAR_REFERENCE = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/;

/**
 * The value of a custom property on the root element. Browsers already substitute `var()` in
 * computed custom properties; the explicit resolution covers environments that do not.
 */
function readToken(style: CSSStyleDeclaration, token: string, depth = 0): string {
  const value = style.getPropertyValue(token).trim();
  const reference = VAR_REFERENCE.exec(value);
  if (!reference) {
    return value;
  }
  const [, referenced = '', fallback = ''] = reference;
  if (depth >= MAX_VAR_DEPTH) {
    return fallback.trim();
  }
  return readToken(style, referenced, depth + 1) || fallback.trim();
}

/** Reads the chart colours from the design tokens of the theme currently applied. */
export function readChartColors(root: Element = document.documentElement): ChartColors {
  const style = getComputedStyle(root);
  const colors = {} as Record<ChartColorRole, string>;
  for (const [role, token] of Object.entries(CHART_TOKENS) as [ChartColorRole, string][]) {
    colors[role] = readToken(style, token) || FALLBACK_COLOR;
  }
  return colors;
}

/**
 * Chart colours taken from the design tokens. SVG presentation attributes do not reliably
 * resolve `var()`, so the charts get resolved colours, which are read again whenever the theme
 * changes (the theme store applies the theme to the document before it updates).
 */
export function useChartColors(): ChartColors {
  const theme = useThemeStore((state) => state.resolvedTheme);
  const [current, setCurrent] = useState(() => ({ theme, colors: readChartColors() }));
  if (current.theme !== theme) {
    const next = { theme, colors: readChartColors() };
    setCurrent(next);
    return next.colors;
  }
  return current.colors;
}
