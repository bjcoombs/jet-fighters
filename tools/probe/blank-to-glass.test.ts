// The blank on the glass: the whole path from the ROM's parked sweep to what a
// viewer sees, driven the way src/main.ts drives it.
//
// Paths in this file are relative to the repository root.
//
// sweep-timing.test.ts asserts the two ends of this separately - that the ROM
// drives no grid for the whole of every sound (D1), and that the harness's
// `getLitSegments()` reports the tube dark while it does. Neither of them draws
// anything, and a duty of zero that the renderer smooths back into visibility is
// not a fix: `PhosphorField` integrates duty over time with a decay constant, so
// a value can be right at the machine's edge and still leave the tube visibly
// lit on the canvas.
//
// So this test runs the real machine into a real renderer:
//
//   1. step the machine by the cycles a 60 Hz frame is worth, as main.ts does;
//   2. read `getLitSegments()`, as main.ts does;
//   3. `renderer.draw(segments, 16.67)`, as main.ts does;
//   4. read what came out - the phosphor level of every segment in the atlas,
//      and the fills the renderer actually issued.
//
// The renderer gets a recording 2D context rather than a canvas, which is the
// same way renderer.test.ts drives it; nothing here needs a DOM.
//
// The machine underneath is `Tms1370Machine`, and the frame period is the one it
// owns: the sweep wrapping. `src/machine/board/display.ts` closes a frame when a
// grid rises that has already risen, which was right for a machine that drew
// each grid once per sweep; this one draws four passes and visits grid 0 in
// three of them, so that rule would hand the renderer one family at a time.
//
// What each assertion would have caught:
//
//   - "paints nothing for the whole of every march note" fails against a surface
//     that reports the last completed sweep while the sweep is stopped, with the
//     tube fully lit throughout the note.
//   - "lit before" and "lit after" fail against a machine that has wedged with
//     its grids low, which "dark while the speaker sounds" is otherwise
//     trivially true of.
//   - "at full brightness after" fails if the blank is left inside the frame
//     period it fell in: the sweep after a note then reads at a fraction of its
//     duty, which reaches the glass as a dim frame after every beep.
//
// The note measured is a march note, 71 ms. It is the shortest of the common
// sounds that blank and the one that fires on every squadron step, so a fix that
// only blanks the loss sequence passes a test built on the loss sequence and
// fails this one.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import {
  BURST_GAP_CYCLES,
  REFRESH_TIMEOUT_CYCLES,
  STEP_CYCLES,
  SWEEP_INSTRUCTIONS,
} from '../../src/machine/board/tms1370-cadence.js';
import { loadAtlas } from '../../src/machine/tube/atlas.js';
import type { SegmentId } from '../../src/machine/tube/atlas-schema.js';
import { createFakeContext, type FakeCanvasContext } from '../../src/machine/tube/fake-canvas.js';
import {
  BACKGROUND,
  MIN_VISIBLE_BRIGHTNESS,
  SILKSCREEN,
  ghostFill,
} from '../../src/machine/tube/palette.js';
import { LIT_BRIGHTNESS } from '../../src/machine/tube/phosphor.js';
import { createTubeRenderer, type TubeRenderer } from '../../src/machine/tube/renderer.js';
import { Tms1370Machine, assembleGame, type InputEvent } from './tms1370-probe.js';

/** How often main.ts reads the tube and draws it: one 60 Hz frame. */
const RENDER_HZ = 60;
const FRAME_MS = 1000 / RENDER_HZ;

/** The same interval in machine cycles, at the TMS1370's instruction rate. */
const FRAME_CYCLES = Math.round(CYCLE_HZ / RENDER_HZ);

/**
 * Cycles the machine is advanced between checks of the read clock.
 *
 * main.ts hands the machine a whole frame's budget in one call; stepping in
 * strobe-sized slices instead lands each read within one grid's dwell of its due
 * time, which is what lets a read be placed relative to a note's edges. The
 * machine sees no difference - `step` is a budget, not a schedule - and
 * `STEP_CYCLES` is the floor below which a caller is sampling inside a single
 * strobe and learning about `strobe` rather than about the game.
 */
