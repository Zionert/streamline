import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { mergeFeed, removeFromFeed, type FeedEntry, type FeedOrder } from '@/lib/feed';

export type FeedStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FeedPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export interface PagedFeedState<T extends FeedEntry, S> {
  /** What the feed is about (e.g. a card); `null` while no feed is shown. */
  scope: S | null;
  items: readonly T[];
  /** Cursor of the next page; `null` on the last page. */
  nextCursor: string | null;
  status: FeedStatus;
  /** Message of the failed first load (`status: 'error'`) or of the failed next page. */
  error: string | null;
  isLoadingMore: boolean;

  /** Shows the feed of `scope` from its first page (any other feed is dropped). */
  open: (scope: S) => Promise<void>;
  /** Stops showing the feed of `scope`; ignored when another feed is shown. */
  close: (scope: S) => void;
  /**
   * Loads the first page again and shows it instead of the loaded pages (e.g. after live events
   * may have been missed); never rejects. Entries received meanwhile are kept.
   */
  reload: () => Promise<void>;
  /** Loads the next page; never rejects (a failure sets `error`). */
  loadMore: () => Promise<void>;
  /**
   * Adds new entries and replaces known ones unless the shown version is newer. Entries that do
   * not belong to the shown feed, and entries removed before, are ignored.
   */
  receive: (entries: readonly T[]) => void;
  /** Replaces a shown entry whatever its version (an optimistic change or its rollback). */
  replace: (entry: T) => void;
  /** Removes the entry for good: a page read before the removal does not bring it back. */
  remove: (id: string) => void;
  reset: () => void;
}

export interface PagedFeedOptions<T extends FeedEntry, S> {
  order: FeedOrder;
  fetchPage: (scope: S, cursor: string | null) => Promise<FeedPage<T>>;
  sameScope: (a: S, b: S) => boolean;
  /** Whether an entry belongs to the feed of `scope` (e.g. a comment of that card). */
  belongs: (entry: T, scope: S) => boolean;
  /** Whether the shown version is newer than a received one (it is then kept). */
  keepShown?: (shown: T, received: T) => boolean;
  errorMessage: (error: unknown) => string;
}

/**
 * A store for one list loaded page by page and updated by live events (comments of a card, an
 * activity feed). Responses of a feed that is no longer shown, or of a superseded load, are
 * dropped; entries received while the first page is loading are merged into it.
 */
export function createPagedFeedStore<T extends FeedEntry, S>(
  options: PagedFeedOptions<T, S>,
): UseBoundStore<StoreApi<PagedFeedState<T, S>>> {
  const { order, fetchPage, sameScope, belongs, errorMessage } = options;
  const keepShown = options.keepShown ?? (() => false);

  /** Incremented whenever the shown feed changes (open, close, reset). */
  let scopeGeneration = 0;
  /** Incremented by every first-page load; a next page started before it is dropped. */
  let loadGeneration = 0;
  /** Entries received while a first page is loading (merged into it), or `null`. */
  let receivedDuringLoad: T[] | null = null;
  /** Ids removed from the shown feed. */
  let removedIds = new Set<string>();

  const empty = {
    scope: null,
    items: [],
    nextCursor: null,
    status: 'idle',
    error: null,
    isLoadingMore: false,
  } as const satisfies Partial<PagedFeedState<T, S>>;

  return create<PagedFeedState<T, S>>()((set, get) => {
    const visible = (entries: readonly T[]) => entries.filter((entry) => !removedIds.has(entry.id));

    async function loadFirstPage() {
      const { scope } = get();
      if (scope === null) {
        return;
      }
      const scopeAtStart = scopeGeneration;
      const load = ++loadGeneration;
      const isLatest = () => scopeAtStart === scopeGeneration && load === loadGeneration;
      receivedDuringLoad = [];
      set((state) => ({
        isLoadingMore: false,
        ...(state.status === 'ready' ? {} : { status: 'loading', error: null }),
      }));
      try {
        const page = await fetchPage(scope, null);
        if (!isLatest()) {
          return;
        }
        const received = receivedDuringLoad;
        receivedDuringLoad = null;
        set({
          items: mergeFeed(visible(page.items), visible(received), order, keepShown),
          nextCursor: page.nextCursor,
          status: 'ready',
          error: null,
        });
      } catch (error) {
        if (!isLatest()) {
          return;
        }
        receivedDuringLoad = null;
        // A failed refresh keeps the entries shown; a failed first load is an error state.
        set((state) =>
          state.status === 'ready' ? {} : { status: 'error', error: errorMessage(error) },
        );
      }
    }

    return {
      ...empty,

      open: async (scope) => {
        scopeGeneration += 1;
        receivedDuringLoad = null;
        removedIds = new Set();
        set({ ...empty, scope, status: 'loading' });
        await loadFirstPage();
      },

      close: (scope) => {
        const shown = get().scope;
        if (shown !== null && sameScope(shown, scope)) {
          get().reset();
        }
      },

      reload: () => loadFirstPage(),

      loadMore: async () => {
        const { scope, nextCursor, status, isLoadingMore } = get();
        if (scope === null || nextCursor === null || status !== 'ready' || isLoadingMore) {
          return;
        }
        const scopeAtStart = scopeGeneration;
        const load = loadGeneration;
        const isLatest = () => scopeAtStart === scopeGeneration && load === loadGeneration;
        set({ isLoadingMore: true, error: null });
        try {
          const page = await fetchPage(scope, nextCursor);
          if (isLatest()) {
            set((state) => ({
              items: mergeFeed(state.items, visible(page.items), order, keepShown),
              nextCursor: page.nextCursor,
              isLoadingMore: false,
            }));
          }
        } catch (error) {
          if (isLatest()) {
            set({ isLoadingMore: false, error: errorMessage(error) });
          }
        }
      },

      receive: (entries) => {
        const { scope } = get();
        if (scope === null) {
          return;
        }
        const accepted = visible(entries.filter((entry) => belongs(entry, scope)));
        if (accepted.length === 0) {
          return;
        }
        receivedDuringLoad?.push(...accepted);
        set((state) => ({ items: mergeFeed(state.items, accepted, order, keepShown) }));
      },

      replace: (entry) => {
        set((state) =>
          state.items.some((item) => item.id === entry.id)
            ? { items: state.items.map((item) => (item.id === entry.id ? entry : item)) }
            : {},
        );
      },

      remove: (id) => {
        if (get().scope === null) {
          return;
        }
        removedIds.add(id);
        set((state) => ({ items: removeFromFeed(state.items, id) }));
      },

      reset: () => {
        scopeGeneration += 1;
        receivedDuringLoad = null;
        removedIds = new Set();
        set(empty);
      },
    };
  });
}
