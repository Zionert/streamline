import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { analyticsWith, scatterPoint } from '@/test/flowFixtures';

import { CARDS_SHEET, THROUGHPUT_SHEET, flowXlsxBlob } from './flowXlsx';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

interface ReadCell {
  /** `t` attribute: `s` for shared strings; absent for numbers and dates. */
  type: string | null;
  /** The value: the shared string for `s`, otherwise the number. */
  value: string | number;
  numberFormat: string | null;
  bold: boolean;
  /** Formula, if any. */
  formula: string | null;
}

/** A minimal reader of the parts of an .xlsx file the export writes. */
async function readWorkbook(blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const xml = (path: string) => {
    const file = files[path];
    if (!file) throw new Error(`No ${path} in the workbook`);
    return new DOMParser().parseFromString(strFromU8(file), 'application/xml');
  };
  const all = (doc: Document | Element, tag: string) => [
    ...doc.getElementsByTagNameNS(MAIN_NS, tag),
  ];

  const sharedStrings = all(xml('xl/sharedStrings.xml'), 'si').map((si) =>
    all(si, 't')
      .map((t) => t.textContent)
      .join(''),
  );
  const styles = xml('xl/styles.xml');
  const numberFormats = new Map(
    all(styles, 'numFmt').map((format) => [
      format.getAttribute('numFmtId'),
      format.getAttribute('formatCode'),
    ]),
  );
  const fonts = all(all(styles, 'fonts')[0] as Element, 'font');
  const cellFormats = all(all(styles, 'cellXfs')[0] as Element, 'xf');

  const workbook = xml('xl/workbook.xml');
  const sheetNames = all(workbook, 'sheet').map((sheet) => sheet.getAttribute('name'));

  function sheet(index: number) {
    const doc = xml(`xl/worksheets/sheet${String(index + 1)}.xml`);
    const cell = (address: string): ReadCell | null => {
      const element = all(doc, 'c').find((c) => c.getAttribute('r') === address);
      if (!element) return null;
      const type = element.getAttribute('t');
      const raw = all(element, 'v')[0]?.textContent ?? '';
      const format = cellFormats[Number(element.getAttribute('s') ?? 0)];
      const numFmtId = format?.getAttribute('numFmtId') ?? '0';
      const font = fonts[Number(format?.getAttribute('fontId') ?? 0)];
      return {
        type,
        value: type === 's' ? (sharedStrings[Number(raw)] ?? '') : Number(raw),
        numberFormat: numberFormats.get(numFmtId) ?? (numFmtId === '0' ? null : numFmtId),
        bold: font ? all(font, 'b').length > 0 : false,
        formula: all(element, 'f')[0]?.textContent ?? null,
      };
    };
    const pane = all(doc, 'pane')[0];
    const columns = all(doc, 'col').map((col) => Number(col.getAttribute('width')));
    return { cell, pane, columns, rows: all(doc, 'row').length };
  }

  return { sheetNames, sheet };
}

/** An Excel serial date as the ISO string of its wall-clock time (no time zone). */
function serialToWallClock(serial: number): string {
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * DAY_MS)).toISOString().slice(0, 16);
}

const TITLES = ['=cmd|calc', 'Zażółć gęślą jaźń', 'Тестова картка, їжак'];

async function workbook() {
  const data = analyticsWith(
    {},
    TITLES.map((title, index) =>
      scatterPoint({
        cardKey: `SB-${String(index + 1)}`,
        title,
        completedAt: '2026-10-22T13:05:00.000Z',
        leadTimeDays: 25.934,
        cycleTimeDays: index === 2 ? null : 4.1,
      }),
    ),
  );
  return readWorkbook(
    await flowXlsxBlob({ ...data, range: { ...data.range, timeZone: 'Europe/Warsaw' } }),
  );
}

describe('flowXlsx', () => {
  it('has a Cards and a Throughput sheet with bold, frozen headers', async () => {
    const { sheetNames, sheet } = await workbook();
    expect(sheetNames).toEqual([CARDS_SHEET, THROUGHPUT_SHEET]);

    const cards = sheet(0);
    expect(['A1', 'B1', 'C1', 'D1', 'E1'].map((a) => cards.cell(a)?.value)).toEqual([
      'Card',
      'Title',
      'Completed',
      'Lead time (days)',
      'Cycle time (days)',
    ]);
    expect(cards.cell('A1')?.bold).toBe(true);
    expect(cards.cell('A2')?.bold).toBe(false);
    expect(cards.pane?.getAttribute('ySplit')).toBe('1');
    expect(cards.pane?.getAttribute('state')).toBe('frozen');
    // The title column is wide.
    expect(cards.columns[1]).toBeGreaterThanOrEqual(50);

    const throughput = sheet(1);
    expect([throughput.cell('A1')?.value, throughput.cell('B1')?.value]).toEqual([
      'Date',
      'Completed',
    ]);
    expect(throughput.cell('B1')?.bold).toBe(true);
    expect(throughput.pane?.getAttribute('ySplit')).toBe('1');
    expect(throughput.pane?.getAttribute('state')).toBe('frozen');
    // A header and one row per day of the range.
    expect(throughput.rows).toBe(31);
  });

  it('writes numbers as numeric cells and times as local dates', async () => {
    const cards = (await workbook()).sheet(0);

    const lead = cards.cell('D2');
    expect(lead?.type).toBeNull();
    expect(typeof lead?.value).toBe('number');
    expect(lead?.value).toBe(25.93);
    expect(lead?.numberFormat).toBe('0.00');
    expect(cards.cell('E2')?.value).toBe(4.1);
    // No cycle time: an empty cell.
    expect(cards.cell('E4')).toBeNull();

    const completed = cards.cell('C2');
    expect(completed?.type).toBeNull();
    expect(completed?.numberFormat).toBe('yyyy-mm-dd hh:mm');
    // 13:05 UTC is 15:05 in Warsaw: the wall-clock time is stored.
    expect(serialToWallClock(Number(completed?.value))).toBe('2026-10-22T15:05');

    const day = (await workbook()).sheet(1).cell('A2');
    expect(day?.type).toBeNull();
    expect(day?.numberFormat).toBe('yyyy-mm-dd');
    expect(serialToWallClock(Number(day?.value))).toBe('2026-10-19T00:00');
    const count = (await workbook()).sheet(1).cell('B2');
    expect(typeof count?.value).toBe('number');
  });

  it('keeps titles as strings, never formulas, with Polish and Ukrainian letters', async () => {
    const cards = (await workbook()).sheet(0);

    expect(['B2', 'B3', 'B4'].map((address) => cards.cell(address)?.value)).toEqual(TITLES);
    const formulaLike = cards.cell('B2');
    expect(formulaLike?.type).toBe('s');
    expect(formulaLike?.formula).toBeNull();
    expect(cards.cell('A2')).toMatchObject({ type: 's', value: 'SB-1' });
  });
});
