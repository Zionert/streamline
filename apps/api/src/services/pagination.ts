import { encodePageCursor } from '@streamline/shared';

export interface Page<T> {
  items: T[];
  /** Cursor of the last returned row; `null` when there are no more rows. */
  nextCursor: string | null;
}

/**
 * Cuts the `limit + 1` rows read by a keyset query down to one page: the extra row only tells
 * that another page exists, and the cursor names the last row of this page.
 */
export function toPage<T extends { createdAt: Date; id: string }>(
  rows: readonly T[],
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodePageCursor(last) : null,
  };
}
