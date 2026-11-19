import { LABEL_COLORS } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { contrastRatio } from '@/test/contrast';

import css from './index.css?raw';

/** Custom properties declared directly in the first rule with exactly this selector. */
function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) {
    throw new Error(`No rule for ${selector}`);
  }
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const values = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) {
      values.set(name, value.trim());
    }
  }
  return values;
}

/** Colour palette of the design: [token, dark, light]. */
const PALETTE: readonly [string, string, string][] = [
  ['--canvas', '#0f1012', '#f6f6f7'],
  ['--surface', '#17181b', '#ffffff'],
  ['--surface-hover', '#1d1f23', '#efeff1'],
  ['--surface-raised', '#1a1b1f', '#ffffff'],
  ['--border', '#25272c', '#e3e4e7'],
  ['--border-strong', '#2e3035', '#cfd1d6'],
  ['--text', '#e6e6e3', '#18191b'],
  ['--text-subtle', '#a9abb0', '#55585f'],
  ['--text-muted', '#8b8d93', '#696c73'],
  ['--primary', '#f2a93b', '#e8961e'],
  ['--primary-hover', '#ffc56b', '#d4850f'],
  ['--primary-foreground', '#17130a', '#17130a'],
  ['--primary-subtle', '#2a2215', '#fdf1de'],
  ['--primary-text', '#f2a93b', '#8a5300'],
  ['--cat-todo', '#7cc4fa', '#2f7fc1'],
  ['--cat-done', '#86d9a8', '#1f8a56'],
  ['--warning-text', '#f5c35b', '#8a5300'],
  ['--danger', '#ff7a6b', '#e5484d'],
  ['--danger-subtle', '#2a1716', '#fdecec'],
  ['--destructive', '#ff8a7d', '#b42318'],
];

const BACKGROUNDS = ['--canvas', '--surface', '--surface-raised', '--surface-hover'] as const;

/** Text colours on the backgrounds they are used on: [text, background]. */
const TEXT_PAIRS: readonly [string, string][] = [
  ...['--text', '--text-subtle', '--text-muted'].flatMap((text) =>
    BACKGROUNDS.map((background): [string, string] => [text, background]),
  ),
  // "No cards" in a column over its WIP limit whose cards are all filtered out.
  ['--text-muted', '--danger-subtle'],
  // Primary and destructive buttons (and the primary hover state).
  ['--primary-foreground', '--primary'],
  ['--primary-foreground', '--primary-hover'],
  ['--primary-foreground', '--danger'],
  // Links and the accent used as text.
  ...BACKGROUNDS.map((background): [string, string] => ['--primary-text', background]),
  // Error text, the exceeded WIP counter, URGENT and the subtle "Delete" button.
  ...BACKGROUNDS.map((background): [string, string] => ['--destructive', background]),
  ['--destructive', '--danger-subtle'],
  // The HIGH priority on a card; the p85 reference label of the cycle time chart. (The p95
  // label in --destructive, the p50 label in --text-subtle and the axis ticks in --text-muted
  // are covered above; p50 is not labelled in --cat-done, below 4.5:1 on the light surface.)
  ['--warning-text', '--surface'],
  // The error block of the assistant (a failed answer) in the panel.
  ['--text', '--danger-subtle'],
];

/** Graphics that carry meaning (WCAG 1.4.11 non-text contrast): [graphic, background]. */
const NON_TEXT_PAIRS: readonly [string, string][] = [
  // Category lines and the exceeded WIP line under the column headers, on the canvas.
  ['--cat-backlog', '--canvas'],
  ['--cat-todo', '--canvas'],
  ['--cat-progress', '--canvas'],
  ['--cat-done', '--canvas'],
  ['--danger', '--canvas'],
  // The focus ring (also the active people filter) on every background it can sit on.
  ['--ring', '--canvas'],
  ['--ring', '--surface'],
  ['--ring', '--surface-raised'],
  ['--ring', '--danger-subtle'],
  // Flow charts on a chart card: category series (throughput bars, cumulative flow outlines),
  // the percentile and average reference lines (the average in --text-muted, checked below),
  // the scatter points and the hovered point.
  ['--cat-backlog', '--surface'],
  ['--cat-todo', '--surface'],
  ['--cat-progress', '--surface'],
  ['--cat-done', '--surface'],
  ['--warning-text', '--surface'],
  ['--destructive', '--surface'],
  ['--text-subtle', '--surface'],
  ['--primary-text', '--surface'],
  // The boundary of an unchecked checkbox (dialogs and popovers).
  ['--text-muted', '--surface'],
  ['--text-muted', '--surface-raised'],
  // Assistant panel: the edges of the error and limit blocks, the finished and failed tool steps.
  ['--danger', '--danger-subtle'],
  ['--warning-text', '--surface-hover'],
  ['--cat-done', '--surface-raised'],
  ['--warning-text', '--surface-raised'],
  // Label dots on a card tile.
  ...LABEL_COLORS.map((color): [string, string] => [
    `--label-${color.toLowerCase()}-dot`,
    '--surface',
  ]),
];

