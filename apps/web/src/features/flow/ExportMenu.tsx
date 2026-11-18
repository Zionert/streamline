import type { AnalyticsResponse } from '@streamline/shared';
import { ChevronDown, Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { downloadFile } from './download';
import { flowCsv } from './flowCsv';
import { CSV_MIME_TYPE, XLSX_MIME_TYPE, flowCsvFileName, flowXlsxFileName } from './flowExport';

export const EXPORT_FAILED_MESSAGE = 'Could not export the file. Try again.';

/** Toast id of a failed export: a new failure replaces the previous message. */
const EXPORT_TOAST_ID = 'flow-export-failed';

interface ExportMenuProps {
  boardKey: string;
  /** The analytics shown; `null` disables the menu (loading, error, or nothing completed). */
  data: AnalyticsResponse | null;
}

/**
 * "Export" menu of the Flow page: the analytics shown as an Excel workbook (cards and daily
 * throughput, loaded on demand with its library) or the cards as a CSV file.
 */
export function ExportMenu({ boardKey, data }: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const exportCsv = () => {
    if (!data) {
      return;
    }
    downloadFile(
      flowCsvFileName(boardKey, data.range),
      new Blob([flowCsv(data)], { type: CSV_MIME_TYPE }),
    );
  };

  const exportXlsx = async () => {
    if (!data || isExporting) {
      return;
    }
    setIsExporting(true);
    try {
      const { flowXlsxBlob } = await import('./flowXlsx');
      const workbook = await flowXlsxBlob(data);
      downloadFile(
        flowXlsxFileName(boardKey, data.range),
        new Blob([workbook], { type: XLSX_MIME_TYPE }),
      );
    } catch {
      toast.error(EXPORT_FAILED_MESSAGE, { id: EXPORT_TOAST_ID });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    // While exporting, the trigger is only aria-disabled (and does not open the menu): a disabled
    // button could not take the focus back when the menu closes.
    <DropdownMenu open={isOpen} onOpenChange={(open) => setIsOpen(open && !isExporting)}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="subtle"
          size="sm"
          disabled={data === null}
          aria-disabled={isExporting || undefined}
          aria-busy={isExporting || undefined}
          className={cn(isExporting && 'cursor-progress opacity-70 hover:bg-surface-hover')}
        >
          <Download strokeWidth={2} />
          {isExporting ? 'Exporting…' : 'Export'}
          <ChevronDown aria-hidden="true" strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isExporting} onSelect={() => void exportXlsx()}>
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportCsv}>CSV (cards only)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
