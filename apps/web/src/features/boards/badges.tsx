import type { BoardRole, ColumnCategory } from '@streamline/shared';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { CATEGORY_LABELS, ROLE_LABELS } from './labels';

export function RoleBadge({ role }: { role: BoardRole }) {
  return <Badge>{ROLE_LABELS[role]}</Badge>;
}

const CATEGORY_LINE_STYLES: Readonly<Record<ColumnCategory, string>> = {
  BACKLOG: 'bg-cat-backlog',
  TODO: 'bg-cat-todo',
  IN_PROGRESS: 'bg-cat-progress',
  DONE: 'bg-cat-done',
};

/**
 * The 2 px line under a column header in the colour of the column's category (the danger colour
 * once the WIP limit is exceeded); the category is also announced as text.
 */
export function CategoryLine({
  category,
  exceeded = false,
}: {
  category: ColumnCategory;
  exceeded?: boolean;
}) {
  const label = CATEGORY_LABELS[category];
  return (
    <div
      data-testid="category-line"
      data-category={category}
      title={`Category: ${label}`}
      className={cn(
        'relative h-0.5 shrink-0 rounded-full',
        exceeded ? 'bg-danger' : CATEGORY_LINE_STYLES[category],
      )}
    >
      <span className="sr-only">Category: {label}</span>
    </div>
  );
}

/**
 * Card counter of a column: "n", or "n / limit" with a WIP limit; shown in the danger colour
 * once the limit is exceeded.
 */
export function ColumnCounter({ count, limit }: { count: number; limit: number | null }) {
  if (limit === null) {
    return (
      <span className="shrink-0 font-mono text-xs text-subtle" aria-label={`${count} cards`}>
        <span aria-hidden="true">{count}</span>
        <span className="sr-only">{count} cards</span>
      </span>
    );
  }
  const exceeded = count > limit;
  const description = `WIP ${count} of ${limit}${exceeded ? ', limit exceeded' : ''}`;
  return (
    <span
      data-wip-exceeded={exceeded || undefined}
      className={cn('shrink-0 font-mono text-xs', exceeded ? 'text-destructive' : 'text-subtle')}
      aria-label={description}
    >
      <span aria-hidden="true">
        {count} / {limit}
      </span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
