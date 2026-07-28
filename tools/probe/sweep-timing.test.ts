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
import {
  GRID_COUNT,
  GRID_MASK,
  REFRESH_TIMEOUT_CYCLES,
} from '../../src/machine/board/display.js';
import type { SegmentDuty } from '../../src/machine/board/pwm.js';

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

/**
 * The squadron's slowest march step, in ms of wall clock.
 *
 * `PAT_STEP` entry 0 is skill 1's entry point and the top of the cadence ladder,
 * so it is both the worst case and where a freshly powered machine starts. The
 * ladder's own comment in `asm/jetfighter.asm` measures it at 1995 ms.
 */
const MARCH_STEP_MS = 1995;

/**
 * The window the blanking tests run over, stated in march steps.
 *
 * It was a flat 1.5 s and it stopped carrying three sounds. The battleship used
 * to buzz for 68 ms fifty-one times a minute, which filled any window at all;
 * the buzz is now one 383 ms note per crossing and the crossing is rare, so the
 * march step is the note this window has to contain and 1.5 s holds less than
 * one of them.
 *
 * Stated as a multiple of a measured cadence rather than as a wall-clock figure
 * for the reason CLAUDE.md records: a literal horizon in a test about a machine
 * whose cadence moves is a bet on the cadence, and it has turned main red here
 * before. A cadence change now moves `MARCH_STEP_MS` and nothing else.
 */
const MARCH_STEPS_TIMED = 5;
const BLANKING_CYCLES = Math.round(((MARCH_STEPS_TIMED * MARCH_STEP_MS) / 1000) * CYCLE_HZ);

/** The assembled game ROM, kept so symbol addresses are read rather than typed. */
const GAME_ASM = (() => {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  return assemble(readFileSync(path, 'utf8'), path);
})();

function gameSymbol(name: string): number {
  const found = GAME_ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
}

/**
 * Where the ROM records which lane the battleship is in, and the value that
 * means it is not crossing.
 *
 * The battleship buzz is the one sound this machine makes that does *not* stop
 * the sweep - it is clocked out of `dwell`, ten times a sweep, precisely so the
 * tube stays lit while the boat is on it. Every blanking assertion in this file
 * predates that sound and is written about notes, which do stop the sweep. So
 * the buzz has to be told apart from a note, and this nibble is how: the probe
 * reads it, as it may, and the stretches where it holds a lane are excluded from
 * the note assertions and asserted separately.
 */
const BSLANE_ADDRESS = gameSymbol('FILE_STATE') * 16 + gameSymbol('NIB_BSLANE');
const BS_NONE = gameSymbol('BS_NONE');

/** A board running the real game ROM, freshly powered on. */
function romBoard(): Board {
  return new Board(romImage(GAME_ASM));
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
  /** Intervals during which the battleship was on the tube, in cycle order. */
  readonly crossings: ReadonlyArray<readonly [from: number, to: number]>;
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
  const crossings: Array<readonly [number, number]> = [];
  let previous = board.display.gridMask;
  let darkFrom: number | null = previous === 0 ? board.cycles : null;
  let crossingFrom: number | null = null;

  while (board.cycles < cycles) {
    if (board.stepInstruction() === 0) break;
    const mask = board.display.gridMask;
    if (mask === previous) continue;
    // Sampled here rather than every instruction: the mask changes about ten
    // times a sweep, which locates a crossing to well inside one.
    const crossing = board.cpu.memory.readRam(BSLANE_ADDRESS) !== BS_NONE;
    if (crossing && crossingFrom === null) crossingFrom = board.cycles;
    if (!crossing && crossingFrom !== null) {
      crossings.push([crossingFrom, board.cycles]);
      crossingFrom = null;
    }
    gridStates.push([board.cycles, mask]);
    if (mask === 0) {
      darkFrom = board.cycles;
    } else if (darkFrom !== null) {
      darkRuns.push({ startCycle: darkFrom, endCycle: board.cycles });
      darkFrom = null;
    }
    previous = mask;
  }

  if (crossingFrom !== null) crossings.push([crossingFrom, board.cycles]);
  return {
    darkRuns,
    gridStates,
    edgeCycles: board.takeSpeakerEdges().map((edge) => edge.cycle),
    crossings,
  };
}