describe('design tokens in index.css', () => {
  const light = declarations(':root');
  const dark = declarations('.dark');

  it.each(PALETTE)('defines %s for both themes', (token, darkValue, lightValue) => {
    expect(dark.get(token)).toBe(darkValue);
    expect(light.get(token)).toBe(lightValue);
  });

  it('defines the shadows and the modal overlay', () => {
    expect(dark.get('--shadow-card')).toBe('none');
    expect(light.get('--shadow-card')).toBe('0 1px 2px rgb(16 17 19 / 6%)');
    expect(dark.get('--shadow-raised')).toBe('0 12px 40px rgb(0 0 0 / 50%)');
    expect(light.get('--shadow-raised')).toBe('0 12px 32px rgb(16 17 19 / 14%)');
    expect(dark.get('--overlay')).toBe('rgb(0 0 0 / 60%)');
    expect(light.get('--overlay')).toBe('rgb(0 0 0 / 60%)');
  });

  it('defines the category lines and the focus ring per theme', () => {
    expect(light.get('--cat-backlog')).toBe('var(--text-muted)');
    expect(dark.get('--cat-backlog')).toBe('var(--text-muted)');
    expect(light.get('--cat-progress')).toBe('#b86e00');
    expect(dark.get('--cat-progress')).toBe('var(--primary)');
    // The light ring uses the accent's text colour: --primary is below 3:1 there.
    expect(light.get('--ring')).toBe('var(--primary-text)');
    expect(dark.get('--ring')).toBe('var(--primary)');
  });

  it('has no aliases left over from the previous style', () => {
    for (const legacy of ['--color-column', '--color-success', '--color-warning:']) {
      expect(css).not.toContain(legacy);
    }
    expect(css).not.toContain('--radius-column');
  });

  it.each(LABEL_COLORS)('defines the pill colours of %s for both themes and its dot', (color) => {
    const name = color.toLowerCase();
    for (const theme of [light, dark]) {
      expect(theme.get(`--label-${name}-bg`)).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.get(`--label-${name}-text`)).toMatch(/^#[0-9a-f]{6}$/);
    }
    // One dot colour serves both themes (declared once, in the light rule).
    expect(light.get(`--label-${name}-dot`)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(LABEL_COLORS)('keeps the %s pill text readable (WCAG AA) in both themes', (color) => {
    const name = color.toLowerCase();
    for (const theme of [light, dark]) {
      expect(
        contrastRatio(
          theme.get(`--label-${name}-text`) ?? '',
          theme.get(`--label-${name}-bg`) ?? '',
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  describe.each(['light', 'dark'] as const)('contrast in the %s theme', (name) => {
    const theme = name === 'light' ? light : dark;
    /** The colour of a token in this theme (the dark rule overrides the light one). */
    const colour = (token: string): string => {
      const value = theme.get(token) ?? light.get(token) ?? '';
      const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
      return reference?.[1] ? colour(reference[1]) : value;
    };

    it.each(TEXT_PAIRS)('%s on %s is readable text (4.5:1)', (text, background) => {
      expect(colour(text)).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(colour(text), colour(background))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(NON_TEXT_PAIRS)('%s on %s is a visible graphic (3:1)', (graphic, background) => {
      expect(colour(graphic)).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(colour(graphic), colour(background))).toBeGreaterThanOrEqual(3);
    });
  });
});
