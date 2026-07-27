// The blank on the glass: the whole path from the ROM's parked sweep to what a
// viewer sees, driven the way src/main.ts drives it.
//
// sweep-timing.test.ts asserts the two ends of this separately - that the ROM
// drives no grid for the whole of every sound (D1), and that
// `Board.getLitSegments()` reports the tube dark while it does. Neither of them
// draws anything, and a duty of zero that the renderer smooths back into
// visibility is not a fix: `PhosphorField` integrates duty over time with a
// decay constant, so a value can be right at the board's edge and still leave
// the tube visibly lit on the canvas.
//
// So this test runs the real machine into a real renderer:
//
//   1. step the board by the cycles a 60 Hz frame is worth, as main.ts does;
//   2. read `board.getLitSegments()`, as main.ts does;
//   3. `renderer.draw(segments, 16.67)`, as main.ts does;
//   4. read what came out - the phosphor level of every segment in the atlas,
//      and the fills the renderer actually issued.
//
// The renderer gets a recording 2D context rather than a canvas, which is the
// same way renderer.test.ts drives it; nothing here needs a DOM.
//
// What each assertion would have caught:
//
//   - "dark for the whole of every march note" fails against the surface as it
//     stood before this work, with the tube fully lit throughout the note.
//   - "lit before" and "lit after" fail against a machine that has wedged with
//     its grids low, which "dark while the speaker sounds" is otherwise
//     trivially true of.
//   - "at full level after" fails if the blank is left inside the frame period
//     it fell in: the sweep after a note then reads at about a sixth of its
//     duty, which reaches the glass as a dim frame after every beep.
//
// The note measured is a march note, ~68 ms. It is the shortest of the common
// sounds and the one that fires on nearly every sweep in which a jet stepped, so
// a fix that only blanks the 637 ms loss sequence passes a test built on the
// loss sequence and fails this one.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';
import { REFRESH_TIMEOUT_CYCLES } from '../../src/machine/board/display.js';
import { loadAtlas } from '../../src/machine/tube/atlas.js';
import type { SegmentId } from '../../src/machine/tube/atlas-schema.js';
import { createFakeContext, type FakeCanvasContext } from '../../src/machine/tube/fake-canvas.js';
import { BACKGROUND, MIN_VISIBLE_BRIGHTNESS, SILKSCREEN, ghostFill } from '../../src/machine/tube/palette.js';
import { createTubeRenderer, type TubeRenderer } from '../../src/machine/tube/renderer.js';

/** How often main.ts reads the tube and draws it: one 60 Hz frame. */
const FRAME_MS = 1000 / 60;

/** The same interval in machine cycles, at the 400 kHz oscillator. */
const FRAME_CYCLES = Math.round(CYCLE_HZ / 60);

/**
 * Cycles the machine is advanced between checks of the read clock.
 *
 * main.ts hands the board a whole frame's budget in one call; stepping in small
 * slices instead lands each read within a few hundred cycles of its due time,
 * which is what lets a read be placed relative to a note's edges. The board sees
 * no difference - `step` is a budget, not a schedule.
 */
const SLICE_CYCLES = 200;

/** Machine cycles to run. About 2.3 s, which carries several march notes. */
const RUN_CYCLES = 900_000;

/** Sweeps run off before sampling: the reset and RAM-clear passes. */
const WARMUP_SWEEPS = 5;

/** Silence that separates two sounds, in cycles - 20 ms. Same figure as sweep-timing.test.ts. */
const BURST_GAP_CYCLES = 8000;

/** Bounds on a march note's tone, in ms. The ROM plays it in three bursts, ~68 ms. */
const MARCH_MS_MIN = 50;
const MARCH_MS_MAX = 110;

/**
 * Brightness a segment reaches on a normally refreshed tube.
 *
 * A grid gets about a tenth of the sweep, which `PHOSPHOR.referenceDuty` calls
 * fully lit, so a segment driven for the whole of its slot settles near 1. The
 * floor is set below that rather than at it because the level oscillates by ~1%
 * with where the read lands in the sweep (palette.ts), and because the fixture
 * is a game in play whose segments come and go.
 */
const LIT_BRIGHTNESS = 0.8;

/** A board running the real game ROM, freshly powered on. */
function romBoard(): Board {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  return new Board(romImage(assemble(readFileSync(path, 'utf8'), path)));
}

/** Milliseconds for a cycle count at the 400 kHz oscillator. */
function ms(cycles: number): number {
  return (cycles / CYCLE_HZ) * 1000;
}

/** One sound: a run of D14 edges with no 20 ms of silence inside it. */
interface Sound {
  readonly firstEdge: number;
  readonly lastEdge: number;
}

