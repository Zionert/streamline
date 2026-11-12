type ChangeListener = (event: MediaQueryListEvent) => void;

const matchingQueries = new Set<string>();
const listeners = new Map<string, Set<ChangeListener>>();

function listenersOf(query: string): Set<ChangeListener> {
  let set = listeners.get(query);
  if (!set) {
    set = new Set();
    listeners.set(query, set);
  }
  return set;
}

/**
 * Minimal `window.matchMedia` for jsdom. Queries match only when enabled with `setMediaQuery`;
 * by default nothing matches (a wide desktop screen with a light system theme).
 */
export function matchMediaStub(query: string): MediaQueryList {
  const list: MediaQueryList = {
    get matches() {
      return matchingQueries.has(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listenersOf(query).add(listener as ChangeListener);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listenersOf(query).delete(listener as ChangeListener);
    },
    addListener: (listener) => {
      if (listener) {
        listenersOf(query).add(listener as ChangeListener);
      }
    },
    removeListener: (listener) => {
      if (listener) {
        listenersOf(query).delete(listener as ChangeListener);
      }
    },
    dispatchEvent: () => true,
  };
  return list;
}

/** Makes `query` match (or stop matching) and notifies its change listeners. */
export function setMediaQuery(query: string, matches: boolean): void {
  if (matches === matchingQueries.has(query)) {
    return;
  }
  if (matches) {
    matchingQueries.add(query);
  } else {
    matchingQueries.delete(query);
  }
  const event = { matches, media: query } as MediaQueryListEvent;
  for (const listener of [...listenersOf(query)]) {
    listener(event);
  }
}

export function resetMediaQueries(): void {
  matchingQueries.clear();
  listeners.clear();
}
