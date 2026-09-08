// The opening: the tube close enough to see the grid's honeycomb, then the
// board's parts gathering as the camera pulls back over the player's edge, then
// the lid seating as the camera swings up to the front. A timeline in
// milliseconds, pure, so the page can ask what the picture is at any instant
// and a test can check the shape of the whole thing.
//
// Four phases. `hold`: the camera stands still on the tube while the page fades
// in from black. `pull`: the camera draws back and the slider runs 1 to 1/2, so
// everything below the lid comes home. `seat`: the slider runs 1/2 to 0 - the
// lid comes down - while the page swings the camera to the front. Then done.

import { ease } from './explode.js';

export const INTRO = {
  /** The fade from black, and how long the camera stands on the tube. */
  holdMs: 1100,
  /** The pull-back, and the board gathering. */
  pullMs: 2200,
  /** The lid seating. The swing to the front runs inside this. */
  seatMs: 1300,
  /** Metres from the tube's face at the start: close enough for the honeycomb. */
  startDistance: 0.022,
} as const;

export const INTRO_TOTAL_MS = INTRO.holdMs + INTRO.pullMs + INTRO.seatMs;

export interface IntroFrame {
  /** The explode slider's value at this instant. */
  readonly amount: number;
  /** How far the camera has pulled back, 0 on the tube to 1 at the inside view, eased. */
  readonly pull: number;
  /** In the seating phase: the page starts the swing to the front on the first such frame. */
  readonly seating: boolean;
  readonly done: boolean;
}

/** The picture `elapsedMs` after the opening began. Pure. */
export function introAt(elapsedMs: number): IntroFrame {
  const t = Math.max(0, elapsedMs);
  if (t < INTRO.holdMs) return { amount: 1, pull: 0, seating: false, done: false };
  const pullT = (t - INTRO.holdMs) / INTRO.pullMs;
  if (pullT < 1) {
    const k = ease(pullT);
    return { amount: 1 - 0.5 * k, pull: k, seating: false, done: false };
  }
  const seatT = (t - INTRO.holdMs - INTRO.pullMs) / INTRO.seatMs;
  if (seatT < 1) return { amount: 0.5 - 0.5 * ease(seatT), pull: 1, seating: true, done: false };
  return { amount: 0, pull: 1, seating: true, done: true };
}
