import type { LabelColor } from '@streamline/shared';
import type { CSSProperties } from 'react';

export const LABEL_COLOR_NAMES: Readonly<Record<LabelColor, string>> = {
  GREEN: 'Green',
  YELLOW: 'Yellow',
  ORANGE: 'Orange',
  RED: 'Red',
  PURPLE: 'Purple',
  BLUE: 'Blue',
  SKY: 'Sky',
  LIME: 'Lime',
  PINK: 'Pink',
  GRAY: 'Gray',
};

/** Theme-aware colours of a label pill (tokens `--label-<color>-bg` / `--label-<color>-text`). */
export function labelColorStyle(color: LabelColor): CSSProperties {
  const token = color.toLowerCase();
  return {
    backgroundColor: `var(--label-${token}-bg)`,
    color: `var(--label-${token}-text)`,
  };
}
