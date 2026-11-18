import { describe, expect, it } from 'vitest';

import { analyticsWith, emptyAnalytics, scatterPoint } from '@/test/flowFixtures';

import { CSV_BOM, flowCsv, flowCsvFileName, localDateTime, numberCell, textCell } from './flowCsv';

/** The lines of a CSV file, without the BOM and the final line break. */
function linesOf(csv: string): string[] {
  return csv.slice(CSV_BOM.length).replace(/\r\n$/, '').split('\r\n');
}

describe('textCell', () => {
  it('keeps plain text, including Polish letters', () => {
    expect(textCell('Zażółć gęślą jaźń')).toBe('Zażółć gęślą jaźń');
  });

  it('quotes cells with the delimiter, quotes, line breaks or spaces at either end', () => {
    expect(textCell('Login; signup')).toBe('"Login; signup"');
    expect(textCell('The "new" flow')).toBe('"The ""new"" flow"');
    expect(textCell('Two\nlines')).toBe('"Two\nlines"');
    expect(textCell('Two\r\nlines')).toBe('"Two\r\nlines"');
    expect(textCell(' padded')).toBe('" padded"');
    expect(textCell('padded ')).toBe('"padded "');
    // A comma is not the delimiter.
    expect(textCell('a, b')).toBe('a, b');
  });

  it.each(['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tTab', '\rReturn'])(
    'neutralises a formula in %j with an apostrophe',
    (value) => {
      const cell = textCell(value);
      expect(cell.replace(/^"/, '').startsWith(`'${value.slice(0, 1)}`)).toBe(true);
    },
  );

  it('quotes a neutralised formula when it needs quotes', () => {
    expect(textCell('=HYPERLINK("http://x";"y")')).toBe('"\'=HYPERLINK(""http://x"";""y"")"');
    expect(textCell('\rReturn')).toBe('"\'\rReturn"');
  });
});

describe('numberCell', () => {
  it('writes fractions with a decimal comma, at most two decimals', () => {
    expect(numberCell(4.5)).toBe('4,5');
    expect(numberCell(7.604166666)).toBe('7,6');
    expect(numberCell(1.005)).toBe('1');
    expect(numberCell(2.346)).toBe('2,35');
    expect(numberCell(12)).toBe('12');
    expect(numberCell(0)).toBe('0');
  });

  it('leaves unknown values empty', () => {
    expect(numberCell(null)).toBe('');
  });
});

describe('localDateTime', () => {
  it('writes the local date and time in the time zone, on a 24-hour clock', () => {
    expect(localDateTime('2026-10-22T13:05:00.000Z', 'UTC')).toBe('2026-10-22 13:05');
    expect(localDateTime('2026-10-22T13:05:00.000Z', 'Europe/Warsaw')).toBe('2026-10-22 15:05');
    // Past midnight UTC, still the previous day in Los Angeles.
    expect(localDateTime('2026-11-17T00:30:00.000Z', 'America/Los_Angeles')).toBe(
      '2026-11-16 16:30',
    );
    expect(localDateTime('2026-11-16T23:30:00.000Z', 'Europe/Warsaw')).toBe('2026-11-17 00:30');
  });
});

describe('flowCsv', () => {
  it('starts with a BOM and uses CRLF line endings', () => {
    const csv = flowCsv(analyticsWith());
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    // Every line break is CRLF.
    expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('lists the completed cards, then the daily throughput after an empty line', () => {
    const lines = linesOf(flowCsv(analyticsWith()));
    expect(lines.slice(0, 4)).toEqual([
      'Cards completed;2026-10-19;2026-11-17;UTC',
      'Card;Title;Completed;Lead time (days);Cycle time (days)',
      'SB-1;Fix login;2026-10-22 13:05;9,4;4,1',
      'SB-2;Card SB-2;2026-10-27 10:00;6;2,5',
    ]);
    // The card without cycle time has an empty last cell.
    expect(lines[8]).toBe('SB-7;Card SB-7;2026-11-16 10:00;6;');
    expect(lines.slice(9, 13)).toEqual(['', 'Daily throughput', 'Date;Completed', '2026-10-19;0']);
    expect(lines).toContain('2026-10-22;1');
    expect(lines.at(-1)).toBe('2026-11-17;0');
    // 2 header lines, 7 cards, a blank line, 2 header lines and 30 days.
    expect(lines).toHaveLength(2 + 7 + 1 + 2 + 30);
  });

  it('writes completion times in the time zone of the range', () => {
    const data = analyticsWith();
    const lines = linesOf(
      flowCsv({ ...data, range: { ...data.range, timeZone: 'Europe/Warsaw' } }),
    );
    expect(lines[0]).toBe('Cards completed;2026-10-19;2026-11-17;Europe/Warsaw');
    expect(lines[2]).toBe('SB-1;Fix login;2026-10-22 15:05;9,4;4,1');
  });

  it('escapes user titles and keeps Polish letters', () => {
    const data = analyticsWith({}, [
      scatterPoint({ cardKey: 'SB-1', title: '=cmd|calc', completedAt: '2026-10-22T10:00:00Z' }),
      scatterPoint({
        cardKey: 'SB-2',
        title: 'Płatności; "nowe" okno',
        completedAt: '2026-10-23T10:00:00Z',
      }),
      scatterPoint({
        cardKey: 'SB-3',
        title: 'Źródło danych',
        completedAt: '2026-10-24T10:00:00Z',
      }),
    ]);
    const lines = linesOf(flowCsv(data));
    expect(lines.slice(2, 5)).toEqual([
      "SB-1;'=cmd|calc;2026-10-22 10:00;6;3",
      'SB-2;"Płatności; ""nowe"" okno";2026-10-23 10:00;6;3',
      'SB-3;Źródło danych;2026-10-24 10:00;6;3',
    ]);
  });

  it('has both sections also without completed cards', () => {
    const lines = linesOf(flowCsv(emptyAnalytics()));
    expect(lines.slice(0, 5)).toEqual([
      'Cards completed;2026-10-19;2026-11-17;UTC',
      'Card;Title;Completed;Lead time (days);Cycle time (days)',
      '',
      'Daily throughput',
      'Date;Completed',
    ]);
  });
});

describe('flowCsvFileName', () => {
  it('names the board and the range', () => {
    expect(flowCsvFileName('SB', { from: '2026-10-19', to: '2026-11-17' })).toBe(
      'SB-flow-2026-10-19_2026-11-17.csv',
    );
  });
});
