/** Source of uniformly distributed floats in `[0, 1)`, like `Math.random`. */
export type RandomSource = () => number;

/**
 * Small seeded pseudo-random generator (mulberry32) for reproducible simulations and tests.
 * Not suitable for anything security related.
 */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