const SLICE_CYCLES = STEP_CYCLES;

/** Sweeps run off before sampling: the reset and the ROM's clear of all 112 RAM nibbles. */
const WARMUP_SWEEPS = 5;

/**
 * The ceiling on waiting for one sweep, in cycles.
 *
 * `Tms1370Machine.runSweeps` requires one because the ROM stops sweeping for the
 * whole of every sound and for good once the game ends. Sixty-four sweeps is
 * about a second: past the ~660 ms loss sequence, which is the longest the ROM
 * ever holds the speaker without drawing.
 */
const SWEEP_WAIT_CYCLES = 64 * SWEEP_INSTRUCTIONS;

/** The assembled game ROM, kept so symbol values are read rather than typed. */
const GAME_ASM = assembleGame();

function gameSymbol(name: string): number {
  const found = GAME_ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
}

/**
 * Where the ROM records the battleship's lane, and the value meaning it is not
 * crossing.
 *
 * The battleship buzz is clocked out of `strobe` rather than played by the note
 * loop, so it is the one sound that leaves the tube being swept - that is the
 * whole point of it, since the player has to see the boat to shoot it. Every
 * assertion in this file is about a sound that *blanks*, so a sound overlapping
 * a crossing is excluded from them.
 */
const BSLANE_ADDRESS = gameSymbol('FILE_STATE') * 16 + gameSymbol('NIB_BSLANE');
const BS_NONE = gameSymbol('BS_NONE');

/**
 * The low nibble `step_reload` loads beside `NIB_STEP_HI`.
 *
 * A literal in the ROM rather than a named constant - `TCY NIB_STEP_LO` then
 * `TCMIY 15` - so it is named here instead. If the ROM ever gives it a name,
 * read that symbol and delete this.
 */
const STEP_LO_RELOAD = 15;

/**
 * The squadron's slowest march step, in sweeps.
 *
 * Re-derived from this ROM's own ladder rather than converted from the v2
 * figure. `STEP_HI = STEP_HI_MAX - kills - STEP_SKILL * (skill - 1)`, and a
 * countdown pair on this machine runs for **`hi * 16 + lo + 1`** sweeps - it is
 * spent low first, so the low nibble wrapping is what spends a high one, and the
 * pair is exhausted one sweep after the last high nibble goes. So skill 1 with a
 * full squadron is `STEP_HI_MAX * 16 + 15 + 1` = 160 sweeps: the top of the
 * ladder, the worst case, and where a freshly powered machine starts. The ladder
 * only walks down from there as the player scores, so a window of N of these
 * holds at least N march notes.
 *
 * **This read `STEP_HI_MAX * 16` and was 11% short.** The same arithmetic is done
 * correctly for the battleship's pair in `battleship-arrival.test.ts`, which
 * spells it `BSHIP_STEP_HI * 16 + BSHIP_STEP_LO + 1` - two places computing the
 * same kind of countdown, one of them right. It is written as an expression
 * rather than as 160 so that moving a rung moves this with it.
 */
const MARCH_STEP_SWEEPS = gameSymbol('STEP_HI_MAX') * 16 + STEP_LO_RELOAD + 1;

/**
 * Machine cycles to run, stated in march steps.
 *
 * The window has to be long enough to hold several march steps of the ROM's own,
 * because the march note is what the assertions below are built on and the
 * battleship - which used to fill any window at all with 68 ms notes - now
 * blanks nothing.
 *
 * Stated as a multiple of a cadence read out of the assembly, which is itself a
 * multiple of the measured sweep, rather than as a wall-clock figure - for the
 * reason CLAUDE.md records: a literal horizon in a test about a machine whose
 * cadence moves is a bet on the cadence, and it has turned main red here before.
 * A cadence change now moves `MARCH_STEP_SWEEPS`, which is read rather than
 * written, and nothing else.
 *
 * Seven steps is ~15.4 s of emulated time, 921 drawn frames and six march notes,
 * against the three the assertions below need.
 */
