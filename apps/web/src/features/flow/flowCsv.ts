import type { AnalyticsResponse } from '@streamline/shared';

import { localDateTime, roundDays } from './flowExport';

/*
 * CSV export of the cards completed in the range: a portable, standards-based file (RFC 4180)
 * for other tools and imports. Comma delimiter, dot decimals, every text field quoted, UTF-8 with
 * a byte order mark (so spreadsheets detect the encoding) and CRLF line endings. A CSV holds one
 * table, so it has the cards only. Spreadsheet users should use the Excel (.xlsx) export: its
 * cells are typed, so it does not depend on the list separator of the regional settings.
 */

/** The byte order mark, built from its code so that no editor or tool can strip it. */
export const CSV_BOM = String.fromCharCode(0xfeff);
export const CSV_LINE_END = '\r\n';

export const CSV_HEADER_FIELDS = [
  'Card',
  'Title',
  'Completed',
  'Lead time (days)',
  'Cycle time (days)',
] as const;

/** Spreadsheets treat a cell starting with one of these as a formula (or its continuation). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A text field: a leading formula character is neutralised with an apostrophe (titles are user
 * input), then the field is quoted, with its quotes doubled.
 */
export function textCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** A number with a dot as the decimal separator, at most two decimals; empty when unknown. */
export function numberCell(value: number | null): string {
  return value === null ? '' : String(roundDays(value));
}

/** The cards completed in the range, one row each (empty cycle time when never in progress). */
export function flowCsv(data: AnalyticsResponse): string {
  const { timeZone } = data.range;
  const lines = [
    CSV_HEADER_FIELDS.map(textCell).join(','),
    ...data.leadCycle.points.map((point) =>
      [
        textCell(point.cardKey),
        textCell(point.title),
        localDateTime(point.completedAt, timeZone),
        numberCell(point.leadTimeDays),
        numberCell(point.cycleTimeDays),
      ].join(','),
    ),
  ];
  return `${CSV_BOM}${lines.join(CSV_LINE_END)}${CSV_LINE_END}`;
}
