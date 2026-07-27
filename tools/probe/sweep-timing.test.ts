// The sweep's rate, and the tube going dark while a note plays.
//
// Two properties of asm/jetfighter.asm that docs/evidence/vfd-appearance.md
// measured off the owner's unit, and that nothing else in the suite pins:
//
//   D4 - the sweep rate. The video samples the tube at 30 fps and measures the
//        beat between the sampling and the refresh at 10.6-12.5 Hz, which admits
//        only disjoint intervals of sweep rate and excludes the 64.5 Hz the ROM
//        used to run at. The interval adjacent to it is 70.6-72.5 Hz.
//
//   D1 - the blanking. The MCU has one core and no sound hardware, so while it
//        is bit-banging D14 in a timed delay loop it is not strobing the grids
//        and the whole tube goes out. The video measures complete blanking on
//        every sound, and P(dark | speaker loud) ten times P(dark | quiet).
//
// Everything here is read off the machine's own observation surface - the tube's
// grid lines and the D14 edge stream - by driving the real ROM. Nothing reads
// the ROM's RAM and nothing asserts on the source text; a test that grepped the
// assembly for DWELL_INNER would pass for a ROM whose sweep did something else
// entirely.
//
// On what each test would have caught. The rate test fails against the ROM as it
// stood before this work: 6183 cycles is 64.7 Hz, outside the interval by more
// than 2 Hz on the slow side. The blanking test passes against it - the ROM
// already left the grids alone while a note played, which is a finding rather
// than a fix, and vfd-appearance.md's D1 states the opposite. It is kept because
// the property is load bearing and is one edit away from being lost: adding a
// `CAL dwell` or a grid strobe inside `note_loop` or `note_half`, to steady the
// tube during a long note, would break it silently and no other test would
// notice.
//
// Windows are anchored on the thing being asserted about, never on power-on. The
// blanking test locates a sound first and measures the tube around *that*, and
// checks the tube was being strobed immediately before it - a ROM that had
// wedged with its grids low would otherwise satisfy "the tube is dark while the
// speaker sounds" trivially, and a window that started at power-on would never
// have told them apart.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';
import { GRID_COUNT, GRID_MASK } from '../../src/machine/board/display.js';

/**
 * The admissible interval for the mean sweep rate, in Hz.
 *
 * docs/evidence/vfd-appearance.md section 2. The intervals the aliasing argument
 * admits are disjoint - 40.6-42.5, 47.5-49.4, 70.6-72.5, 77.5-79.4, 100.6-102.5,
 * 107.5-109.4 and 130.6-132.5 - and this is the one adjacent to what the ROM
 * used to do. They bracket the *mean*, not every individual pass.
 */
const SWEEP_HZ_MIN = 70.6;
const SWEEP_HZ_MAX = 72.5;

/**
 * Sweeps to time for the rate figure.
 *
 * The rate is a mean over a few hundred passes, not a reading off one. Three
 * hundred is about four seconds of emulated play, long enough to include several
 * sounds and every kind of between-sweep work the game does.
 */
const SWEEPS_TIMED = 300;

/**
 * Machine cycles between control movements for the player below.
 *
 * The same figure and the same reasoning as game-lifetime.test.ts: faster than a
 * human works a case, slower than the ROM's own input scan.
 */
const PLAYER_SLICE_CYCLES = 3_000;

/** Lever positions, in the order a player who cannot see the tube works them. */
const LEVER_POSITIONS = ['up', 'centre', 'down'] as const;

/**
 * Sweeps to run off before timing starts.
 *
 * The first sweeps after power-on carry the ROM's reset and RAM-clear code, so
 * they are longer than a steady pass and are not the thing being measured.
 */
const WARMUP_SWEEPS = 5;