const MARCH_STEPS_DRAWN = 7;
const RUN_CYCLES = MARCH_STEPS_DRAWN * MARCH_STEP_SWEEPS * SWEEP_INSTRUCTIONS;

/**
 * Bounds on a march note's tone, in ms.
 *
 * The ROM plays it in three bursts of fifteen periods at 627 Hz, which
 * `asm/jetfighter.asm` states as 45 periods = 71.8 ms and which measures 71.1 ms
 * on the running machine. The band is wide either side so that it selects the
 * march note against the 18.8 ms fire blip and the ~4 s battleship buzz without
 * pinning the note's own length.
 */
const MARCH_MS_MIN = 50;
const MARCH_MS_MAX = 110;

/**
 * Bounds on a march note's *pitch*, in Hz - the measured band, not a tolerance.
 *
 * `docs/evidence/audio-reference.md` measures jetMarch at 600-650 Hz and the
 * ROM's recipe lands at 627. Duration alone does not identify this note, and
 * relying on it was a real fault rather than a theoretical one: a 71 ms march
 * note followed closely by the 19 ms fire blip is one ~107 ms sound under
 * {@link BURST_GAP_CYCLES}, which falls inside the window above, so the pair was
 * being selected as a single march note. The sweep runs between the two
 * constituent notes - there is time for one, which is the whole reason that
 * threshold is two sweeps - and when that gap is shorter than
 * {@link REFRESH_TIMEOUT_CYCLES} it is not recorded as a hole either, so the lit
 * frames in it counted against an assertion about a dark tube.
 *
 * Pitch separates them where duration cannot: the fused pair carries the blip's
 * edges as well as the march's and measures about 700 Hz, while a march note on
 * its own sits at 627. This narrows the selection rather than loosening the
 * assertion - the test now selects what its name says it does, instead of
 * whatever else happened to last 50 to 110 ms.
 */
const MARCH_HZ_MIN = 600;
const MARCH_HZ_MAX = 650;

/**
 * A drive that plays the game: the lever walks the three lanes and the fire
 * button is pressed once per lap.
 *
 * The same schedule tms1370-rom.test.ts uses, and for the same reason: the
 * machine falls silent unattended, because a squadron that is never shot at
 * takes all three launchers, and a fixture whose subject is a lit tube has to
 * keep the game alive.
 */
function playing(cycles: number, everyCycles = 70_000): InputEvent[] {
  const events: InputEvent[] = [{ cycle: 0, change: { skill: 1 } }];
  for (let at = 0, lane = 0; at < cycles; at += everyCycles, lane = (lane + 1) % 3) {
    events.push({ cycle: at, change: { lane, fire: true } });
    events.push({ cycle: at + 3_000, change: { fire: false } });
  }
  return events;
}

/** A machine running the real game ROM, powered on and past its RAM clear. */
function romMachine(): Tms1370Machine {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1 });
  machine.runSweeps(WARMUP_SWEEPS, SWEEP_WAIT_CYCLES);
  return machine;
}

/** Milliseconds for a cycle count, at the midpoint instruction rate. */
function ms(cycles: number): number {
  return (cycles / CYCLE_HZ) * 1000;
}

