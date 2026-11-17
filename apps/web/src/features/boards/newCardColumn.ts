import type { Column } from '@streamline/shared';

/**
 * The column the "New card" button adds to: the first column of category TODO, otherwise the
 * first column; `null` on a board without columns. `columns` must be in rank order.
 */
export function newCardColumn(columns: readonly Column[]): Column | null {
  return columns.find((column) => column.category === 'TODO') ?? columns[0] ?? null;
}