/** True when `cycle` falls inside a battleship crossing. */
function duringCrossing(
  crossings: ReadonlyArray<readonly [number, number]>,
  cycle: number,
): boolean {
  return crossings.some(([from, to]) => cycle >= from && cycle <= to);
}

/** One sound: a run of D14 edges with no 20 ms of silence inside it. */
interface Sound {
  readonly firstEdge: number;
  readonly lastEdge: number;
  /**
   * Stretches inside the sound where the pin was left alone for longer than
   * {@link REFRESH_TIMEOUT_CYCLES}, as `[from, to]` cycle pairs.
   *
   * BURST_GAP_CYCLES groups two notes played back to back into a single sound,
   * which is what it is for - it stops the loss sound's 96 Hz collapse reading
   * as seven lone edges. But the ROM runs a sweep between two such notes when
   * there is time for one, and 15 ms is time for one: a march note running
   * straight into a battleship buzz leaves a hole in the middle of what this
   * function calls one 152 ms sound, and the grids are driven in it.
   *
   * A lit tube there is the machine working, not the blank failing, so D1 is
   * asserted around these holes rather than through them. The threshold is
   * `REFRESH_TIMEOUT_CYCLES` rather than a figure of this file's own because it
   * is the constant `Display.getObservedFrame` uses to decide the tube has gone
   * dark - one definition of "long enough to have stopped scanning", shared by
   * the implementation and the test.
   */
  readonly holes: readonly (readonly [number, number])[];
}

/** Split a D14 edge stream into sounds at gaps of {@link BURST_GAP_CYCLES}. */
function splitSounds(edgeCycles: readonly number[]): Sound[] {
  const sounds: Sound[] = [];
  let first = edgeCycles[0];
  let last = first;
  let holes: (readonly [number, number])[] = [];
  for (const cycle of edgeCycles.slice(1)) {
    const previous = last as number;
    if (cycle - previous > BURST_GAP_CYCLES) {
      sounds.push({ firstEdge: first as number, lastEdge: previous, holes });
      holes = [];
      first = cycle;
    } else if (cycle - previous > REFRESH_TIMEOUT_CYCLES) {
      holes.push([previous, cycle]);
    }
    last = cycle;
  }
  if (first !== undefined) {
    sounds.push({ firstEdge: first, lastEdge: last as number, holes });
  }
  return sounds;
}

