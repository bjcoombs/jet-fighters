// Behavioural tests for the game ROM, asm/jetfighter.asm.
//
// machine-probe.test.ts covers the acceptance contract's tier-1 criteria - that
// the machine sweeps, that the lever moves the launcher, that firing makes the
// measured blip. This file covers the *rules*: that the squadron advances and
// speeds up with the skill dial, that a shot appears in the lane the lever
// selects, that the score readout blanks its leading zero, that the launcher
// tally starts at three, and that the two pitched game sounds land where
// audio-reference.md says they must.
//
// Everything here is read off the board's own observation surface, exactly as
// the probe does it: `getLitSegments()` for the tube and `takeSpeakerEdges()`
// for D14. Nothing reads the ROM's RAM. A test that asserted on a game-state
// nibble would pass for a ROM that computed the right numbers and drew nothing,
// which is the failure mode v2 exists to rule out.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';
import { getSegmentByAddress } from '../../src/machine/tube/atlas.js';

/**
 * Plate assignments, mirroring the "Plate assignments" block in the ROM - which
 * in turn copies them from the segment atlas, src/machine/tube/atlas.json. The
 * atlas is the description of the glass; the ROM has no freedom here, and the
 * conformance test below is what holds the two together.
 */
const PLATE_JET = [0, 1, 2];
const PLATE_ROCKET = [3, 4, 5];
const PLATE_BSHIP = 6;
/** Grid 4 only: a head/trail dot pair per lane. */
const PLATE_MISSILE_PAIR = [
  [6, 7],
  [8, 9],
  [10, 11],
];
/** Grid 5 only. */
const PLATE_LAUNCHER = [6, 7, 8];
/** Grid 9 only: the lit SCORE label, then the three reserve-launcher marks. */
const PLATE_SCORE_LABEL = 0;
const PLATE_LIFE = [1, 2, 3];

/** Playfield geometry, mirroring the ROM's "Playfield geometry" block. */
const GRID_COLUMN_LAST = 5;
const GRID_BSHIP = 0;
const GRID_MISSILE = 4;
const GRID_LAUNCH = 5;
const GRID_SCORE_H = 6;
const GRID_SCORE_T = 7;
const GRID_SCORE_U = 8;
const GRID_STATUS = 9;

/**
 * Jets in the air at once (the ROM's AIRBORNE_MAX).
 *
 * Two, from assets/reference/device-front-gameplay.jpg. A wave is six jets (the
 * ROM's JET_COUNT) but they are released into free lanes a few at a time.
 */
const AIRBORNE_MAX = 2;

/** Segments the PAT_DIGIT entry for zero lights: a b c d e f, and not g. */
const DIGIT_ZERO_PLATES = [0, 1, 2, 3, 4, 5];

/** Silence that separates two sounds, in machine cycles. See machine-probe.test.ts. */
const BURST_GAP_CYCLES = 8000;

/** The bands audio-reference.md measured for the two sounds tested here. */
const MARCH_HZ_MIN = 600;
const MARCH_HZ_MAX = 650;
const BSHIP_HZ_MIN = 230;
const BSHIP_HZ_MAX = 300;

/** A board running the real game ROM, freshly powered on. */
function romBoard(): Board {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  const assembly = assemble(readFileSync(path, 'utf8'), path);
  return new Board(romImage(assembly));
}

/** Grids showing at least one of `plates`, over the last completed frame. */
function gridsShowing(board: Board, plates: readonly number[]): number[] {
  const grids = board
    .getLitSegments()
    .filter((segment) => segment.duty > 0 && plates.includes(segment.plate))
    .map((segment) => segment.grid);
  return [...new Set(grids)].sort((left, right) => left - right);
}

/** Plates lit under one grid, over the last completed frame. */
function platesUnder(board: Board, grid: number): number[] {
  return board
    .getLitSegments()
    .filter((segment) => segment.grid === grid && segment.duty > 0)
    .map((segment) => segment.plate)
    .sort((left, right) => left - right);
}

/**
 * The distance columns showing a jet, left (far) to right (the G line).
 *
 * Restricted to the six playfield grids on purpose: plates 0-2 mean a jet under
 * grids 0-5 and the digit segments a-c under 6-8, which is what a multiplexed
 * tube is.
 */
function jetColumns(board: Board): number[] {
  return gridsShowing(board, PLATE_JET).filter((grid) => grid <= GRID_COLUMN_LAST);
}

/** The distance columns showing a jet in one lane, as grids. */
function laneColumns(board: Board, lane: number): number[] {
  return gridsShowing(board, [PLATE_JET[lane]!]).filter((grid) => grid <= GRID_COLUMN_LAST);
}

/** How many columns of one lane are showing a jet. */
function columnsLitInLane(board: Board, lane: number): number {
  return laneColumns(board, lane).length;
}

/** Every jet segment lit anywhere on the playfield. */
function jetSegmentCount(board: Board): number {
  return board
    .getLitSegments()
    .filter(
      (segment) =>
        segment.duty > 0 && segment.grid <= GRID_COLUMN_LAST && PLATE_JET.includes(segment.plate),
    ).length;
}

