// The opening: the tube close enough to see the grid's honeycomb, the board's
// parts gathering as the camera pulls back over the player's edge, the lid
// seating as the camera swings up to the front, and then the unit turned over
// for its cells - four AA, one after another, into the bay - and the door
// closed on them, before the camera comes back to the front. A timeline in
// milliseconds, pure, so the page can ask what the picture is at any instant
// and a test can check the shape of the whole thing.
//
// Seven phases. `hold`: the camera stands still on the tube while the page
// fades in from black. `pull`: the camera draws back and the body gathers -
// everything below the lid that is not a cell or the door. `seat`: the lid
// comes down while the page swings the camera to the front. `flip`: the camera
// swings under to the battery bay. `load`: the cells slide in, staggered.
// `close`: the door goes on. `return`: the camera swings back to the front.

import { type Band, bandOf, cellIndex, ease } from './explode.js';

export const INTRO = {
  /** The fade from black, and how long the camera stands on the tube. */
  holdMs: 1000,
  /** The pull-back, and the body gathering. */
  pullMs: 1800,
  /** The lid seating. The swing to the front runs inside this. */
  seatMs: 1000,
  /** The swing under to the bay; nothing moves. */
  flipMs: 700,
  /** The cells going in. */
  loadMs: 1400,
  /** The door going on. */
  closeMs: 600,
  /** The swing back to the front; nothing moves. */
  returnMs: 700,
  /** Metres from the tube's face at the start: close enough for the honeycomb. */
  startDistance: 0.022,
  /** Cells go in one after another: each starts this far into the load, as a fraction, after the last. */
  cellStagger: 0.18,
} as const;

export type IntroPhase = 'hold' | 'pull' | 'seat' | 'flip' | 'load' | 'close' | 'return' | 'done';

/** The phases in order with their lengths; `done` has none. */
const PHASES: readonly (readonly [IntroPhase, number])[] = [
  ['hold', INTRO.holdMs],
  ['pull', INTRO.pullMs],
  ['seat', INTRO.seatMs],
  ['flip', INTRO.flipMs],
  ['load', INTRO.loadMs],
  ['close', INTRO.closeMs],
  ['return', INTRO.returnMs],
];

export const INTRO_TOTAL_MS = PHASES.reduce((sum, [, ms]) => sum + ms, 0);

export interface IntroFrame {
  readonly phase: IntroPhase;
  /** How far the camera has pulled back, 0 on the tube to 1 at the inside view, eased. */
  readonly pull: number;
  /** The explode factor of each band; the cells' is the last to start. */
  readonly lid: number;
  readonly body: number;
  readonly door: number;
  /** One factor per cell, in the order they go in. */
  readonly cells: readonly number[];
  readonly done: boolean;
}

/** How many cells the opening loads. The model has four; a fifth would sit out. */
export const CELL_COUNT = 4;

/** The picture `elapsedMs` after the opening began. Pure. */
export function introAt(elapsedMs: number): IntroFrame {
  let t = Math.max(0, elapsedMs);
  let phase: IntroPhase = 'done';
  let k = 1;
  for (const [name, ms] of PHASES) {
    if (t < ms) {
      phase = name;
      k = t / ms;
      break;
    }
    t -= ms;
  }
  let lid = 1;
  let body = 1;
  let door = 1;
  let cells: number[] = Array.from({ length: CELL_COUNT }, () => 1);
  let pull = 0;
  const after = (p: IntroPhase): boolean => PHASES.findIndex(([n]) => n === p) < PHASES.findIndex(([n]) => n === phase) || phase === 'done';
  if (phase === 'pull') {
    pull = ease(k);
    body = 1 - pull;
  }
  if (after('pull')) {
    pull = 1;
    body = 0;
  }
  if (phase === 'seat') lid = 1 - ease(k);
  if (after('seat')) lid = 0;
  if (phase === 'load') {
    cells = cells.map((_unused, i) => {
      const start = i * INTRO.cellStagger;
      const span = 1 - (CELL_COUNT - 1) * INTRO.cellStagger;
      return 1 - ease(Math.min(1, Math.max(0, (k - start) / span)));
    });
  }
  if (after('load')) cells = cells.map(() => 0);
  if (phase === 'close') door = 1 - ease(k);
  if (after('close')) door = 0;
  return { phase, pull, lid, body, door, cells, done: phase === 'done' };
}

/** The factor a frame gives a part, by the band the part moves in. */
export function introFactor(frame: IntroFrame, partName: string): number {
  const band: Band = bandOf(partName);
  if (band === 'cell') return frame.cells[cellIndex(partName)] ?? 0;
  return frame[band];
}
