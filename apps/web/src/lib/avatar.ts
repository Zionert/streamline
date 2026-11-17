/**
 * Pastel background colours for avatars and board icons, the same in both themes. Each one keeps
 * the dark avatar text (`AVATAR_TEXT_COLOR`) above the WCAG AA contrast ratio of 4.5:1.
 */
export const AVATAR_PALETTE = [
  '#F2A93B', // amber
  '#7CC4FA', // sky
  '#B6A2F5', // lavender
  '#86D9A8', // mint
  '#F28FB1', // pink
  '#F5D06B', // yellow
  '#8DD3D8', // teal
  '#C9B79C', // sand
] as const;

/** Text colour of the initials on every palette colour. */
export const AVATAR_TEXT_COLOR = '#0F1012';

export type PaletteColor = (typeof AVATAR_PALETTE)[number];

/** FNV-1a: a small, stable string hash (the same id always gives the same colour). */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Palette colour chosen deterministically from an id (user id, board id). */
export function paletteColorFor(id: string): PaletteColor {
  return AVATAR_PALETTE[hashString(id) % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0];
}

/** Up to two initials: first letters of the first and last word ("Jan Kowalski" → "JK"). */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) {
    return '?';
  }
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const initials = [first, last]
    .filter((word): word is string => word !== undefined)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
  return initials.toLocaleUpperCase('en-GB');
}

/** Splits a list into the items shown and the number of hidden ones ("+N"). */
export function splitVisible<T>(
  items: readonly T[],
  max: number,
): { visible: T[]; hidden: number } {
  const visible = items.slice(0, Math.max(0, max));
  return { visible, hidden: items.length - visible.length };
}
