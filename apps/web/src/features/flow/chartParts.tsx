import type { ReactNode } from 'react';

import type { ChartColors } from './useChartColors';

/** Box of a tooltip, drawn with the resolved theme colours. */
export function TooltipBox({ colors, children }: { colors: ChartColors; children: ReactNode }) {
  return (
    <div
      className="max-w-64 rounded-md border px-2.5 py-2 font-sans text-xs shadow-[var(--shadow-raised)]"
      style={{
        backgroundColor: colors.surfaceRaised,
        borderColor: colors.borderStrong,
        color: colors.text,
      }}
    >
      {children}
    </div>
  );
}

/** Dot and name of a series, e.g. in a legend. */
export function SeriesSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-subtle">
      <span
        aria-hidden="true"
        className="inline-block size-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
