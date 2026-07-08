// Fixed-timestep accumulator math for the game loop (PRD R7).
//
// The render layer runs on requestAnimationFrame (display refresh, variable
// cadence), but the pure game logic must advance at a fixed rate so gameplay
// speed is independent of frame rate. This module holds the tiny, pure step
// math so it can be unit-tested without a DOM or a running clock; main.ts owns
// only the thin rAF shell that feeds real frame deltas into it.

/**
 * Logic ticks per real second. The per-skill cadence constants in
 * src/game/constants.ts (baseTicksPerStep 45 / 30 / 18) are expressed in these
 * ticks, so this rate is what turns them into wall-clock speed. At 60 Hz the
 * squadron steps roughly 1.3 (skill 1) to 3.3 (skill 3) times per second and a
 * fired missile crosses the field in ~80 ms - matching the reference unit's
 * visibly-stepping march rather than a 60-moves-per-second blur.
 */
export const LOGIC_TICKS_PER_SECOND = 60;

/** Milliseconds of simulated time each logic tick represents. */
export const TICK_MS = 1000 / LOGIC_TICKS_PER_SECOND;

/**
 * Cap on the real frame delta folded into the accumulator per animation frame.
 * A backgrounded tab or a long GC pause can hand rAF a multi-second delta; without
 * a clamp the loop would try to catch up with hundreds of ticks at once (the
 * "spiral of death"). Excess time beyond this is simply dropped.
 */
export const MAX_FRAME_MS = 250;

export interface AccumulatorResult {
  /** Number of fixed logic ticks to run this frame. */
  readonly ticks: number;
  /** Simulated time carried over to the next frame, milliseconds. */
  readonly accumulator: number;
}

/**
 * Fold one frame's elapsed time into the accumulator and drain whole ticks.
 *
 * Returns how many fixed ticks to run and the leftover accumulator. `frameMs`
 * is clamped to {@link MAX_FRAME_MS} so a huge gap cannot schedule an unbounded
 * catch-up burst; when the clamp drops time, the remainder is kept sub-tick so
 * cadence stays smooth on the next frame.
 */
export function drainAccumulator(
  accumulator: number,
  frameMs: number,
  tickMs: number = TICK_MS,
  maxFrameMs: number = MAX_FRAME_MS,
): AccumulatorResult {
  if (tickMs <= 0) {
    throw new Error('drainAccumulator: tickMs must be positive');
  }
  const clamped = Math.min(Math.max(frameMs, 0), maxFrameMs);
  let acc = accumulator + clamped;
  let ticks = 0;
  while (acc >= tickMs) {
    acc -= tickMs;
    ticks += 1;
  }
  return { ticks, accumulator: acc };
}
