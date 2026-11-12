/**
 * Board keys: the short uppercase prefix of card keys (`SL` in `SL-12`).
 *
 * A key is generated from the board name when the board is created and may be edited later.
 * It is unique among the boards of one owner; the server picks the first free candidate from
 * {@link boardKeyCandidates}.
 */

export const BOARD_KEY_MIN_LENGTH = 2;
export const BOARD_KEY_MAX_LENGTH = 5;

/** 2–5 uppercase ASCII letters. */
export const BOARD_KEY_PATTERN = /^[A-Z]{2,5}$/;

/** Key used when the board name has no usable letters. */
export const FALLBACK_BOARD_KEY = 'BRD';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Transliteration of letters that Unicode normalization does not reduce to ASCII: Latin letters
 * without a decomposition and the Ukrainian / Russian Cyrillic alphabet (initial-position forms,
 * e.g. `є` → `ye`, because keys are made of word initials). Applied to lowercase text before
 * the normalization, as it would otherwise turn `й` into `и`.
 */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
  ı: 'i',
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ye',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'yi',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * Words of a board name as uppercase ASCII letters: known non-ASCII letters are transliterated,
 * diacritics removed, and everything else (digits, punctuation, other scripts) separates words.
 */
export function boardNameWords(name: string): string[] {
  const transliterated = Array.from(name.toLowerCase(), (char) => TRANSLITERATION[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  return transliterated.split(/[^A-Z]+/).filter((word) => word.length > 0);
}

/**
 * Default key for a board name: the initials of its words (at most 5). A single word gives its
 * first two letters; a name without at least two usable letters gives {@link FALLBACK_BOARD_KEY}.
 *
 * Examples: `StreamLine Sprint` → `SS`, `Roadmap` → `RO`, `Дошка проєкту` → `DP`, `42` → `BRD`.
 */
export function generateBoardKey(name: string): string {
  const words = boardNameWords(name);
  const initials = words.map((word) => word.charAt(0)).join('');
  if (initials.length >= BOARD_KEY_MIN_LENGTH) {
    return initials.slice(0, BOARD_KEY_MAX_LENGTH);
  }
  const [first] = words;
  if (first !== undefined && first.length >= BOARD_KEY_MIN_LENGTH) {
    return first.slice(0, BOARD_KEY_MIN_LENGTH);
  }
  return FALLBACK_BOARD_KEY;
}

/** Bijective base-26 letters: 1 → `A`, 26 → `Z`, 27 → `AA`. */
function letterSuffix(index: number): string {
  let rest = index;
  let suffix = '';
  while (rest > 0) {
    rest -= 1;
    suffix = ALPHABET.charAt(rest % 26) + suffix;
    rest = Math.floor(rest / 26);
  }
  return suffix;
}

/** Variants that keep extending the key with further letters of the name. */
function nameExtensions(words: readonly string[], base: string): string[] {
  const [first] = words;
  const last = words.at(-1);
  if (first === undefined || last === undefined || base === FALLBACK_BOARD_KEY) return [];

  const extensions: string[] = [];
  for (let length = base.length + 1; length <= BOARD_KEY_MAX_LENGTH; length++) {
    // One word: more of its letters (`RO` → `ROA`); several: letters of the last word (`SB` → `SBO`).
    const candidate =
      words.length === 1 ? first.slice(0, length) : base + last.slice(1, 1 + length - base.length);
    if (candidate.length !== length) break;
    extensions.push(candidate);
  }
  return extensions;
}

/**
 * Deterministic sequence of distinct keys to try for a board name, best first:
 * 1. {@link generateBoardKey},
 * 2. the key extended with further letters of the name,
 * 3. the key with letter suffixes `A`…`Z`, `AA`…, shortening the key to stay within 5 letters
 *    (`SS` → `SSA`; `ABCDE` → `ABCDA`). Each candidate keeps at least the first letter.
 */
export function* boardKeyCandidates(name: string): Generator<string, void, undefined> {
  const base = generateBoardKey(name);
  const seen = new Set<string>();
  const fresh = (candidate: string): boolean => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  };

  for (const candidate of [base, ...nameExtensions(boardNameWords(name), base)]) {
    if (fresh(candidate)) yield candidate;
  }
  for (let index = 1; ; index++) {
    const suffix = letterSuffix(index);
    if (suffix.length >= BOARD_KEY_MAX_LENGTH) return;
    const prefix = base.slice(0, Math.min(base.length, BOARD_KEY_MAX_LENGTH - suffix.length));
    const candidate = prefix + suffix;
    if (fresh(candidate)) yield candidate;
  }
}

/**
 * First candidate of {@link boardKeyCandidates} that is not in `taken`.
 * Throws only if all of the several hundred thousand candidates are taken.
 */
export function pickBoardKey(name: string, taken: ReadonlySet<string>): string {
  for (const candidate of boardKeyCandidates(name)) {
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('No free board key left for this name');
}
