import type { AnalyticsResponse } from '@streamline/shared';

/*
 * CSV export of the flow analytics shown on the page.
 *
 * Format: UTF-8 with a byte order mark, CRLF line endings, `;` as the delimiter and a decimal
 * comma. Excel with Polish (and most other European) regional settings splits a `;`-separated
 * file into columns when it is opened by double-click and reads `4,5` as a number; the BOM makes
 * it read the file as UTF-8, so Polish letters survive.
 */

export const CSV_BOM = '\uFEFF';
export const CSV_DELIMITER = ';';
export const CSV_LINE_END = '\r\n';
export const CSV_MIME_TYPE = 'text/csv;charset=utf-8';

/** Decimals kept for fractional numbers (days). */
const DECIMALS = 2;

/** Spreadsheets treat a cell starting with one of these as a formula (or its continuation). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Cells that need quotes: the delimiter, a quote, a line break, or spaces at either end. */
const NEEDS_QUOTES = /[;"\r\n]|^\s|\s$/;

/**
 * A text cell: a leading formula character is neutralised with an apostrophe (titles are user
 * input), then the cell is quoted when needed, with its quotes doubled (RFC 4180).
 */
export function textCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** A number with a decimal comma, e.g. `4,5`; at most two decimals, none for whole numbers. */
export function numberCell(value: number | null): string {
  if (value === null) {
    return '';
  }
  const factor = 10 ** DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded).replace('.', ',');
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/** An instant as its local `YYYY-MM-DD HH:mm` in `timeZone`. */
export function localDateTime(instant: string, timeZone: string): string {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

function line(cells: readonly string[]): string {
  return cells.join(CSV_DELIMITER);
}

/**
 * The analytics as one CSV file with two sections separated by an empty line:
 * 1. `Cards completed;<from>;<to>;<timeZone>`, then one row per completed card (empty cycle time
 *    when the card was never in progress);
 * 2. `Daily throughput`, then one row per day of the range.
 */
export function flowCsv(data: AnalyticsResponse): string {
  const { from, to, timeZone } = data.range;
  const lines = [
    line([textCell('Cards completed'), textCell(from), textCell(to), textCell(timeZone)]),
    line(['Card', 'Title', 'Completed', 'Lead time (days)', 'Cycle time (days)']),
    ...data.leadCycle.points.map((point) =>
      line([
        textCell(point.cardKey),
        textCell(point.title),
        textCell(localDateTime(point.completedAt, timeZone)),
        numberCell(point.leadTimeDays),
        numberCell(point.cycleTimeDays),
      ]),
    ),
    '',
    'Daily throughput',
    line(['Date', 'Completed']),
    ...data.throughput.daily.map((day) => line([textCell(day.date), numberCell(day.count)])),
  ];
  return `${CSV_BOM}${lines.join(CSV_LINE_END)}${CSV_LINE_END}`;
}

/** E.g. `SB-flow-2026-10-19_2026-11-17.csv`. */
export function flowCsvFileName(boardKey: string, range: { from: string; to: string }): string {
  return `${boardKey}-flow-${range.from}_${range.to}.csv`;
}
