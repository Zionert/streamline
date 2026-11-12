/**
 * Background colours for avatars and board icons. Each one keeps white text above the WCAG AA
 * contrast ratio of 4.5:1, in both themes.
 */
export const AVATAR_PALETTE = [
  '#0C66E4', // blue
  '#216E4E', // green
  '#AE2E24', // red
  '#5E4DB2', // purple
  '#206A83', // teal
  '#A54800', // orange
  '#943D73', // magenta
  '#44546F', // slate
] as const;

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
