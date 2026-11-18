import type { AnalyticsResponse } from '@streamline/shared';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { formatCount, formatDays } from './flowFormat';
import { completedCount } from './flowMetrics';

/** Key figures of the range: completed cards, cycle and lead time p85, work in progress. */
export function KpiRow({
  analytics,
  rangeCaption,
}: {
  analytics: AnalyticsResponse;
  /** The selected range in running text, e.g. `last 30 days`. */
  rangeCaption: string;
}) {
  const { cycleTime, leadTime } = analytics.leadCycle;
  const inProgress = analytics.aging.items.length;
  const aging = analytics.aging.items.filter((item) => item.isAging).length;

  return (
    <dl
      aria-label="Key figures"
      className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:px-6"
    >
      <KpiTile
        label="Completed"
        value={formatCount(completedCount(analytics.throughput))}
        caption={rangeCaption}
      />
      <KpiTile
        label="Cycle time p85"
        value={formatDays(cycleTime.p85)}
        caption={`p50 ${formatDays(cycleTime.p50)}`}
      />
      <KpiTile
        label="Lead time p85"
        value={formatDays(leadTime.p85)}
        caption={`p50 ${formatDays(leadTime.p50)}`}
      />
      <KpiTile
        label="In progress"
        value={formatCount(inProgress)}
        caption={<span className={cn(aging > 0 && 'text-warning-text')}>{aging} aging</span>}
      />
    </dl>
  );
}

function KpiTile({ label, value, caption }: { label: string; value: string; caption: ReactNode }) {
  return (
    <div
      data-testid="kpi-tile"
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface p-4"
    >
      <dt className="font-mono text-[11px] text-muted uppercase">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-xs text-subtle tabular-nums">{caption}</dd>
    </div>
  );
}
