/**
 * Pure helpers for lists that grow page by page and through live events (comments, activity).
 * Entries are identified by `id` and ordered by `(createdAt, id)` — the server's keyset order —
 * so a page, an event and a response describing the same entry always end up as one item in the
 * right place, whatever order they arrive in.
 */

export interface FeedEntry {
  id: string;
  createdAt: string;
}

export type FeedOrder = 'oldest-first' | 'newest-first';

function compareEntries(a: FeedEntry, b: FeedEntry): number {
  // ISO timestamps of the same format compare correctly as strings.
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merges `incoming` into `items`: unknown entries are added, known ones replaced (unless
 * `keepShown` says the shown version is newer), and the result is sorted in `order`. Idempotent.
 */
export function mergeFeed<T extends FeedEntry>(
  items: readonly T[],
  incoming: readonly T[],
  order: FeedOrder,
  keepShown: (shown: T, received: T) => boolean = () => false,
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const entry of incoming) {
    const shown = byId.get(entry.id);
    if (!shown || !keepShown(shown, entry)) {
      byId.set(entry.id, entry);
    }
  }
  const merged = [...byId.values()].sort(compareEntries);
  return order === 'oldest-first' ? merged : merged.reverse();
}

/** The list without the entry (the same list when it is not there). */
export function removeFromFeed<T extends FeedEntry>(items: readonly T[], id: string): readonly T[] {
  return items.some((item) => item.id === id) ? items.filter((item) => item.id !== id) : items;
}
