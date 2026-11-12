import { describe, expect, it } from 'vitest';

import {
  BOARD_KEY_PATTERN,
  boardKeyCandidates,
  boardNameWords,
  FALLBACK_BOARD_KEY,
  generateBoardKey,
  pickBoardKey,
} from './board-key.js';
import { boardKeySchema } from './schemas/board.js';

function take(name: string, count: number): string[] {
  const result: string[] = [];
  for (const candidate of boardKeyCandidates(name)) {
    result.push(candidate);
    if (result.length === count) break;
  }
  return result;
}

describe('boardNameWords', () => {
  it('splits on everything that is not a letter and uppercases', () => {
    expect(boardNameWords('Sprint-2 board_v3 (QA)')).toEqual(['SPRINT', 'BOARD', 'V', 'QA']);
  });

  it('removes diacritics and transliterates letters without a decomposition', () => {
    expect(boardNameWords('Żółć łąka Ørsted straße')).toEqual([
      'ZOLC',
      'LAKA',
      'ORSTED',
      'STRASSE',
    ]);
  });

  it('transliterates Ukrainian and Russian Cyrillic', () => {
    expect(boardNameWords('Дошка проєкту')).toEqual(['DOSHKA', 'PROYEKTU']);
    expect(boardNameWords('Їжак й щука')).toEqual(['YIZHAK', 'Y', 'SHCHUKA']);
    expect(boardNameWords('Съёмка')).toEqual(['SYOMKA']);
  });

  it('drops letters of other scripts', () => {
    expect(boardNameWords('看板 Kanban')).toEqual(['KANBAN']);
  });
});

describe('generateBoardKey', () => {
  it.each([
    ['StreamLine Sprint', 'SS'],
    ['Sprint board', 'SB'],
    ['marketing team q4 plan', 'MTQP'],
    ['One two three four five six', 'OTTFF'],
    ['Roadmap', 'RO'],
    ['  roadmap  ', 'RO'],
    ['Дошка проєкту', 'DP'],
    ['Łódź', 'LO'],
    ['Q4 plan', 'QP'],
  ])('%j -> %s', (name, key) => {
    expect(generateBoardKey(name)).toBe(key);
  });

  // `Q4 2027` and `A` have a single one-letter word, so there are no further letters to take.
  it.each(['', '   ', '2027', '!!!', '看板', 'A', 'Q4 2027'])(
    'falls back to BRD for %j',
    (name) => {
      expect(generateBoardKey(name)).toBe(FALLBACK_BOARD_KEY);
    },
  );

  it('always produces a key accepted by boardKeySchema', () => {
    for (const name of ['x', 'Ab', 'ż', 'Hello World', 'a b c d e f g', '12 ab', 'Їжак']) {
      const key = generateBoardKey(name);
      expect(key).toMatch(BOARD_KEY_PATTERN);
      expect(boardKeySchema.parse(key)).toBe(key);
    }
  });
});

describe('boardKeyCandidates', () => {
  it('extends a one-word key with further letters of the word first', () => {
    // `ROA` from the suffix sequence is skipped, as it was already yielded.
    expect(take('Roadmap', 6)).toEqual(['RO', 'ROA', 'ROAD', 'ROADM', 'ROB', 'ROC']);
  });

  it('extends initials with letters of the last word, then appends suffixes', () => {
    expect(take('Sprint Board', 6)).toEqual(['SB', 'SBO', 'SBOA', 'SBOAR', 'SBA', 'SBB']);
  });

  it('shortens a five-letter key to make room for the suffix', () => {
    expect(take('a b c d e', 4)).toEqual(['ABCDE', 'ABCDA', 'ABCDB', 'ABCDC']);
  });

  it('continues with two-letter suffixes after Z', () => {
    const candidates = take('One Two Three Four Five', 40);
    // `OTTFF` (suffix F) equals the base and is skipped, so Z is the 26th candidate.
    expect(candidates.slice(25, 28)).toEqual(['OTTFZ', 'OTTAA', 'OTTAB']);
  });

  it('yields distinct keys that all match the key pattern', () => {
    const candidates = take('Roadmap', 2000);
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const candidate of candidates) expect(candidate).toMatch(BOARD_KEY_PATTERN);
  });

  it('is deterministic', () => {
    expect(take('Sprint Board', 50)).toEqual(take('Sprint Board', 50));
  });
});

describe('pickBoardKey', () => {
  it('returns the generated key when it is free', () => {
    expect(pickBoardKey('Sprint Board', new Set(['RO']))).toBe('SB');
  });

  it('skips taken keys in candidate order', () => {
    expect(pickBoardKey('Sprint Board', new Set(['SB', 'SBO']))).toBe('SBOA');
    expect(pickBoardKey('Roadmap', new Set(['RO', 'ROA', 'ROAD', 'ROADM']))).toBe('ROB');
  });

  it('finds a key for the fallback even when many are taken', () => {
    const taken = new Set(take('', 500));
    const key = pickBoardKey('???', taken);
    expect(taken.has(key)).toBe(false);
    expect(key).toMatch(BOARD_KEY_PATTERN);
  });
});