/** One sound: a run of R15 edges with no {@link BURST_GAP_CYCLES} of silence in it. */
interface Sound {
  readonly firstEdge: number;
  readonly lastEdge: number;
  /**
   * Stretches inside the sound where the pin was left alone for longer than
   * {@link REFRESH_TIMEOUT_CYCLES}, as `[from, to]` cycle pairs.
   *
   * `BURST_GAP_CYCLES` is two sweeps, which groups two notes played back to back
   * into one sound. The ROM runs a sweep between two such notes when there is
   * time for one, and two sweeps is time for one: a march note running straight
   * into another sound leaves a hole in the middle of what this function calls a
   * single 107 ms sound, and the grids are driven in it. A lit tube there is the
   * machine working, not the blank failing, so the assertions below step around
   * these holes. Same threshold and same reasoning as sweep-timing.test.ts.
   */
  readonly holes: readonly (readonly [number, number])[];
  /** Median repetition rate over the sound's own edges - see {@link toneHz}. */
  readonly hz: number;
  /** Periods that are not the march note's - see {@link foreignPeriods}. */
  readonly foreign: number;
}

/**
 * The dominant repetition rate of one sound, in Hz.
 *
 * The same method `soundHz` in `tms1370-probe.ts` uses, and for its reason: a
 * square wave on one pin has no spectrum worth taking, so the period is the time
 * between every second edge and the honest figure is the median of those. Local
 * rather than imported because this file carries the edge stream as plain cycles.
 */
function toneHz(edgeCycles: readonly number[]): number {
  const periods = periodsOf(edgeCycles);
  if (periods.length === 0) {
    return 0;
  }
  const sorted = [...periods].sort((left, right) => left - right);
  return CYCLE_HZ / (sorted[sorted.length >> 1] as number);
}

/** Every period in an edge stream: the interval between every second edge. */
function periodsOf(edgeCycles: readonly number[]): number[] {
  const periods: number[] = [];
  for (let at = 2; at < edgeCycles.length; at += 2) {
    periods.push((edgeCycles[at] as number) - (edgeCycles[at - 2] as number));
  }
  return periods;
}

/**
 * Periods in an edge stream faster than a march note's, which no march note has.
 *
 * The median {@link toneHz} reports is the right estimator for *a* note's pitch
 * and the wrong discriminator for whether a sound is only that note - a median is
 * robust to a minority tone, which is the very property that makes it a good
 * pitch estimator. A 71 ms march note fused with the 19 ms fire blip carries 44
 * periods at 627 Hz and 29 at 1577, and its median is still 627: in band, and not
 * one note.
 *
 * The test is one-sided, and measurement is what says which side. Read off the
 * running machine, a march note's periods are 627 Hz with a handful at 583 - the
 * boundary between the three bursts `note` builds it from - so a band that
 * excluded 583 would reject every real note, which a first cut of this did. What
 * a march note never carries is anything *faster* than itself: the fire blip is
 * 1577 Hz with 1326 at its own burst boundaries, and the single period spanning
 * the join between two sounds is slower than both (56 Hz). So counting only the
 * periods above the band separates a note from a fusion and leaves the note's own
 * internal structure alone.
 */
function foreignPeriods(edgeCycles: readonly number[]): number {
  return periodsOf(edgeCycles).filter((period) => CYCLE_HZ / period > MARCH_HZ_MAX).length;
}

/** Split an R15 edge stream into sounds at gaps of {@link BURST_GAP_CYCLES}. */
function splitSounds(edgeCycles: readonly number[]): Sound[] {
  const sounds: Sound[] = [];
  if (edgeCycles.length === 0) return sounds;
  let first = edgeCycles[0] as number;
  let last = first;
  let holes: (readonly [number, number])[] = [];
  let members: number[] = [first];
  for (const cycle of edgeCycles.slice(1)) {
    if (cycle - last > BURST_GAP_CYCLES) {
      sounds.push({
        firstEdge: first,
        lastEdge: last,
        holes,
        hz: toneHz(members),
        foreign: foreignPeriods(members),
      });
      holes = [];
      members = [];
      first = cycle;
    } else if (cycle - last > REFRESH_TIMEOUT_CYCLES) {
      holes.push([last, cycle]);
    }
    members.push(cycle);
    last = cycle;
  }
  sounds.push({
    firstEdge: first,
    lastEdge: last,
    holes,
    hz: toneHz(members),
    foreign: foreignPeriods(members),
  });
  return sounds;
}