/**
 * Silence that separates two sounds, in machine cycles - 20 ms.
 *
 * Above the 5.2 ms half-period of the slowest note the ROM plays and below the
 * ~11000-cycle gap between two launcher-hit warning beeps. Same constant, and
 * the same reasoning, as speaker-bands.test.ts.
 */
const BURST_GAP_CYCLES = 8000;

/** Machine cycles to run the blanking test over. About 1.5 s of play. */
const BLANKING_CYCLES = 600_000;

/** A board running the real game ROM, freshly powered on. */
function romBoard(): Board {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  return new Board(romImage(assemble(readFileSync(path, 'utf8'), path)));
}

/** One period of the sweep: how long it took, and whether the speaker sounded. */
interface Sweep {
  readonly cycles: number;
  readonly silent: boolean;
}

/**
 * Time `count` consecutive sweeps of a game being played.
 *
 * A sweep boundary is the tube's own: `runFrames(1)` returns the moment the
 * display closes a frame period, which happens when the ROM drives a grid it has
 * already driven since the last boundary. The period is therefore whatever the
 * ROM took, which is the property D5 asks to be preserved.
 *
 * The controls are worked throughout, for the same reason game-lifetime.test.ts
 * works them: an unattended machine reaches game over in about a hundred and
 * fifty sweeps and then draws nothing, and a sweep that draws nothing is 200
 * cycles shorter than a sweep of a live playfield. The video the sweep rate
 * comes from is of a game being played, so this is a game being played.
 *
 * The speaker's edge buffer is drained once per sweep, so a sweep is `silent`
 * when the ROM did not touch D14 during it.
 */
function timePlayedSweeps(board: Board, count: number): Sweep[] {
  const sweeps: Sweep[] = [];
  let previous = board.cycles;
  board.takeSpeakerEdges();
  for (let index = 0; index < count; index += 1) {
    board.setControl('lever', LEVER_POSITIONS[Math.floor(index / 2) % 3] as string);
    board.setFire(index % 2 === 0);
    const before = board.display.frameCount;
    board.runFrames(1, PLAYER_SLICE_CYCLES * 100);
    if (board.display.frameCount === before) break;
    sweeps.push({
      cycles: board.cycles - previous,
      silent: board.takeSpeakerEdges().length === 0,
    });
    previous = board.cycles;
  }
  return sweeps;
}

/** One interval during which the ROM drove no grid at all. */
interface DarkRun {
  readonly startCycle: number;
  readonly endCycle: number;
}

/** Everything the tube and the speaker did over one run. */
interface Trace {
  /** Intervals with no grid driven, in cycle order. */
  readonly darkRuns: readonly DarkRun[];
  /** Cycle at which each grid mask took effect, in cycle order. */
  readonly gridStates: ReadonlyArray<readonly [cycle: number, mask: number]>;
  /** D14 transition cycles, in cycle order. */
  readonly edgeCycles: readonly number[];
}

/**
 * Run the machine, recording every change of the driven grid lines.
 *
 * Stepped one instruction at a time and sampled from the tube's public state, so
 * the resolution is the instruction that changed the port - the same resolution
 * the speaker's own edge timestamps carry.
 */
function trace(board: Board, cycles: number): Trace {
  const gridStates: Array<readonly [number, number]> = [];
  const darkRuns: DarkRun[] = [];
  let previous = board.display.gridMask;
  let darkFrom: number | null = previous === 0 ? board.cycles : null;

  while (board.cycles < cycles) {
    if (board.stepInstruction() === 0) break;
    const mask = board.display.gridMask;
    if (mask === previous) continue;
    gridStates.push([board.cycles, mask]);
    if (mask === 0) {
      darkFrom = board.cycles;
    } else if (darkFrom !== null) {
      darkRuns.push({ startCycle: darkFrom, endCycle: board.cycles });
      darkFrom = null;
    }
    previous = mask;
  }

  return { darkRuns, gridStates, edgeCycles: board.takeSpeakerEdges().map((edge) => edge.cycle) };
}