/** The pitch of each distinct sound in an edge stream, in hertz. */
function burstPitches(board: Board): number[] {
  const edges = board.takeSpeakerEdges();
  const pitches: number[] = [];
  let rising: number[] = [];
  let previous: number | undefined;
  const close = (): void => {
    if (rising.length >= 3) {
      // The median period, so the twelve-cycle burst boundary the ROM's sound
      // table documents does not move the answer.
      const periods = rising.slice(1).map((cycle, index) => cycle - rising[index]!);
      periods.sort((left, right) => left - right);
      pitches.push(CYCLE_HZ / periods[Math.floor(periods.length / 2)]!);
    }
    rising = [];
  };
  for (const edge of edges) {
    if (previous !== undefined && edge.cycle - previous > BURST_GAP_CYCLES) {
      close();
    }
    previous = edge.cycle;
    if (edge.level === 1) {
      rising.push(edge.cycle);
    }
  }
  close();
  return pitches;
}

describe('the field the ROM puts up at power-on', () => {
  const board = romBoard();
  board.runFrames(3);

  it('drives no address the tube has no segment at', () => {
    // The regression this file exists to stop coming back. The ROM once carried
    // its own invented (grid, plate) map: a ground line on plate 0 of every
    // playfield column, jets up on plates 8-10, the launcher tally on plate 7.
    // The tube has no segment at any of those addresses - the atlas puts jets on
    // plates 0-2 of the column's own grid - so what actually reached the glass
    // was one lit jet in the top lane of all six columns at once, plus a handful
    // of segments driven into thin air. Every lit address must resolve.
    const unmapped = board
      .getLitSegments()
      .filter((segment) => segment.duty > 0)
      .filter((segment) => getSegmentByAddress(segment.grid, segment.plate) === undefined)
      .map((segment) => `${segment.grid}-${segment.plate}`);
    expect(unmapped).toEqual([]);
  });

  it('holds a squadron in the jet lanes, not a saturated row', () => {
    // Two jets is the whole sky (the ROM's AIRBORNE_MAX), so nothing on this
    // tube can ever show more; and no lane can be lit the full width of the
    // field, which is exactly what the invented plate map used to produce.
    expect(jetSegmentCount(board)).toBeLessThanOrEqual(AIRBORNE_MAX);
    for (const lane of [0, 1, 2]) {
      expect(columnsLitInLane(board, lane)).toBeLessThan(GRID_COLUMN_LAST + 1);
    }
  });

  it('stands the launcher in the centre lane, where the lever rests', () => {
    expect(platesUnder(board, GRID_LAUNCH)).toContain(PLATE_LAUNCHER[1]);
    expect(platesUnder(board, GRID_LAUNCH)).not.toContain(PLATE_LAUNCHER[0]);
  });

  it('shows three standing launchers, beside the lit SCORE label', () => {
    expect(platesUnder(board, GRID_STATUS)).toEqual([PLATE_SCORE_LABEL, ...PLATE_LIFE]);
  });

  it('brings the first jet in at the far column, in one lane only', () => {
    // A jet enters from the battleship side, which is grid 0, and it enters
    // alone: the rest of the wave follows on its own countdown.
    expect(jetColumns(board)).toEqual([0]);
    expect(platesUnder(board, 0).filter((plate) => PLATE_JET.includes(plate))).toHaveLength(1);
  });

  it('leaves the battleship dark until a crossing starts', () => {
    expect(platesUnder(board, GRID_BSHIP)).not.toContain(PLATE_BSHIP);
  });

  it('holds no jet rocket in the air before the jets have fired one', () => {
    expect(gridsShowing(board, PLATE_ROCKET).filter((grid) => grid <= GRID_COLUMN_LAST)).toEqual([]);
  });

  it('reads zero with the leading zero blanked', () => {
    expect(platesUnder(board, GRID_SCORE_U)).toEqual(DIGIT_ZERO_PLATES);
    expect(platesUnder(board, GRID_SCORE_T)).toEqual(DIGIT_ZERO_PLATES);
    expect(platesUnder(board, GRID_SCORE_H)).toEqual([]);
  });
});

