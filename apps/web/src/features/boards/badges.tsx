import type { BoardRole, ColumnCategory } from '@streamline/shared';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { CATEGORY_LABELS, ROLE_LABELS } from './labels';

export function RoleBadge({ role }: { role: BoardRole }) {
  return <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>;
}

const CATEGORY_DOT_STYLES: Readonly<Record<ColumnCategory, string>> = {
  BACKLOG: 'bg-subtle',
  TODO: 'bg-primary',
  IN_PROGRESS: 'bg-warning',
  DONE: 'bg-success',
};

/** Small coloured dot next to the column name; the category is also announced as text. */
export function CategoryDot({ category }: { category: ColumnCategory }) {
  const label = CATEGORY_LABELS[category];
  return (
    <span className="inline-flex shrink-0 items-center" title={`Category: ${label}`}>
      <span
        aria-hidden="true"
        data-category={category}
        className={cn('size-2 rounded-full', CATEGORY_DOT_STYLES[category])}
      />
      <span className="sr-only">Category: {label}</span>
    </span>
  );
}

/**
 * Card counter of a column: "(n)", or "(n / limit)" with a WIP limit; shown in the danger
 * colour once the limit is exceeded.
 */
export function ColumnCounter({ count, limit }: { count: number; limit: number | null }) {
  if (limit === null) {
    return (
      <span className="shrink-0 text-xs font-semibold text-subtle" aria-label={`${count} cards`}>
        <span aria-hidden="true">({count})</span>
        <span className="sr-only">{count} cards</span>
      </span>
    );
  }
  const exceeded = count > limit;
  const description = `WIP ${count} of ${limit}${exceeded ? ', limit exceeded' : ''}`;
  return (
    <span
      data-wip-exceeded={exceeded || undefined}
      className={cn(
        'shrink-0 text-xs font-semibold',
        exceeded ? 'text-destructive' : 'text-subtle',
      )}
      aria-label={description}
    >
      <span aria-hidden="true">
        ({count} / {limit})
      </span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