/** True when `cycle` falls in a stretch of `sound` where the pin was idle. */
function inHole(sound: Sound, cycle: number): boolean {
  return sound.holes.some(([from, to]) => cycle > from && cycle < to);
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
  const { darkRuns, gridStates, edgeCycles, crossings } = trace(board, BLANKING_CYCLES);
  const allSounds = splitSounds(edgeCycles);
  // Notes only. A sound overlapping a crossing has the sweep-clocked battleship
  // buzz mixed into it, and the buzz does not blank the tube - that is what it
  // is for. Asserting the blank through one would assert the opposite of the
  // ROM's intent. The buzz gets its own assertions elsewhere.
  const sounds = allSounds.filter(
    (sound) => !duringCrossing(crossings, sound.firstEdge) && !duringCrossing(crossings, sound.lastEdge),
  );

  /** The dark interval containing `cycle`, if the tube was dark then. */
  function darkRunAt(cycle: number): DarkRun | undefined {
    return darkRuns.find((run) => run.startCycle <= cycle && cycle <= run.endCycle);
  }

  /**
   * The sounds that share one blank, in order, keyed by that blank's start.
   *
   * Not every sound gets a sweep of its own on either side of it, and the
   * launcher-hit warning is the case that proves it: three ~10 ms beeps
   * separated by `warn_gap`, which is two `dwell` calls and drives no grid. That
   * is 26.7 ms of silence - above the 20 ms `splitSounds` cuts at, so it reads as
   * three sounds, and below anything that would let a sweep in, so all three sit
   * inside a single unbroken dark run.
   *
   * So the unit the two assertions below are about is the **blank**, not the
   * sound: the tube is swept before the blank opens and comes back when it
   * closes, and what happens between the beeps inside it is the ROM bit-banging
   * the speaker with the grids low, which is the behaviour being asserted rather
   * than a violation of it. Grouping was added when the window lengthened from
   * 1.5 s to five march steps and started containing a warning sequence.
   */
  const soundsByBlank = new Map<number, Sound[]>();
  for (const sound of sounds) {
    const dark = darkRunAt(sound.firstEdge);
    if (dark === undefined) continue;
    const group = soundsByBlank.get(dark.startCycle) ?? [];
    group.push(sound);
    soundsByBlank.set(dark.startCycle, group);
  }

  it('made several sounds in the window, so there is something to assert about', () => {
    expect(sounds.length).toBeGreaterThanOrEqual(3);
  });

  it('was sweeping the tube in the sweep before each blank opened', () => {
    // The anchor. Without it "the tube is dark while the speaker sounds" is also
    // true of a ROM that has wedged with every grid low, and a window measured
    // from power-on would never separate the two.
    for (const group of soundsByBlank.values()) {
      const first = group[0] as Sound;
      const from = first.firstEdge - 2 * Math.round(CYCLE_HZ / SWEEP_HZ_MIN);
      const driven = gridStates
        .filter(([cycle]) => cycle >= Math.max(startCycle, from) && cycle < first.firstEdge)
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
    for (const group of soundsByBlank.values()) {
      const first = group[0] as Sound;
      const last = group[group.length - 1] as Sound;
      const dark = darkRunAt(first.firstEdge) as DarkRun;
      const soundMs = ms(last.lastEdge - first.firstEdge);
      const blankMs = ms(dark.endCycle - dark.startCycle);
      expect(blankMs).toBeGreaterThanOrEqual(soundMs);
      // And is the sound's blank, not a stall that happens to contain it: the
      // tube comes back within half a sweep of the last edge. The ROM returns
      // from note_loop into the sweep, so the two are within a few instructions
      // of each other; half a sweep is loose enough not to pin the return path.
      expect(ms(dark.endCycle - last.lastEdge)).toBeLessThan(0.5 * ms(CYCLE_HZ / SWEEP_HZ_MIN));
    }
  });

  it('blanks for a visible fraction of the run, not a flicker', () => {
    // vfd-appearance.md measures 14-17% of frames fully dark during active play,
    // against 0% in the quiet control window. This is the same statement made
    // over cycles instead of camera frames: the floor is deliberately well under
    // the measured figure, because how often the game *triggers* a sound is
    // provisional cadence and not what this test is about.
    // **The floor moved from 0.05 to 0.03 when the battleship stopped playing a
    // note.** That sound was one 383 ms blank per crossing and this window is
    // 9.98 s, so it was 3.8 percentage points of this figure on its own; the
    // measured value went from 8.2% to 4.4% on a change whose entire purpose was
    // to stop the boat blanking the tube. Lowering the floor is therefore the
    // reading the change intends, not a guardrail relaxed to get to green - what
    // this assertion is for is catching blanking that stopped happening at all,
    // and the per-note invariants above are what actually pin the behaviour.
    //
    // `allSounds`, not `sounds`: a march or missile note that lands inside a
    // crossing still stops the sweep and still darkens the tube, so its blank
    // belongs in this fraction. Only the *invariant* assertions above need the
    // buzz filtered out of their input.
    const soundCycles = darkRuns
      .filter((run) => allSounds.some((s) => run.startCycle <= s.firstEdge && s.firstEdge <= run.endCycle))
      .reduce((total, run) => total + (run.endCycle - run.startCycle), 0);
    expect(soundCycles / (board.cycles - startCycle)).toBeGreaterThan(0.03);
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

// ============================================================================
// What the renderer is handed while a note plays (D1)
// ============================================================================
//
// The tests above assert what the *ROM* does: it stops driving the grids for
// the duration of every sound. These assert that the fact survives the trip to
// `main.ts`, which is where it used to be lost - `Display.getFrame()` returns
// the last *completed* frame period, no period completes while the sweep is
// stopped, and the renderer was handed a fully lit tube throughout.
//
// Read the way `main.ts` reads: `board.getLitSegments()`, sampled at the ~60 Hz
// cadence a browser calls its frame callback at. Anything coarser would step
// over a march note, which is the case that matters - it is the shortest of the
// common sounds and it fires on every squadron step. A test that only exercised
// the 637 ms loss sequence would pass against a change that left the march note
// visibly lit.

/** How often `main.ts` reads the tube, in machine cycles - one 60 Hz frame. */
const RENDER_INTERVAL_CYCLES = Math.round(CYCLE_HZ / 60);

/** Machine cycles to run: the same march-step horizon the blanking window uses. */
const RENDER_RUN_CYCLES = BLANKING_CYCLES;

/** One read of the tube by the frame driver. */
interface RenderSample {
  readonly cycle: number;
  readonly segments: readonly SegmentDuty[];
}

/** Brightest duty in a sample - 0 when the tube is dark. */
function peakDuty(sample: RenderSample): number {
  return sample.segments.reduce((peak, segment) => Math.max(peak, segment.duty), 0);
}

describe('the blank reaches the renderer (D1)', () => {
  const board = romBoard();
  board.runFrames(WARMUP_SWEEPS);

  const samples: RenderSample[] = [];
  const edgeCycles: number[] = [];
  const crossings: Array<readonly [number, number]> = [];
  let crossingFrom: number | null = null;
  const until = board.cycles + RENDER_RUN_CYCLES;
  let nextRead = board.cycles + RENDER_INTERVAL_CYCLES;
  while (board.cycles < until) {
    // Small slices so a read lands within a few hundred cycles of its due time;
    // the driver's own resolution is one instruction.
    board.step(200);
    edgeCycles.push(...board.takeSpeakerEdges().map((edge) => edge.cycle));
    const crossing = board.cpu.memory.readRam(BSLANE_ADDRESS) !== BS_NONE;
    if (crossing && crossingFrom === null) crossingFrom = board.cycles;
    if (!crossing && crossingFrom !== null) {
      crossings.push([crossingFrom, board.cycles]);
      crossingFrom = null;
    }
    if (board.cycles >= nextRead) {
      samples.push({ cycle: board.cycles, segments: board.getLitSegments() });
      nextRead += RENDER_INTERVAL_CYCLES;
    }
  }
  if (crossingFrom !== null) crossings.push([crossingFrom, board.cycles]);

  // Notes only - see the same filter in the D1 block above. The battleship buzz
  // deliberately leaves the tube lit, so it is not a sound this block is about.
  const sounds = splitSounds(edgeCycles).filter(
    (sound) => !duringCrossing(crossings, sound.firstEdge) && !duringCrossing(crossings, sound.lastEdge),
  );
  /** Sounds of march length. The ROM plays a march note in 3 bursts, ~68 ms. */
  const marchNotes = sounds.filter(
    (sound) => ms(sound.lastEdge - sound.firstEdge) > 50 && ms(sound.lastEdge - sound.firstEdge) < 110,
  );

  /**
   * Reads that fall inside `sound` while the pin was actually being toggled,
   * once the refresh timeout has expired. Reads inside an internal hole are
   * excluded - see {@link Sound.holes}.
   */
  function readsDuring(sound: Sound): RenderSample[] {
    return samples.filter(
      (sample) =>
        sample.cycle >= sound.firstEdge + REFRESH_TIMEOUT_CYCLES &&
        sample.cycle <= sound.lastEdge &&
        !inHole(sound, sample.cycle),
    );
  }

  it('played several march notes in the window', () => {
    // Guards every assertion below against passing vacuously.
    expect(marchNotes.length).toBeGreaterThanOrEqual(3);
  });

  it('hands the renderer a lit tube while the sweep is running', () => {
    // The control. If this failed the rest would pass on a permanently dark
    // machine, which is the failure mode the blanking work could most easily
    // introduce.
    const lit = samples.filter((sample) => sample.segments.length > 0);
    expect(lit.length).toBeGreaterThan(samples.length * 0.5);
  });

  it('hands the renderer nothing at all for the whole of every march note', () => {
    for (const note of marchNotes) {
      const reads = readsDuring(note);
      // A ~68 ms note against a 16.7 ms read interval and a 5 ms timeout leaves
      // three reads or so inside it. Asserting there are any is what stops this
      // passing by measuring an empty window.
      expect(reads.length).toBeGreaterThanOrEqual(2);
      for (const read of reads) {
        expect(read.segments).toEqual([]);
      }
    }
  });

  it('hands the renderer nothing for the whole of every sound, march or not', () => {
    for (const sound of sounds) {
      for (const read of readsDuring(sound)) {
        expect(read.segments).toEqual([]);
      }
    }
  });

  it('lights the tube again at full brightness, not a dim frame', () => {
    // The first read that sees anything after the note, and it has to be at the
    // level the tube was at before it - the sweep either side of a note is
    // measured against its own length, not against the note's.
    //
    // This is the assertion that catches the second half of the fix. With the
    // stall left in the frame period, the frame that contains a note is the
    // note's length longer and every duty in it collapses by the same factor:
    // measured, this first read came back at 0.0147 against a normal 0.0890,
    // one sixth of the level, and showed as a dim frame after every beep.
    for (const note of marchNotes) {
      const before = samples.filter((sample) => sample.cycle < note.firstEdge).slice(-1);
      const normal = peakDuty(before[0] as RenderSample);
      expect(normal).toBeGreaterThan(0);

      const after = samples.filter((sample) => sample.cycle > note.lastEdge).slice(0, 3);
      const firstLit = after.find((sample) => sample.segments.length > 0);
      expect(firstLit).toBeDefined();
      expect(peakDuty(firstLit as RenderSample)).toBeGreaterThan(normal * 0.9);
    }
  });

  it('is dark for a real fraction of the run, which is what the tube being off looks like', () => {
    // vfd-appearance.md measures 14-17% of camera frames fully dark during
    // active play against 0% in its quiet control window. The floor here is
    // under that because how often the game triggers a sound is provisional
    // cadence, not this test's subject - what is asserted is that the blanking
    // is a substantial fraction of what a viewer sees, not a transient.
    //
    // **It was 0.1 and it is now 0.04, and that is worth reading before it is
    // read as a loosened guardrail.** It used to clear 10% on the battleship
    // alone: the boat crossed 51 times a minute and blanked the tube for 68 ms
    // three times a crossing, which is about 10 s of dark in every minute from
    // one sound.
    //
    // **The battleship now contributes none of this figure.** Its buzz is
    // clocked by the display sweep out of `dwell` instead of played by
    // `note_loop`, so the tube goes on scanning for the whole of a crossing -
    // measured, the worst blank in the 600 ms after an arrival fell from
    // 383.5 ms to 1.5 ms. What is counted here is the march and the missile.
    //
    // So the shortfall against 14-17% is real and it is **not** the battleship's
    // to make up. `IMG_6113.mov` measures a march beep every 0.71 s; this ROM's
    // slowest rung, which is where a freshly powered machine starts, is 1995 ms.
    // Roughly three times too few beeps, against roughly three times too little
    // blanking. That is the cadence question T2 - see the note in
    // docs/evidence/open-questions.md - and not something to fix by putting the
    // battleship's note back.
    const dark = samples.filter((sample) => sample.segments.length === 0);
    expect(dark.length / samples.length).toBeGreaterThan(0.04);
  });
});
