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

export interface ReferenceLegendItem {
  key: string;
  /** E.g. `p85 · 8.3 d` or `avg 0.9 / day`. */
  label: string;
  /** Colour of the dashed line in the chart. */
  lineColor: string;
  /** Colour of the label (text needs 4.5:1, so it may differ from the line). */
  textColor: string;
}

/**
 * Names of the dashed reference lines, in a row above the plot rather than inside it, so they
 * never cover the data or each other.
 */
export function ReferenceLegend({ items }: { items: readonly ReferenceLegendItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Reference lines" className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <li
          key={item.key}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums"
          style={{ color: item.textColor }}
        >
          <svg aria-hidden="true" width="16" height="2" className="shrink-0 overflow-visible">
            <line
              x1="0"
              y1="1"
              x2="16"
              y2="1"
              stroke={item.lineColor}
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
