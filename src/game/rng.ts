// Seedable, purely-functional PRNG (Mulberry32).
//
// The generator state is a single 32-bit integer that lives IN GameState, never
// in a closure. Every draw returns both the value and the advanced state so the
// caller threads it back into the next state - this is what makes replays from a
// seed fully deterministic. No Math.random, no globals.

/** A single draw: a value in [0, 1) plus the advanced generator state. */
export interface RandomDraw {
  readonly value: number;
  readonly state: number;
}

/** Normalize an arbitrary seed into a valid 32-bit generator state. */
export function seedRng(seed: number): number {
  return seed | 0;
}

/**
 * Advance the Mulberry32 generator once.
 * @param state current 32-bit generator state
 * @returns the next value in [0, 1) and the advanced state
 */
export function nextRandom(state: number): RandomDraw {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: a };
}

/**
 * Draw an integer in [0, bound) (bound must be a positive integer).
 * @returns the integer and the advanced generator state
 */
export function nextInt(state: number, bound: number): { value: number; state: number } {
  const draw = nextRandom(state);
  return { value: Math.floor(draw.value * bound), state: draw.state };
}
