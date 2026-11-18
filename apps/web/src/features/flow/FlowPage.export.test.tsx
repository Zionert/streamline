import type { AnalyticsResponse } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyticsWith, emptyAnalytics } from '@/test/flowFixtures';
import { analyticsShown, ok, renderFlowPage } from '@/test/flowPage';
import { closeMenu, menuItemNames, openMenu } from '@/test/menu';
import { deferred, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

import { EXPORT_FAILED_MESSAGE } from './ExportMenu';
import { CSV_BOM, CSV_LINE_END } from './flowCsv';
import { CSV_MIME_TYPE, XLSX_MIME_TYPE } from './flowExport';

// The Excel module (and its library) is loaded on demand: replaced here to control it.
const xlsx = vi.hoisted(() => ({
  blob: vi.fn<(data: AnalyticsResponse) => Promise<Blob>>(),
  /** The module fails to load, like a chunk that cannot be fetched. */
  failLoad: false,
}));
// Reading the export from the module stands in for loading it: with `failLoad` it throws like
// an import of a chunk that cannot be fetched.
vi.mock('./flowXlsx', () => ({
  get flowXlsxBlob() {
    if (xlsx.failLoad) {
      throw new TypeError('Failed to fetch dynamically imported module');
    }
    return xlsx.blob;
  },
}));

const mock = setupMockApi();

/** `URL` statics replaced by the tests (jsdom has none of them), restored after each. */
const urlStatics = new Map<string, PropertyDescriptor | undefined>();

function stubUrlStatic(name: 'createObjectURL' | 'revokeObjectURL', value: unknown) {
  if (!urlStatics.has(name)) {
    urlStatics.set(name, Object.getOwnPropertyDescriptor(URL, name));
  }
  Object.defineProperty(URL, name, { value, configurable: true, writable: true });
}

let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;
let downloads: { href: string; download: string }[];

beforeEach(() => {
  xlsx.blob.mockReset();
  xlsx.failLoad = false;
  createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:flow-export');
  revokeObjectURL = vi.fn<(url: string) => void>();
  stubUrlStatic('createObjectURL', createObjectURL);
  stubUrlStatic('revokeObjectURL', revokeObjectURL);
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  for (const [name, descriptor] of urlStatics) {
    if (descriptor) {
      Object.defineProperty(URL, name, descriptor);
    } else {
      Reflect.deleteProperty(URL, name);
    }
  }
  urlStatics.clear();
});

function exportButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Export|^Exporting/ });
}

async function choose(item: string) {
  const menu = await openMenu('Export');
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }));
}

/** The file handed to the download link. */
function downloadedBlob(): Blob {
  const blob = createObjectURL.mock.calls.at(-1)?.[0];
  if (!blob) throw new Error('No file was created');
  return blob;
}

describe('Export menu', () => {
  it('offers Excel and CSV, from the keyboard', async () => {
    await renderFlowPage(mock);
    await analyticsShown();

    const menu = await openMenu('Export');

    expect(menuItemNames(menu)).toEqual(['Excel (.xlsx)', 'CSV (cards only)']);
    closeMenu(menu);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(xlsx.blob).not.toHaveBeenCalled();
  });

  it('downloads the cards as a CSV file', async () => {
    await renderFlowPage(mock);
    await analyticsShown();

    await choose('CSV (cards only)');

    expect(downloads).toEqual([
      { href: 'blob:flow-export', download: 'SB-flow-cards-2026-10-19_2026-11-17.csv' },
    ]);
    const blob = downloadedBlob();
    expect(blob.type).toBe(CSV_MIME_TYPE);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.slice(CSV_BOM.length).split(CSV_LINE_END).slice(0, 2)).toEqual([
      '"Card","Title","Completed","Lead time (days)","Cycle time (days)"',
      '"SB-1","Fix login",2026-10-22 13:05,9.4,4.1',
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:flow-export'));
    expect(xlsx.blob).not.toHaveBeenCalled();
  });

  it('loads the Excel export on demand and downloads the workbook', async () => {
    const data = analyticsWith();
    await renderFlowPage(mock, undefined, { analytics: [ok(data)] });
    await analyticsShown();
    const pending = deferred<Blob>();
    xlsx.blob.mockImplementation(() => pending.promise);

    await choose('Excel (.xlsx)');

    // Pending: the button says so, keeps the focus and cannot start another export.
    await waitFor(() => expect(exportButton()).toHaveTextContent('Exporting…'));
    expect(exportButton()).toHaveAttribute('aria-disabled', 'true');
    expect(exportButton()).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(exportButton()).toHaveFocus();
    fireEvent.keyDown(exportButton(), { key: 'Enter' });
    fireEvent.pointerDown(exportButton(), { button: 0, ctrlKey: false });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(xlsx.blob).toHaveBeenCalledTimes(1);
    expect(xlsx.blob).toHaveBeenCalledWith(data);
    expect(downloads).toEqual([]);

    await act(async () => {
      pending.resolve(new Blob(['xlsx']));
      await pending.promise;
    });

    await waitFor(() =>
      expect(downloads).toEqual([
        { href: 'blob:flow-export', download: 'SB-flow-2026-10-19_2026-11-17.xlsx' },
      ]),
    );
    expect(downloadedBlob().type).toBe(XLSX_MIME_TYPE);
    expect(exportButton()).toHaveTextContent('Export');
    expect(exportButton()).not.toHaveAttribute('aria-disabled');
    expect(exportButton()).toHaveFocus();
  });

  it('reports a failed Excel export and stays usable', async () => {
    await renderFlowPage(mock);
    await analyticsShown();
    xlsx.blob.mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'));

    await choose('Excel (.xlsx)');

    expect(await screen.findByText(EXPORT_FAILED_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(exportButton()).not.toHaveAttribute('aria-disabled'));
    expect(downloads).toEqual([]);

    xlsx.blob.mockResolvedValueOnce(new Blob(['xlsx']));
    await choose('Excel (.xlsx)');
    await waitFor(() => expect(downloads).toHaveLength(1));
  });

  it('reports an Excel module that cannot be loaded and stays usable', async () => {
    await renderFlowPage(mock);
    await analyticsShown();
    xlsx.failLoad = true;

    await choose('Excel (.xlsx)');

    expect(await screen.findByText(EXPORT_FAILED_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(exportButton()).not.toHaveAttribute('aria-disabled'));
    expect(downloads).toEqual([]);
    expect(xlsx.blob).not.toHaveBeenCalled();

    xlsx.failLoad = false;
    xlsx.blob.mockResolvedValueOnce(new Blob(['xlsx']));
    await choose('Excel (.xlsx)');
    await waitFor(() => expect(downloads).toHaveLength(1));
  });

  it('is disabled while the analytics load and without completed cards', async () => {
    const pending = deferred<MockReply>();
    await renderFlowPage(mock, undefined, { analytics: [() => pending.promise] });
    expect(exportButton()).toBeDisabled();

    pending.resolve(ok(emptyAnalytics()));
    await analyticsShown();
    expect(exportButton()).toBeDisabled();
  });
});
