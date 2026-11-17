import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChartCardProps {
  title: string;
  /** One line under the title. */
  description: string;
  /** Controls next to "View data" (e.g. a granularity toggle). */
  controls?: ReactNode;
  /** The chart; it fills the plot area (260 px high, 220 px below 640 px). */
  children: ReactNode;
  /** Notes and the legend under the chart. */
  footer?: ReactNode;
  /** Accessible table with the data of the chart, shown with "View data". */
  table: ReactNode;
  className?: string;
}

/**
 * A chart in a card: a `figure` captioned by the title row, with a "View data" disclosure that
 * reveals the same data as a table (the keyboard and screen reader path through the chart).
 */
export function ChartCard({
  title,
  description,
  controls,
  children,
  footer,
  table,
  className,
}: ChartCardProps) {
  const [showData, setShowData] = useState(false);
  const titleId = useId();
  const tableId = useId();

  return (
    <figure
      aria-labelledby={titleId}
      className={cn(
        'm-0 flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4',
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <p className="text-xs text-subtle">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showData}
            aria-controls={tableId}
            onClick={() => setShowData((shown) => !shown)}
          >
            View data
            <ChevronDown
              aria-hidden="true"
              strokeWidth={2}
              className={cn('transition-transform', showData && 'rotate-180')}
            />
          </Button>
        </div>
      </figcaption>
      <div className="h-[220px] min-w-0 sm:h-[260px]">{children}</div>
      {footer}
      <div id={tableId} hidden={!showData} className="max-h-80 overflow-auto">
        {showData && table}
      </div>
    </figure>
  );
}

/** Table of chart data: compact, with a visually hidden caption. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-left text-xs tabular-nums [&_td]:border-t [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-mono [&_th]:text-[11px] [&_th]:font-normal [&_th]:text-muted [&_th]:uppercase">
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
  );
}