/** One sound: a run of D14 edges with no 20 ms of silence inside it. */
interface Sound {
  readonly firstEdge: number;
  readonly lastEdge: number;
}

/** Split a D14 edge stream into sounds at gaps of {@link BURST_GAP_CYCLES}. */
function splitSounds(edgeCycles: readonly number[]): Sound[] {
  const sounds: Sound[] = [];
  let first = edgeCycles[0];
  let last = first;
  for (const cycle of edgeCycles.slice(1)) {
    if (cycle - last > BURST_GAP_CYCLES) {
      sounds.push({ firstEdge: first as number, lastEdge: last as number });
      first = cycle;
    }
    last = cycle;
  }
  if (first !== undefined) {
    sounds.push({ firstEdge: first, lastEdge: last as number });
  }
  return sounds;
}

/** Milliseconds for a cycle count at the 400 kHz oscillator. */
function ms(cycles: number): number {
  return (cycles / CYCLE_HZ) * 1000;
}

describe('the sweep rate the reference video admits (D4)', () => {
  const board = romBoard();
  board.runFrames(WARMUP_SWEEPS);
  const sweeps = timePlayedSweeps(board, SWEEPS_TIMED);
  const silent = sweeps.filter((sweep) => sweep.silent);
  const meanSilentCycles = silent.reduce((total, s) => total + s.cycles, 0) / silent.length;
  const meanHz = CYCLE_HZ / meanSilentCycles;

  it('kept the game alive for the whole window it is timing', () => {
    // A run that ended early would be timing an idle machine, whose sweeps are
    // shorter because render_field has nothing to lay out - a different
    // population from the one the interval is a statement about.
    expect(sweeps).toHaveLength(SWEEPS_TIMED);
  });

  it('sweeps often enough to have produced most of the run silently', () => {
    // The mean is taken over the sweeps that carry no sound, for the reason
    // vfd-appearance.md excludes blanked frames from its own refresh figures: a
    // sweep with a note in it is the note's length longer, and the beat the
    // video measures is a property of the passes that actually refreshed the
    // tube. This asserts that exclusion is a trim and not the measurement.
    expect(silent.length).toBeGreaterThan(SWEEPS_TIMED * 0.8);
  });

  it('runs its mean sweep inside 70.6-72.5 Hz', () => {
    // 71.5 Hz as it stands, the middle of the interval. The ROM produced 6363
    // cycles on this population - 62.9 Hz - before this figure was fixed, which
    // is outside on the slow side and in the gap between two admissible
    // intervals rather than inside either.
    expect(meanHz).toBeGreaterThanOrEqual(SWEEP_HZ_MIN);
    expect(meanHz).toBeLessThanOrEqual(SWEEP_HZ_MAX);
  });

  it('drives all ten grids in the sweeps it is timing', () => {
    // A "sweep rate" measured off a ROM that had stopped driving half the tube
    // would be a number about nothing. The frame boundary is a repeated grid, so
    // a two-grid loop would produce boundaries at a plausible rate.
    expect(board.getStrobedGrids()).toHaveLength(GRID_COUNT);
  });

  it('lets the sweep period vary rather than pinning it (D5)', () => {
    // display.ts closes a frame when an already-driven grid rises again, so the
    // period is whatever the ROM took and a pass that does more game work is a
    // longer pass. The video measures a spectral spread that rules out a stable
    // period; this asserts the ROM has not been given one.
    const distinct = new Set(silent.map((sweep) => sweep.cycles));
    expect(distinct.size).toBeGreaterThan(1);

    // ...and that the variation is a jitter and not a second cadence: every
    // silent pass stays within a tenth of the mean, so the figure above is a
    // mean of one population.
    for (const sweep of silent) {
      expect(Math.abs(sweep.cycles - meanSilentCycles) / meanSilentCycles).toBeLessThan(0.1);
    }
  });
});