/** True when `cycle` falls in a stretch of `sound` where the pin was idle. */
function inHole(sound: Sound, cycle: number): boolean {
  return sound.holes.some(([from, to]) => cycle > from && cycle < to);
}

/**
 * Fills the renderer issued that were not the glass or the printing on it.
 *
 * The same reduction renderer.test.ts uses. A dark tube leaves exactly the two
 * ghost-layer fills - unlit phosphor, which is visible on the real tube from
 * ambient light and is drawn whether the machine is running or not. Anything
 * beyond those two is a segment the renderer painted as emitting.
 */
function phosphorFills(recorder: FakeCanvasContext): readonly string[] {
  return recorder.calls
    .filter((call) => call.op === 'fill')
    .map((call) => call.fillStyle)
    .filter((style) => style !== BACKGROUND && style !== SILKSCREEN);
}

/**
 * Segments the renderer painted as emitting in the frame just drawn.
 *
 * The ghost layer is one fill per region and is drawn whatever the tube is
 * doing, so it is checked for and discounted rather than assumed: a count that
 * silently subtracted two from a draw that had skipped the ghost layer would
 * report a lit tube as dark, which is the direction this test must not fail in.
 */
function emittingSegments(recorder: FakeCanvasContext): number {
  const fills = phosphorFills(recorder);
  if (fills[0] !== ghostFill('red') || fills[1] !== ghostFill('cyan')) {
    throw new Error(`the ghost layer was not drawn first: ${fills.slice(0, 2).join(', ')}`);
  }
  return fills.length - 2;
}

/** One frame as the viewer got it: what was handed to the renderer, and what came out. */
interface Painted {
  readonly cycle: number;
  /** Segments the machine reported, each with a duty. */
  readonly reported: number;
  /** Highest duty reported, 0 when the tube is dark. */
  readonly peakDuty: number;
  /** Highest phosphor level any segment reached after this draw. */
  readonly peakBrightness: number;
  /** Segments the renderer painted as emitting - fills beyond the ghost layer. */
  readonly emitting: number;
}

/**
 * Run the machine into the renderer, sampling at the frame rate main.ts runs at.
 *
 * Order of operations is main.ts's: advance the machine, drain R15, read the
 * tube, draw it with the same elapsed time the phosphor is integrated over. The
 * case contacts are worked from the schedule as the run passes it, which is the
 * only way a control reaches the game - nothing here writes game state.
 */
function play(
  machine: Tms1370Machine,
  renderer: TubeRenderer,
  recorder: FakeCanvasContext,
  ids: readonly SegmentId[],
): {
  frames: Painted[];
  sounds: Sound[];
} {
  const frames: Painted[] = [];
  const edgeCycles: number[] = [];
  const crossings: Array<readonly [number, number]> = [];
  let crossingFrom: number | null = null;
  const startCycle = machine.cycles;
  const until = startCycle + RUN_CYCLES;
  let nextRead = startCycle + FRAME_CYCLES;
  const events = playing(RUN_CYCLES);
  let nextEvent = 0;

  while (machine.cycles < until) {
    while (
      nextEvent < events.length &&
      (events[nextEvent] as InputEvent).cycle <= machine.cycles - startCycle
    ) {
      machine.setContacts((events[nextEvent] as InputEvent).change);
      nextEvent += 1;
    }
    machine.step(SLICE_CYCLES);
    edgeCycles.push(...machine.takeSpeakerEdges().map((edge) => edge.cycle));
    const crossing = machine.ram[BSLANE_ADDRESS] !== BS_NONE;
    if (crossing && crossingFrom === null) crossingFrom = machine.cycles;
    if (!crossing && crossingFrom !== null) {
      crossings.push([crossingFrom, machine.cycles]);
      crossingFrom = null;
    }
    if (machine.cycles < nextRead) continue;

    const segments = machine.getLitSegments();
    recorder.calls.length = 0;
    renderer.draw(segments, FRAME_MS);

    let peakBrightness = 0;
    for (const id of ids) {
      const level = renderer.brightnessOf(id);
      if (level > peakBrightness) peakBrightness = level;
    }
    frames.push({
      cycle: machine.cycles,
      reported: segments.length,
      peakDuty: segments.reduce((peak, segment) => Math.max(peak, segment.duty), 0),
      peakBrightness,
      emitting: emittingSegments(recorder),
    });
    nextRead += FRAME_CYCLES;
  }

  if (crossingFrom !== null) crossings.push([crossingFrom, machine.cycles]);
  const overlapsCrossing = (cycle: number): boolean =>
    crossings.some(([from, to]) => cycle >= from && cycle <= to);
  return {
    frames,
    sounds: splitSounds(edgeCycles).filter(
      (sound) => !overlapsCrossing(sound.firstEdge) && !overlapsCrossing(sound.lastEdge),
    ),
  };
}

