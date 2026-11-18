/** Helpers shared by the CSV and Excel exports of the flow analytics. */

/** Decimals kept for durations in days. */
const DECIMALS = 2;

/** A duration in days rounded to two decimals. */
export function roundDays(value: number): number {
  const factor = 10 ** DECIMALS;
  return Math.round(value * factor) / factor;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The local date and time (to the minute) of an instant in `timeZone`. */
export function wallClock(instant: string, timeZone: string): WallClock {
  let formatter = formatters.get(timeZone);
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
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? Number.NaN);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** An instant as its local `YYYY-MM-DD HH:mm` in `timeZone`. */
export function localDateTime(instant: string, timeZone: string): string {
  const { year, month, day, hour, minute } = wallClock(instant, timeZone);
  return `${String(year)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
}

/** E.g. `SB-flow-cards-2026-10-19_2026-11-17.csv`. */
export function flowCsvFileName(boardKey: string, range: { from: string; to: string }): string {
  return `${boardKey}-flow-cards-${range.from}_${range.to}.csv`;
}

/** E.g. `SB-flow-2026-10-19_2026-11-17.xlsx`. */
export function flowXlsxFileName(boardKey: string, range: { from: string; to: string }): string {
  return `${boardKey}-flow-${range.from}_${range.to}.xlsx`;
}

export const CSV_MIME_TYPE = 'text/csv;charset=utf-8';
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
