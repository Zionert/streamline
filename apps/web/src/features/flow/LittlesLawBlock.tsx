import type { AnalyticsResponse } from '@streamline/shared';
import { useId } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { NO_VALUE, formatDays, formatDecimal, formatSignedPercent } from './flowFormat';
import { LITTLES_LAW_MESSAGES, littlesLawVerdict } from './flowMetrics';

/**
 * Little's law check: the measured average work in progress against the one predicted from
 * throughput and cycle time, with a plain-language verdict.
 */
export function LittlesLawBlock({ law }: { law: AnalyticsResponse['littlesLaw'] }) {
  const titleId = useId();
  const verdict = littlesLawVerdict(law);
  const predicted = law.predictedWip === null ? NO_VALUE : formatDecimal(law.predictedWip);

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        Little&apos;s law
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="font-mono text-sm tabular-nums" data-testid="littles-law-equation">
          Avg WIP {formatDecimal(law.avgWip)} ≈ {formatDecimal(law.avgThroughputPerDay)} / day ×{' '}
          {formatDays(law.avgCycleTimeDays)} = {predicted}
        </p>
        {verdict !== 'unknown' && law.relativeError !== null && (
          <Badge
            data-testid="littles-law-gap"
            className={cn(verdict === 'stable' ? 'text-subtle' : 'text-warning-text')}
          >
            <span className="sr-only">Difference: </span>
            {formatSignedPercent(law.relativeError)}
          </Badge>
        )}
      </div>
      <p className="text-sm" data-verdict={verdict}>
        {LITTLES_LAW_MESSAGES[verdict]}
      </p>
      <p className="text-xs text-subtle">
        Little&apos;s law: average work in progress ≈ throughput × average cycle time. A large gap
        means the system is not stable.
      </p>
    </section>
  );
}
