import { useMediaQuery } from '@/lib/useMediaQuery';

import { MAX_TICKS_NARROW, MAX_TICKS_WIDE } from './dateTicks';

/** Most X axis ticks that fit the charts on this screen (fewer below 640 px). */
export function useMaxTicks(): number {
  return useMediaQuery('(max-width: 639px)') ? MAX_TICKS_NARROW : MAX_TICKS_WIDE;
}
