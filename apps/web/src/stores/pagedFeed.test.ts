import { describe, expect, it } from 'vitest';

import { deferred } from '@/test/mockAdapter';

import { createPagedFeedStore, type FeedPage } from './pagedFeed';

interface Entry {
  id: string;
  createdAt: string;
  topic: string;
  updatedAt: string;
}

const at = (minute: number) => `2026-11-15T10:${String(minute).padStart(2, '0')}:00.000Z`;
const entry = (id: string, minute: number, topic = 't1'): Entry => ({
  id,
  createdAt: at(minute),
  topic,
  updatedAt: at(minute),
});

type Fetch = (scope: string, cursor: string | null) => Promise<FeedPage<Entry>>;

function feedStore(fetch: Fetch) {
  return createPagedFeedStore<Entry, string>({
    order: 'oldest-first',
    fetchPage: (scope, cursor) => fetch(scope, cursor),
    sameScope: (a, b) => a === b,
    belongs: (item, scope) => item.topic === scope,
    keepShown: (shown, received) => shown.updatedAt > received.updatedAt,
    errorMessage: () => 'failed',
  });
}

const ids = (store: ReturnType<typeof feedStore>) => store.getState().items.map((item) => item.id);

describe('paged feed store', () => {
  it('loads the first page, then the next ones, in order', async () => {
    const store = feedStore((_scope, cursor) =>
      Promise.resolve(
        cursor === null
          ? { items: [entry('a', 1), entry('b', 2)], nextCursor: 'c1' }
          : { items: [entry('c', 3)], nextCursor: null },
      ),
    );

    await store.getState().open('t1');
    expect(ids(store)).toEqual(['a', 'b']);
    expect(store.getState().nextCursor).toBe('c1');

    await store.getState().loadMore();
    expect(ids(store)).toEqual(['a', 'b', 'c']);
    expect(store.getState().nextCursor).toBeNull();
  });

  it('shows an error state when the first page fails', async () => {
    const store = feedStore(() => Promise.reject(new Error('boom')));

    await store.getState().open('t1');

    expect(store.getState()).toMatchObject({ status: 'error', error: 'failed', items: [] });
  });

  it('adds received entries once and ignores entries of other feeds', async () => {
    const store = feedStore(() => Promise.resolve({ items: [entry('a', 1)], nextCursor: null }));
    await store.getState().open('t1');

    store.getState().receive([entry('b', 2)]);
    store.getState().receive([entry('b', 2), entry('x', 3, 'other')]);

    expect(ids(store)).toEqual(['a', 'b']);
  });

  it('keeps a newer shown version over an older received one', async () => {
    const store = feedStore(() => Promise.resolve({ items: [entry('a', 1)], nextCursor: null }));
    await store.getState().open('t1');
    const edited = { ...entry('a', 1), updatedAt: at(5) };

    store.getState().receive([edited]);
    store.getState().receive([entry('a', 1)]);

    expect(store.getState().items[0]).toEqual(edited);
  });

  it('merges entries received while the first page loads', async () => {
    const page = deferred<FeedPage<Entry>>();
    const store = feedStore(() => page.promise);
    const opening = store.getState().open('t1');

    store.getState().receive([entry('late', 9)]);
    page.resolve({ items: [entry('a', 1)], nextCursor: null });
    await opening;

    expect(ids(store)).toEqual(['a', 'late']);
  });

  it('does not bring back a removed entry with a page read before the removal', async () => {
    const next = deferred<FeedPage<Entry>>();
    const store = feedStore((_scope, cursor) =>
      cursor === null
        ? Promise.resolve({ items: [entry('a', 1)], nextCursor: 'c1' })
        : next.promise,
    );
    await store.getState().open('t1');
    const loading = store.getState().loadMore();

    store.getState().remove('b');
    next.resolve({ items: [entry('b', 2), entry('c', 3)], nextCursor: null });
    await loading;

    expect(ids(store)).toEqual(['a', 'c']);
  });

  it('drops the responses of a feed closed or replaced meanwhile', async () => {
    const first = deferred<FeedPage<Entry>>();
    const store = feedStore((scope) =>
      scope === 't1'
        ? first.promise
        : Promise.resolve({ items: [entry('z', 1, 't2')], nextCursor: null }),
    );
    const opening = store.getState().open('t1');

    await store.getState().open('t2');
    first.resolve({ items: [entry('a', 1)], nextCursor: null });
    await opening;

    expect(store.getState().scope).toBe('t2');
    expect(ids(store)).toEqual(['z']);

    store.getState().close('t1');
    expect(store.getState().scope).toBe('t2');
    store.getState().close('t2');
    expect(store.getState()).toMatchObject({ scope: null, items: [], status: 'idle' });
  });

  it('reload replaces the loaded pages with a fresh first page', async () => {
    let version = 0;
    const store = feedStore(() => {
      version += 1;
      return Promise.resolve(
        version === 1
          ? { items: [entry('a', 1), entry('gone', 2)], nextCursor: null }
          : { items: [entry('a', 1), entry('new', 3)], nextCursor: null },
      );
    });
    await store.getState().open('t1');

    await store.getState().reload();

    expect(ids(store)).toEqual(['a', 'new']);
    expect(store.getState().status).toBe('ready');
  });
});