describe('the blank the ROM makes reaches the glass (D1)', () => {
  const machine = romMachine();

  const { ctx, recorder } = createFakeContext();
  // Glow off: the bloom is a second fill of the same colour per segment and
  // this test counts fills. It changes nothing about brightness.
  const renderer = createTubeRenderer(ctx, { glow: false });
  renderer.resize(726, 600, 1);
  const ids = loadAtlas().segments.map((segment) => segment.id);

  const { frames, sounds } = play(machine, renderer, recorder, ids);
  const marchNotes = sounds.filter((sound) => {
    const toneMs = ms(sound.lastEdge - sound.firstEdge);
    return (
      toneMs > MARCH_MS_MIN &&
      toneMs < MARCH_MS_MAX &&
      sound.hz >= MARCH_HZ_MIN &&
      sound.hz <= MARCH_HZ_MAX &&
      sound.foreign === 0
    );
  });

  /**
   * Frames drawn while `sound` was playing, once the refresh timeout has run
   * out. The first sweep of a blank is the threshold's cost and is not what this
   * asserts about; everything after it is. Frames inside an internal hole are
   * excluded - see {@link Sound.holes}.
   */
  function framesDuring(sound: Sound): Painted[] {
    return frames.filter(
      (frame) =>
        frame.cycle >= sound.firstEdge + REFRESH_TIMEOUT_CYCLES &&
        frame.cycle <= sound.lastEdge &&
        !inHole(sound, frame.cycle),
    );
  }

  it('drew several march notes worth of frames, so there is something to assert about', () => {
    // Measured: six march notes across 921 drawn frames.
    expect(marchNotes.length).toBeGreaterThanOrEqual(3);
    expect(frames.length).toBeGreaterThan(100);
  });

  it('paints a lit tube while the sweep is running', () => {
    // The control, and the thing that stops every assertion below from being
    // satisfied by a machine that never lights up at all.
    //
    // LIT_BRIGHTNESS is imported rather than set here. It used to be a local
    // 0.8, chosen against a ten-grid tube's ~0.1 reference duty; it is now
    // derived in src/machine/tube/phosphor.ts from REFERENCE_DUTY through
    // LIT_DUTY and the gamma - the level a segment held for half the strobe the
    // sweep gives it reaches, about 0.637 - which is what contract criterion V14
    // asks for. Measured, 96.5% of frames clear it and the median frame is at a
    // flat 1.0.
    const lit = frames.filter((frame) => frame.peakBrightness >= LIT_BRIGHTNESS);
    expect(lit.length).toBeGreaterThan(frames.length * 0.5);
    for (const frame of lit) {
      expect(frame.emitting).toBeGreaterThan(0);
    }
  });

  it('paints nothing at all for the whole of every march note', () => {
    for (const note of marchNotes) {
      const during = framesDuring(note);
      // A 71 ms note against a 16.7 ms frame and a 15.2 ms timeout leaves three
      // frames or so inside it - measured, three to five. Asserting there are
      // any is what stops this passing on an empty window.
      expect(during.length).toBeGreaterThanOrEqual(2);
      for (const frame of during) {
        expect(frame.reported).toBe(0);
        // Below the renderer's own visibility floor, and reached through the
        // phosphor's decay rather than by snapping to black.
        expect(frame.peakBrightness).toBeLessThan(MIN_VISIBLE_BRIGHTNESS);
        // And the active layer issued no fill: the ghost layer is all that was
        // drawn, which is a tube with nothing emitting on it.
        expect(frame.emitting).toBe(0);
      }
    }
  });

  it('paints nothing for the whole of every sound, march or not', () => {
    for (const sound of sounds) {
      for (const frame of framesDuring(sound)) {
        expect(frame.peakBrightness).toBeLessThan(MIN_VISIBLE_BRIGHTNESS);
        expect(frame.emitting).toBe(0);
      }
    }
  });

  it('was painting a fully lit tube in the frame before each march note', () => {
    // The anchor. Without it, "dark while the speaker sounds" is also true of a
    // ROM that wedged with its grids low before the sound ever started.
    for (const note of marchNotes) {
      const before = frames.filter((frame) => frame.cycle < note.firstEdge).slice(-1)[0] as Painted;
      expect(before.peakBrightness).toBeGreaterThanOrEqual(LIT_BRIGHTNESS);
      expect(before.emitting).toBeGreaterThan(0);
    }
  });

  it('brings the tube back at full brightness after the note, not a dim frame', () => {
    // The counterpart of the anchor, and the assertion that catches the second
    // half of the fix. With the blank left inside the frame period it fell in,
    // the sweep after a note is measured against a period the note's length
    // longer, and every duty in it collapses by that factor - which the
    // phosphor's own curve turns into a visibly dim frame after every beep
    // rather than a tube that comes straight back.
    //
    // Measured on this machine, the first lit frame after a note comes back at
    // duty 1.4e-2 against a normal 8.0e-3 and a brightness of a flat 1.0.
    for (const note of marchNotes) {
      const after = frames.filter((frame) => frame.cycle > note.lastEdge);
      const firstLit = after.find((frame) => frame.reported > 0) as Painted;
      expect(firstLit).toBeDefined();
      expect(firstLit.peakBrightness).toBeGreaterThanOrEqual(LIT_BRIGHTNESS);
      expect(firstLit.emitting).toBeGreaterThan(0);
    }
  });

  it('leaves the tube dark for a real share of the frames a viewer sees', () => {
    // vfd-appearance.md measures 14-17% of camera frames fully dark during
    // active play against 0% in its quiet control window. The floor is under
    // that because how often the game triggers a sound is provisional cadence
    // and not this test's subject; what is asserted is that the blanking is a
    // substantial share of what reaches the glass rather than a transient.
    //
    // **Re-measured on this ROM: 3.5% of the 921 frames drawn, so the floor is
    // 0.02.** It was 0.04 against a measured 9.0% on the v2 machine. Both the
    // sounds and the sweep are about seven times slower here in cycles, so that
    // is not what moved the share - the difference is the beep cadence, and it
    // is the same shortfall the v2 note ends on.
    //
    // **The battleship contributes no blanking at all**, here as there. Its buzz
    // is clocked by the display sweep rather than played by the note loop, so
    // the tube keeps scanning for the whole of a crossing. What is counted here
    // is the march, the fire blip and the loss sequence.
    //
    // The shortfall against 14-17% belongs to the beep cadence -
    // `IMG_6113.mov` measures a march beep every 0.71 s against this ROM's
    // slowest rung of 144 sweeps, about 2.2 s - which is the open cadence
    // question T2, and not something to fix by putting the battleship's note
    // back. The same note is on the same assertion in sweep-timing.test.ts.
    const dark = frames.filter((frame) => frame.emitting === 0);
    expect(dark.length / frames.length).toBeGreaterThan(0.02);
  });
});