describe('the tube goes dark while a note plays (D1)', () => {
  const board = romBoard();
  board.runFrames(WARMUP_SWEEPS);
  const startCycle = board.cycles;
  const { darkRuns, gridStates, edgeCycles } = trace(board, BLANKING_CYCLES);
  const sounds = splitSounds(edgeCycles);

  /** The dark interval containing `cycle`, if the tube was dark then. */
  function darkRunAt(cycle: number): DarkRun | undefined {
    return darkRuns.find((run) => run.startCycle <= cycle && cycle <= run.endCycle);
  }

  it('made several sounds in the window, so there is something to assert about', () => {
    expect(sounds.length).toBeGreaterThanOrEqual(3);
  });

  it('was sweeping the tube in the sweep before each sound started', () => {
    // The anchor. Without it "the tube is dark while the speaker sounds" is also
    // true of a ROM that has wedged with every grid low, and a window measured
    // from power-on would never separate the two.
    for (const sound of sounds) {
      const from = sound.firstEdge - 2 * Math.round(CYCLE_HZ / SWEEP_HZ_MIN);
      const driven = gridStates
        .filter(([cycle]) => cycle >= Math.max(startCycle, from) && cycle < sound.firstEdge)
        .reduce((mask, [, next]) => mask | next, 0);
      expect(driven & GRID_MASK).toBe(GRID_MASK);
    }
  });

  it('drives no grid at all for the whole of every sound', () => {
    for (const sound of sounds) {
      const dark = darkRunAt(sound.firstEdge);
      expect(dark).toBeDefined();
      // One interval, unbroken, covering the note from its first edge to its
      // last: the same dark run has to still be running at the end of the sound,
      // not a second one that started after a refresh in the middle.
      expect(dark?.endCycle).toBeGreaterThanOrEqual(sound.lastEdge);
    }
  });

  it('holds the blank for as long as the sound lasts', () => {
    for (const sound of sounds) {
      const dark = darkRunAt(sound.firstEdge) as DarkRun;
      const soundMs = ms(sound.lastEdge - sound.firstEdge);
      const blankMs = ms(dark.endCycle - dark.startCycle);
      expect(blankMs).toBeGreaterThanOrEqual(soundMs);
      // And is the sound's blank, not a stall that happens to contain it: the
      // tube comes back within half a sweep of the last edge. The ROM returns
      // from note_loop into the sweep, so the two are within a few instructions
      // of each other; half a sweep is loose enough not to pin the return path.
      expect(ms(dark.endCycle - sound.lastEdge)).toBeLessThan(0.5 * ms(CYCLE_HZ / SWEEP_HZ_MIN));
    }
  });

  it('blanks for a visible fraction of the run, not a flicker', () => {
    // vfd-appearance.md measures 14-17% of frames fully dark during active play,
    // against 0% in the quiet control window. This is the same statement made
    // over cycles instead of camera frames: the floor is deliberately well under
    // the measured figure, because how often the game *triggers* a sound is
    // provisional cadence and not what this test is about.
    const soundCycles = darkRuns
      .filter((run) => sounds.some((s) => run.startCycle <= s.firstEdge && s.firstEdge <= run.endCycle))
      .reduce((total, run) => total + (run.endCycle - run.startCycle), 0);
    expect(soundCycles / (board.cycles - startCycle)).toBeGreaterThan(0.05);
  });

  it('goes back to sweeping the whole tube after the last sound', () => {
    // The counterpart of the anchor: the blank is a pause in the sweep, not the
    // end of it. Measured from the last edge of the last sound, not from
    // power-on - the failure this guards against is a ROM that never comes back.
    const last = sounds[sounds.length - 1] as Sound;
    const driven = gridStates
      .filter(([cycle]) => cycle > last.lastEdge)
      .reduce((mask, [, next]) => mask | next, 0);
    expect(driven & GRID_MASK).toBe(GRID_MASK);
  });
});
