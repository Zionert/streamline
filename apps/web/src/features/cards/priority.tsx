import type { CardPriority } from '@streamline/shared';
import { ChevronsUp, Flag } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PRIORITY_LABELS } from './cardLabels';

const PRIORITY_STYLES: Readonly<Record<CardPriority, string>> = {
  LOW: 'text-success',
  MEDIUM: 'text-warning',
  HIGH: 'text-danger',
  // The darker red of error text; set apart further by the extra chevrons.
  URGENT: 'text-destructive',
};

/** Filled flag in the colour of the priority (URGENT adds chevrons); announced as text. */
export function PriorityFlag({ priority }: { priority: CardPriority }) {
  const label = `Priority: ${PRIORITY_LABELS[priority]}`;
  return (
    <span
      data-priority={priority}
      title={label}
      className={cn('inline-flex shrink-0 items-center', PRIORITY_STYLES[priority])}
    >
      <Flag aria-hidden="true" className="size-4" fill="currentColor" strokeWidth={2} />
      {priority === 'URGENT' && (
        <ChevronsUp aria-hidden="true" className="-ml-0.5 size-4" strokeWidth={2.5} />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
