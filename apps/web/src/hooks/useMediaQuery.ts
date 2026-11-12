import { useCallback, useSyncExternalStore } from 'react';

/** Below this width the board sidebar starts collapsed. */
export const NARROW_SCREEN_QUERY = '(max-width: 1023px)';
/** Below this width the board sidebar becomes an overlay drawer. */
export const MOBILE_SCREEN_QUERY = '(max-width: 767px)';

export function matchesMediaQuery(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Whether the media query currently matches; re-renders when that changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') {
        return () => {};
      }
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchesMediaQuery(query));
}
