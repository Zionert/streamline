import type { Card } from '@streamline/shared';
import { SquareCheck } from 'lucide-react';
import type { ComponentProps, KeyboardEvent } from 'react';

import { Avatar, type AvatarStackPerson } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { cardTileLabel } from './cardLabels';
import { PriorityFlag } from './priority';

export interface CardTileProps extends Omit<ComponentProps<'div'>, 'children' | 'onClick'> {
  card: Card;
  /** The assigned member, `null` when the card is unassigned (or the member is unknown). */
  assignee: AvatarStackPerson | null;
  /** Opens the card details (click or Enter). */
  onOpen: () => void;
  /** Drag handle props were spread on the tile: Space lifts the card instead of opening it. */
  isDraggable?: boolean;
  /** The card is being dragged right now. */
  isDragging?: boolean;
}

/**
 * A card on the board: title (two lines at most), key, priority and assignee. The whole tile is
 * a button that opens the details; when draggable it is also the drag handle.
 */
export function CardTile({
  card,
  assignee,
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

  return (
    <div
      role="button"
      tabIndex={0}
      {...props}
      aria-label={cardTileLabel(card, assignee?.name ?? null)}
      data-card-key={card.key}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex cursor-pointer flex-col gap-3 rounded-md bg-surface p-3 text-left shadow-card transition-[background-color,box-shadow,rotate] outline-none select-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary',
        isDragging && 'rotate-2 shadow-raised',
        className,
      )}
    >
      <p data-testid="card-title" className="line-clamp-2 text-sm font-medium break-words">
        {card.title}
      </p>
      <div className="flex min-h-6 items-center gap-2">
        <SquareCheck aria-hidden="true" className="size-4 shrink-0 text-primary" strokeWidth={2} />
        <span className="text-xs font-semibold text-subtle">{card.key}</span>
        <span className="ml-auto flex items-center gap-2">
          <PriorityFlag priority={card.priority} />
          {assignee && <Avatar userId={assignee.userId} name={assignee.name} size="sm" />}
        </span>
      </div>
    </div>
  );
}
