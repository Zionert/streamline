import type { LabelColor } from '@streamline/shared';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

import { LABEL_COLOR_NAMES, labelColorStyle, labelDotStyle } from './labelColors';

interface LabelPillProps extends Omit<ComponentProps<'span'>, 'children' | 'color'> {
  name: string;
  color: LabelColor;
  size?: 'sm' | 'md';
}

/** A label as a small coloured pill; long names are truncated (the full name is the tooltip). */
export function LabelPill({
  name,
  color,
  size = 'md',
  className,
  style,
  ...props
}: LabelPillProps) {
  return (
    <span
      data-label-color={color}
      title={`${name} (${LABEL_COLOR_NAMES[color]})`}
      className={cn(
        'inline-block max-w-full min-w-0 truncate rounded-sm font-medium',
        size === 'sm' ? 'h-4 max-w-24 px-1 text-xs leading-4' : 'h-5 px-2 text-xs leading-5',
        className,
      )}
      style={{ ...labelColorStyle(color), ...style }}
      {...props}
    >
      {name}
    </span>
  );
}

/** A label on a card tile: a 7 px dot in the label's colour and its name. */
export function LabelDot({ name, color }: { name: string; color: LabelColor }) {
  return (
    <span
      data-testid="card-label"
      title={`${name} (${LABEL_COLOR_NAMES[color]})`}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-subtle"
    >
      <span
        aria-hidden="true"
        data-label-color={color}
        className="size-[7px] shrink-0 rounded-full"
        style={labelDotStyle(color)}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A colour sample (e.g. in pickers); decorative unless given an accessible name. */
export function LabelSwatch({
  color,
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'children' | 'color'> & { color: LabelColor }) {
  return (
    <span
      data-label-color={color}
      className={cn('inline-block size-4 shrink-0 rounded-sm border border-border', className)}
      style={labelColorStyle(color)}
      {...props}
    />
  );
}
