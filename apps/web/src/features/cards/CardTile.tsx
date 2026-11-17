import type { Card, Label } from '@streamline/shared';
import type { ComponentProps, KeyboardEvent } from 'react';

import { Avatar, type AvatarStackPerson } from '@/components/ui/avatar';
import { LabelDot } from '@/features/labels/LabelPill';
import { cn } from '@/lib/utils';

import { cardTileLabel, isMarkedPriority } from './cardLabels';
import { PriorityFlag } from './priority';

export interface CardTileProps extends Omit<ComponentProps<'div'>, 'children' | 'onClick'> {
  card: Card;
  /** The assigned member, `null` when the card is unassigned (or the member is unknown). */
  assignee: AvatarStackPerson | null;
  /** The card's labels (resolved from `card.labelIds`), in the card's order. */
  labels?: readonly Label[];
  /** Opens the card details (click or Enter). */
  onOpen: () => void;
  /** Drag handle props were spread on the tile: Space lifts the card instead of opening it. */
  isDraggable?: boolean;
  /** The card is being dragged right now. */
  isDragging?: boolean;
}

const NO_LABELS: readonly Label[] = [];

/**
 * A card on the board: title (two lines at most); labels (dot and name) and key; the priority
 * (HIGH and URGENT only) and the assignee. The whole tile is a button that opens the details and
 * announces all of it (including LOW and MEDIUM priorities); when draggable it is also the drag
 * handle.
 */
export function CardTile({
  card,
  assignee,
  labels = NO_LABELS,
  onOpen,
  isDraggable = false,
  isDragging = false,
  className,
  ...props
}: CardTileProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isDragging) {
      return;
    }
    if (event.key === 'Enter' || (!isDraggable && event.key === ' ')) {
      event.preventDefault();
      onOpen();
    }
  };
  const hasThirdRow = isMarkedPriority(card.priority) || assignee !== null;

  return (
    <div
      role="button"
      tabIndex={0}
      {...props}
      aria-label={cardTileLabel(
        card,
        assignee?.name ?? null,
        labels.map((label) => label.name),
      )}
      data-card-key={card.key}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex cursor-pointer flex-col gap-2.5 rounded-lg border border-border bg-surface p-3 text-left shadow-card transition-[border-color,box-shadow,rotate] outline-none select-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        isDragging && 'rotate-1 border-primary shadow-raised hover:border-primary',
        className,
      )}
    >
      <p data-testid="card-title" className="line-clamp-2 text-sm font-medium break-words">
        {card.title}
      </p>
      <div className="flex items-start gap-2">
        {labels.length > 0 && (
          <span
            data-testid="card-labels"
            className="flex min-w-0 flex-1 flex-wrap gap-x-2.5 gap-y-1"
          >
            {labels.map((label) => (
              <LabelDot key={label.id} name={label.name} color={label.color} />
            ))}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-xs leading-4 text-subtle">{card.key}</span>
      </div>
      {hasThirdRow && (
        <div className="flex min-h-[22px] items-center gap-2">
          <PriorityFlag priority={card.priority} />
          {assignee && (
            <Avatar userId={assignee.userId} name={assignee.name} size="xs" className="ml-auto" />
          )}
        </div>
      )}
    </div>
  );
}
