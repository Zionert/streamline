import type { CardPriority } from '@streamline/shared';
import { ChevronsUp, Flag } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PRIORITY_LABELS, isMarkedPriority, type MarkedPriority } from './cardLabels';

/** Colours of the marked priorities (exactly those of `MARKED_PRIORITIES`). */
const MARKED_PRIORITY_STYLES: Readonly<Record<MarkedPriority, string>> = {
  HIGH: 'text-warning-text',
  // Error red, set apart further by the extra chevrons.
  URGENT: 'text-destructive',
};

interface PriorityFlagProps {
  priority: CardPriority;
  /** Shows the priority name next to the flag; without it the flag is decorative. */
  showLabel?: boolean;
}

/**
 * A 14 px flag in the colour of the priority and its name, for HIGH and URGENT only (URGENT adds
 * chevrons); renders nothing for LOW and MEDIUM.
 */
export function PriorityFlag({ priority, showLabel = true }: PriorityFlagProps) {
  if (!isMarkedPriority(priority)) {
    return null;
  }
  const style = MARKED_PRIORITY_STYLES[priority];
  const name = PRIORITY_LABELS[priority];
  return (
    <span
      data-priority={priority}
      title={`Priority: ${name}`}
      aria-hidden={showLabel ? undefined : true}
      className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', style)}
    >
      <Flag aria-hidden="true" className="size-3.5" fill="currentColor" strokeWidth={2} />
      {priority === 'URGENT' && (
        <ChevronsUp aria-hidden="true" className="-ml-1 size-3.5" strokeWidth={2.5} />
      )}
      {showLabel && <span>{name}</span>}
    </span>
  );
}