/** Split a D14 edge stream into sounds at gaps of {@link BURST_GAP_CYCLES}. */
function splitSounds(edgeCycles: readonly number[]): Sound[] {
  const sounds: Sound[] = [];
  if (edgeCycles.length === 0) return sounds;
  let first = edgeCycles[0] as number;
  let last = first;
  for (const cycle of edgeCycles.slice(1)) {
    if (cycle - last > BURST_GAP_CYCLES) {
      sounds.push({ firstEdge: first, lastEdge: last });
      first = cycle;
    }
    last = cycle;
  }
  sounds.push({ firstEdge: first, lastEdge: last });
  return sounds;
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
  /** Segments the board reported, each with a duty. */
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
 * Order of operations is main.ts's: advance the machine, drain D14, read the
 * tube, draw it with the same elapsed time the phosphor is integrated over.
 */
function play(board: Board, renderer: TubeRenderer, recorder: FakeCanvasContext, ids: readonly SegmentId[]): {
  frames: Painted[];
  sounds: Sound[];
} {
  const frames: Painted[] = [];
  const edgeCycles: number[] = [];
  const until = board.cycles + RUN_CYCLES;
  let nextRead = board.cycles + FRAME_CYCLES;

  while (board.cycles < until) {
    board.step(SLICE_CYCLES);
    edgeCycles.push(...board.takeSpeakerEdges().map((edge) => edge.cycle));
    if (board.cycles < nextRead) continue;

    const segments = board.getLitSegments();
    recorder.calls.length = 0;
    renderer.draw(segments, FRAME_MS);

    let peakBrightness = 0;
    for (const id of ids) {
      const level = renderer.brightnessOf(id);
      if (level > peakBrightness) peakBrightness = level;
    }
    frames.push({
      cycle: board.cycles,
      reported: segments.length,
      peakDuty: segments.reduce((peak, segment) => Math.max(peak, segment.duty), 0),
      peakBrightness,
      emitting: emittingSegments(recorder),
    });
    nextRead += FRAME_CYCLES;
  }

  return { frames, sounds: splitSounds(edgeCycles) };
}

describe('the blank the ROM makes reaches the glass (D1)', () => {
  const board = romBoard();
  board.runFrames(WARMUP_SWEEPS);

  const { ctx, recorder } = createFakeContext();
  // Glow off: the bloom is a second fill of the same colour per segment and
  // this test counts fills. It changes nothing about brightness.
  const renderer = createTubeRenderer(ctx, { glow: false });
  renderer.resize(726, 600, 1);
  const ids = loadAtlas().segments.map((segment) => segment.id);

  const { frames, sounds } = play(board, renderer, recorder, ids);
  const marchNotes = sounds.filter((sound) => {
    const toneMs = ms(sound.lastEdge - sound.firstEdge);
    return toneMs > MARCH_MS_MIN && toneMs < MARCH_MS_MAX;
  });

  /**
   * Frames drawn while `sound` was playing, once the refresh timeout has run
   * out. The first 5 ms of a blank is the threshold's cost and is not what this
   * asserts about; everything after it is.
   */
  function framesDuring(sound: Sound): Painted[] {
    return frames.filter(
      (frame) => frame.cycle >= sound.firstEdge + REFRESH_TIMEOUT_CYCLES && frame.cycle <= sound.lastEdge,
    );
  }

  it('drew several march notes worth of frames, so there is something to assert about', () => {
    expect(marchNotes.length).toBeGreaterThanOrEqual(3);
    expect(frames.length).toBeGreaterThan(100);
  });

  it('paints a lit tube while the sweep is running', () => {
    // The control, and the thing that stops every assertion below from being
    // satisfied by a machine that never lights up at all.
    const lit = frames.filter((frame) => frame.peakBrightness >= LIT_BRIGHTNESS);
    expect(lit.length).toBeGreaterThan(frames.length * 0.5);
    for (const frame of lit) {
      expect(frame.emitting).toBeGreaterThan(0);
    }
  });

  it('paints nothing at all for the whole of every march note', () => {
    for (const note of marchNotes) {
      const during = framesDuring(note);
      // A ~68 ms note against a 16.7 ms frame leaves three frames or so inside
      // it. Asserting there are any is what stops this passing on an empty
      // window.
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
    // longer: duty ~0.0147 against a normal ~0.0890, which the phosphor's own
    // curve turns into about 0.29 of full brightness - a visibly dim frame
    // after every beep rather than a tube that comes straight back.
    for (const note of marchNotes) {
      const after = frames.filter((frame) => frame.cycle > note.lastEdge);
      const firstLit = after.find((frame) => frame.reported > 0) as Painted;
      expect(firstLit).toBeDefined();
      expect(firstLit.peakBrightness).toBeGreaterThanOrEqual(LIT_BRIGHTNESS);
      expect(firstLit.emitting).toBeGreaterThan(0);
    }
  });

  it('leaves the tube dark for a tenth of the frames a viewer sees', () => {
    // vfd-appearance.md measures 14-17% of camera frames fully dark during
    // active play against 0% in its quiet control window. The floor is under
    // that because how often the game triggers a sound is provisional cadence
    // and not this test's subject; what is asserted is that the blanking is a
    // substantial share of what reaches the glass rather than a transient.
    const dark = frames.filter((frame) => frame.emitting === 0);
    expect(dark.length / frames.length).toBeGreaterThan(0.1);
  });
});
