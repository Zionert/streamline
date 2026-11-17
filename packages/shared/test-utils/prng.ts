import { mulberry32 } from '../src/flow/random.js';

/**
 * Small seeded pseudo-random generator (mulberry32) for deterministic randomized tests.
 * Not suitable for anything security related.
 */
export interface Prng {
  /** Float in `[0, 1)`. */
  next(): number;
  /** Integer in `[0, maxExclusive)`. */
  int(maxExclusive: number): number;
}

export function createPrng(seed: number): Prng {
  const next = mulberry32(seed);
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
  };
}
