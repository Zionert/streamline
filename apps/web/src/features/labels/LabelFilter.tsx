import type { Label } from '@streamline/shared';
import { Tag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { LabelPill } from './LabelPill';

interface LabelFilterProps {
  labels: readonly Label[];
  /** Labels whose cards are shown (all cards when empty). */
  selectedIds: ReadonlySet<string>;
  onToggle: (labelId: string) => void;
}

/** Toolbar filter by label: a multi-select list; a card with any selected label is shown. */
export function LabelFilter({ labels, selectedIds, onToggle }: LabelFilterProps) {
  const count = selectedIds.size;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={count > 0 ? 'subtle' : 'ghost'}
          size="sm"
          aria-label={count > 0 ? `Filter by label, ${String(count)} selected` : 'Filter by label'}
          className={cn(count === 0 && 'text-subtle')}
        >
          <Tag strokeWidth={2} />
          Labels
          {count > 0 && (
            <span
              aria-hidden="true"
              className="rounded-sm bg-primary px-1 font-mono text-xs leading-4 text-primary-foreground"
            >
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        {labels.length === 0 ? (
          <p className="text-sm text-subtle">This board has no labels yet.</p>
        ) : (
          <ul
            aria-label="Filter by label"
            className="flex max-h-72 flex-col gap-1.5 overflow-y-auto"
          >
            {labels.map((label) => {
              const id = `filter-label-${label.id}`;
              return (
                <li key={label.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    aria-label={label.name}
                    checked={selectedIds.has(label.id)}
                    onCheckedChange={() => onToggle(label.id)}
                  />
                  <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer">
                    <LabelPill name={label.name} color={label.color} />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
