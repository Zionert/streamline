import type { AnalyticsResponse } from '@streamline/shared';
import writeXlsxFile, { type Row, type Sheet } from 'write-excel-file/browser';

import { roundDays, wallClock } from './flowExport';

/*
 * Excel export of the flow analytics: sheet "Cards" (the cards completed in the range) and sheet
 * "Throughput" (completions per day). Cells are typed (numbers, dates, strings), so Excel shows
 * them correctly whatever its regional settings. This module and its library are loaded on
 * demand, as most visits never export.
 *
 * Titles are user input. They are written as string cells (shared strings), which Excel never
 * evaluates, so a title starting with `=` stays text and needs no apostrophe.
 */

export const CARDS_SHEET = 'Cards';
export const THROUGHPUT_SHEET = 'Throughput';

const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm';
const DATE_FORMAT = 'yyyy-mm-dd';
const DAYS_FORMAT = '0.00';

type Cell = Row[number];

/**
 * A date cell value showing the local wall-clock time of `instant` in `timeZone`. Excel has no
 * time zones and the library writes the UTC fields of a `Date`, so the local fields go there.
 */
function localDateValue(instant: string, timeZone: string): Date {
  const { year, month, day, hour, minute } = wallClock(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function header(titles: readonly string[]): Row {
  return titles.map((value): Cell => ({ value, type: String, fontWeight: 'bold' }));
}

function days(value: number | null): Cell {
  return value === null ? null : { value: roundDays(value), type: Number, format: DAYS_FORMAT };
}

/** The sheets of the workbook. */
export function flowWorkbookSheets(data: AnalyticsResponse): Sheet<Blob>[] {
  const { timeZone } = data.range;
  const cards: Row[] = [
    header(['Card', 'Title', 'Completed', 'Lead time (days)', 'Cycle time (days)']),
    ...data.leadCycle.points.map((point): Row => [
      { value: point.cardKey, type: String },
      { value: point.title, type: String },
      {
        value: localDateValue(point.completedAt, timeZone),
        type: Date,
        format: DATE_TIME_FORMAT,
      },
      days(point.leadTimeDays),
      days(point.cycleTimeDays),
    ]),
  ];
  const throughput: Row[] = [
    header(['Date', 'Completed']),
    ...data.throughput.daily.map((day): Row => [
      { value: new Date(`${day.date}T00:00:00Z`), type: Date, format: DATE_FORMAT },
      { value: day.count, type: Number },
    ]),
  ];
  return [
    {
      sheet: CARDS_SHEET,
      data: cards,
      columns: [{ width: 12 }, { width: 50 }, { width: 18 }, { width: 16 }, { width: 17 }],
      stickyRowsCount: 1,
    },
    {
      sheet: THROUGHPUT_SHEET,
      data: throughput,
      columns: [{ width: 12 }, { width: 12 }],
      stickyRowsCount: 1,
    },
  ];
}

/** The workbook as an .xlsx file. */
export function flowXlsxBlob(data: AnalyticsResponse): Promise<Blob> {
  return writeXlsxFile(flowWorkbookSheets(data)).toBlob();
}
