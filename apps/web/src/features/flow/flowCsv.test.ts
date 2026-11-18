import { describe, expect, it } from 'vitest';

import { analyticsWith, emptyAnalytics, scatterPoint } from '@/test/flowFixtures';

import { CSV_BOM, flowCsv, numberCell, textCell } from './flowCsv';
import { flowCsvFileName, flowXlsxFileName, localDateTime } from './flowExport';

/**
 * A strict RFC 4180 parser for the tests: comma-separated fields, CRLF records, quoted fields with
 * doubled quotes (and any character, line breaks included, inside the quotes). Rejects anything
 * else, e.g. a bare line feed, a quote inside an unquoted field or text after a closing quote.
 * Returns the records and, per field, whether it was quoted.
 */
function parseCsv(text: string): { value: string; quoted: boolean }[][] {
  const records: { value: string; quoted: boolean }[][] = [];
  let record: { value: string; quoted: boolean }[] = [];
  let i = 0;
  const fail = (message: string) => {
    throw new Error(`${message} at ${String(i)}`);
  };
  for (;;) {
    let value = '';
    let quoted = false;
    if (text[i] === '"') {
      quoted = true;
      i += 1;
      for (;;) {
        if (i >= text.length) fail('Unterminated quoted field');
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          value += text[i];
          i += 1;
        }
      }
    } else {
      while (i < text.length && text[i] !== ',' && text[i] !== '\r') {
        if (text[i] === '"' || text[i] === '\n') fail('Unexpected character in a plain field');
        value += text[i];
        i += 1;
      }
    }
    record.push({ value, quoted });
    if (text[i] === ',') {
      i += 1;
    } else if (text.startsWith('\r\n', i)) {
      i += 2;
      records.push(record);
      record = [];
      if (i === text.length) return records;
    } else {
      fail('Expected a comma or CRLF');
    }
  }
}

/** The CSV without its BOM, parsed; the BOM must be there exactly once. */
function parseExport(csv: string) {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  expect(csv.indexOf(CSV_BOM, 1)).toBe(-1);
  return parseCsv(csv.slice(CSV_BOM.length));
}

const values = (records: { value: string }[][]) => records.map((r) => r.map((f) => f.value));

describe('CSV_BOM', () => {
  it('is the single byte order mark character', () => {
    expect(CSV_BOM.length).toBe(1);
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('textCell', () => {
  it('quotes every text field and doubles its quotes', () => {
    expect(textCell('Fix login')).toBe('"Fix login"');
    expect(textCell('The "new" flow')).toBe('"The ""new"" flow"');
    expect(textCell('')).toBe('""');
  });

  it.each(['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tTab', '\rReturn'])(
    'neutralises a formula in %j with an apostrophe',
    (value) => {
      expect(textCell(value)).toBe(`"'${value}"`);
    },
  );
});

describe('numberCell', () => {
  it('writes numbers with a dot and at most two decimals', () => {
    expect(numberCell(4.5)).toBe('4.5');
    expect(numberCell(25.934)).toBe('25.93');
    expect(numberCell(2.346)).toBe('2.35');
    expect(numberCell(12)).toBe('12');
    expect(numberCell(null)).toBe('');
  });
});

describe('localDateTime', () => {
  it('writes the local date and time in the time zone, on a 24-hour clock', () => {
    expect(localDateTime('2026-10-22T13:05:00.000Z', 'UTC')).toBe('2026-10-22 13:05');
    expect(localDateTime('2026-10-22T13:05:00.000Z', 'Europe/Warsaw')).toBe('2026-10-22 15:05');
    expect(localDateTime('2026-11-17T00:30:00.000Z', 'America/Los_Angeles')).toBe(
      '2026-11-16 16:30',
    );
    expect(localDateTime('2026-11-16T23:30:00.000Z', 'Europe/Warsaw')).toBe('2026-11-17 00:30');
  });
});

describe('flowCsv', () => {
  it('is RFC 4180 with a BOM and CRLF line endings, with the cards only', () => {
    const csv = flowCsv(analyticsWith());
    expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    const lines = csv.slice(CSV_BOM.length).split('\r\n');
    expect(lines.slice(0, 3)).toEqual([
      '"Card","Title","Completed","Lead time (days)","Cycle time (days)"',
      '"SB-1","Fix login",2026-10-22 13:05,9.4,4.1',
      '"SB-2","Card SB-2",2026-10-27 10:00,6,2.5',
    ]);
    // The card without cycle time has an empty last field; no throughput section.
    expect(lines[7]).toBe('"SB-7","Card SB-7",2026-11-16 10:00,6,');
    expect(lines.slice(8)).toEqual(['']);
    expect(csv).not.toContain('Daily throughput');
  });

  it('round-trips titles exactly, quoting text and leaving numbers and dates plain', () => {
    const titles = [
      'Login, signup and logout',
      'The "new" checkout',
      'Semi; colon',
      'Two\r\nlines',
      'Line\nfeed',
      '=HYPERLINK("http://x","y")',
      '+cmd',
      '-1',
      '@import',
      'Zażółć gęślą jaźń',
      'Тестова картка, їжак',
    ];
    const data = analyticsWith(
      {},
      titles.map((title, index) =>
        scatterPoint({
          cardKey: `SB-${String(index + 1)}`,
          title,
          completedAt: '2026-11-02T12:00:00.000Z',
          leadTimeDays: 25.934,
          cycleTimeDays: index === 0 ? null : 1.5,
        }),
      ),
    );
    const records = parseExport(
      flowCsv({ ...data, range: { ...data.range, timeZone: 'Europe/Warsaw' } }),
    );

    expect(values(records)[0]).toEqual([
      'Card',
      'Title',
      'Completed',
      'Lead time (days)',
      'Cycle time (days)',
    ]);
    // Every text field is quoted, the header included.
    expect(records[0]?.every((field) => field.quoted)).toBe(true);
    const rows = records.slice(1);
    expect(rows).toHaveLength(titles.length);
    const guarded = (title: string) => (/^[=+\-@]/.test(title) ? `'${title}` : title);
    expect(rows.map((row) => row[1]?.value)).toEqual(titles.map(guarded));
    for (const row of rows) {
      expect(row.map((field) => field.quoted)).toEqual([true, true, false, false, false]);
      expect(row[2]?.value).toBe('2026-11-02 13:00');
      expect(row[3]?.value).toBe('25.93');
    }
    expect(rows[0]?.[4]?.value).toBe('');
    expect(rows[1]?.[4]?.value).toBe('1.5');
  });

  it('has only the header without completed cards', () => {
    expect(values(parseExport(flowCsv(emptyAnalytics())))).toEqual([
      ['Card', 'Title', 'Completed', 'Lead time (days)', 'Cycle time (days)'],
    ]);
  });
});

describe('file names', () => {
  it('names the board, the content and the range', () => {
    const range = { from: '2026-10-19', to: '2026-11-17' };
    expect(flowCsvFileName('SB', range)).toBe('SB-flow-cards-2026-10-19_2026-11-17.csv');
    expect(flowXlsxFileName('SB', range)).toBe('SB-flow-2026-10-19_2026-11-17.xlsx');
  });
});