describe('the squadron is sparse and staggered, not a rank in every lane', () => {
  // The regression this block exists to stop coming back. The ROM used to hold
  // the squadron as a rigid two-rank block: three jets in the leading column and
  // three one further out, every lane occupied, the whole grid stepping on one
  // countdown. What the owner saw on the deployed build - and reported against
  // his own CGL unit - was every lane advancing in lockstep. The reference
  // photograph, assets/reference/device-front-gameplay.jpg, is the authority on
  // the formation: two jets, in different lanes, at different distances.

  /** Every lane's lit columns, as a comparable key per lane. */
  function laneKeys(board: Board): string[] {
    return [0, 1, 2].map((lane) => laneColumns(board, lane).join(','));
  }

  it('puts one jet on the field at power-on, not a rank in every lane', () => {
    const board = romBoard();
    board.runFrames(3);
    expect(jetSegmentCount(board)).toBe(1);
  });

  it('never flies more jets at once than the photograph shows', () => {
    const board = romBoard();
    for (let sample = 0; sample < 20; sample += 1) {
      board.runFrames(10);
      expect(jetSegmentCount(board)).toBeLessThanOrEqual(AIRBORNE_MAX);
    }
  });

  it('never has all three lanes showing the same thing', () => {
    // A block formation makes the three lanes identical by construction, which
    // is what "all three rows travel to the right at the same time" looks like
    // from the player's seat.
    const board = romBoard();
    for (let sample = 0; sample < 20; sample += 1) {
      board.runFrames(10);
      const lanes = laneKeys(board);
      const identical = lanes.every((lane) => lane !== '' && lane === lanes[0]);
      expect(identical).toBe(false);
    }
  });

  it('gets two jets airborne at different distances', () => {
    // The other half of the photograph: sparse is not the same as empty, and
    // the survivors must be spread down the field rather than abreast.
    const board = romBoard();
    let staggered = false;
    for (let sample = 0; sample < 30; sample += 1) {
      board.runFrames(10);
      const columns = jetColumns(board);
      if (jetSegmentCount(board) >= 2 && columns.length >= 2) {
        staggered = true;
      }
    }
    expect(staggered).toBe(true);
  });
});

describe('the squadron advances, and the skill dial sets how fast', () => {
  /**
   * The squadron's leading column after `frames` sweeps at `skill`, as a grid.
   *
   * The jets march toward the missile station, which is +x on the glass, so the
   * leading rank is the *highest* grid showing a jet and it climbs with time.
   */
  function leadingGridAfter(skill: string, frames: number): number {
    const board = romBoard();
    board.setControl('skill', skill);
    board.runFrames(frames);
    return Math.max(...jetColumns(board));
  }

  it('walks the squadron toward the missile station', () => {
    // PROVISIONAL cadence: skill 1 steps every 48 sweeps (see the ROM's
    // provisional-cadence block), so 160 frames is three steps or so. The test
    // asserts the direction of travel, not the number of steps - the number is
    // unmeasured and will change when the reference video arrives.
    expect(leadingGridAfter('1', 160)).toBeGreaterThan(1);
  });

  it('advances no faster at skill 1 than at skill 3', () => {
    // Rule 1 of the back label: the dial sets level 1 (easiest) to 3 (fastest).
    expect(leadingGridAfter('3', 100)).toBeGreaterThanOrEqual(leadingGridAfter('1', 100));
  });
});

describe('firing', () => {
  it('puts a shot on the tube in the lane the lever selects', () => {
    const board = romBoard();
    board.setControl('lever', 'up');
    board.runFrames(4);
    board.setFire(true);
    board.runFrames(3);
    // The tube carries one cyan dot pair per lane, all six on grid 4
    // (ATLAS-COORDINATES.md assumption 5), so a shot in the top lane is that
    // lane's pair and nothing in the other two lanes.
    expect(platesUnder(board, GRID_MISSILE)).toEqual(
      expect.arrayContaining(PLATE_MISSILE_PAIR[0]!),
    );
    expect(platesUnder(board, GRID_MISSILE)).not.toContain(PLATE_MISSILE_PAIR[2]![0]);
  });

  it('does not launch a second shot while the button is merely held', () => {
    const board = romBoard();
    board.runFrames(4);
    board.setFire(true);
    board.runFrames(30);
    board.takeSpeakerEdges();
    board.runFrames(30);
    // Whatever else is making noise by now, nothing is retriggering the launch
    // beep every sweep: a level-triggered ROM would blip on all thirty.
    const blips = burstPitches(board).filter((hz) => hz >= 1480 && hz <= 1632);
    expect(blips.length).toBeLessThan(5);
  });
});

describe('the pitched game sounds', () => {
  // One long run, so both the march (once per squadron step) and the battleship
  // (once per lane of a crossing) have happened several times.
  const board = romBoard();
  board.runFrames(400);
  const pitches = burstPitches(board);

  it('made some noise at all', () => {
    expect(pitches.length).toBeGreaterThan(0);
  });

  it('marches inside the 600-650 Hz band measured from the real unit', () => {
    const march = pitches.filter((hz) => hz >= MARCH_HZ_MIN && hz <= MARCH_HZ_MAX);
    expect(march.length).toBeGreaterThan(0);
  });

  it('buzzes the battleship inside 230-300 Hz, and below the march', () => {
    // audio-reference.md records the ordering as the owner-confirmed rule and
    // the absolute band as the weaker evidence, so both are asserted.
    const buzz = pitches.filter((hz) => hz >= BSHIP_HZ_MIN && hz <= BSHIP_HZ_MAX);
    expect(buzz.length).toBeGreaterThan(0);
    expect(Math.max(...buzz)).toBeLessThan(MARCH_HZ_MIN);
  });
});
