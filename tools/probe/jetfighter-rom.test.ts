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
// the probe does it: `getFrame()` for the tube and `takeSpeakerEdges()` for
// D14. Nothing reads the ROM's RAM. A test that asserted on a game-state nibble
// would pass for a ROM that computed the right numbers and drew nothing, which
// is the failure mode v2 exists to rule out.
//
// `getFrame()` and not `getLitSegments()`, and the difference matters: the
// latter is what a viewer sees *now*, which is nothing at all while the ROM has
// the sweep parked to bit-bang the speaker (docs/evidence/vfd-appearance.md D1).
// Every question in this file is about what the ROM drew - which grid carries a
// jet, whether the units digit is ever blanked - so the right surface is the
// last sweep the tube completed, not the instant a read happened to land on.
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
import { ROM_PROGRAM_SIZE } from '../../src/machine/cpu/memory.js';

/**
 * Plate assignments, mirroring the "Plate assignments" block in the ROM - which
 * in turn copies them from the segment atlas, src/machine/tube/atlas.json. The
 * atlas is the description of the glass; the ROM has no freedom here, and the
 * conformance test below is what holds the two together.
 */
const PLATE_JET = [0, 1, 2];
const PLATE_ROCKET = [3, 4, 5];
/** Grid 0 only: the battleship, which has a cell of its own and no jet in it. */
const PLATE_BSHIP = [0, 1, 2];
/**
 * The player's own object in a cell: the missile dart under grids 0-4, the
 * launcher under grid 5. One plate per lane, and the grid says which it is.
 */
const PLATE_PLAYER = [6, 7, 8];
const PLATE_MISSILE = PLATE_PLAYER;
const PLATE_LAUNCHER = PLATE_PLAYER;
/**
 * The burst in a cell: a jet dying under grids 0-3, the player's own
 * destruction under grid 5. Grid 4 carries no segment on these plates.
 */
const PLATE_BURST = [9, 10, 11];
/** Grid 9 only: the lit SCORE label. */
const PLATE_SCORE_LABEL = 0;

/** Playfield geometry, mirroring the ROM's "Playfield geometry" block. */
const GRID_COLUMN_LAST = 6;
/** The battleship's own cell, at the far end. No jet is printed in it. */
const GRID_BSHIP = 0;
/** The far jet column: where a jet enters the field. */
const GRID_JET_FAR = 1;
/** The column a shot launches into, as a grid: the cell next to the launcher. */
const GRID_MISSILE_START = 5;
/** The player's own cell, at the G line. No jet is printed in it either. */
const GRID_LAUNCH = 6;
/** Two digit cells, not three: the tens shares its cell with the hundreds. */
const GRID_SCORE_T = 7;
const GRID_SCORE_U = 8;
/** The hundreds half-digit, on the tens digit's own grid. */
const PLATE_SCORE_HUNDREDS = 7;
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
/** Segments the PAT_DIGIT entry for one lights: b c. */
const DIGIT_ONE_PLATES = [1, 2];
/** A blanked digit column drives no plate at all. */
const DIGIT_BLANK_PLATES: number[] = [];

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
    .getFrame()
    .segments
    .filter((segment) => segment.duty > 0 && plates.includes(segment.plate))
    .map((segment) => segment.grid);
  return [...new Set(grids)].sort((left, right) => left - right);
}

/** Plates lit under one grid, over the last completed frame. */
function platesUnder(board: Board, grid: number): number[] {
  return board
    .getFrame()
    .segments
    .filter((segment) => segment.grid === grid && segment.duty > 0)
    .map((segment) => segment.plate)
    .sort((left, right) => left - right);
}

/**
 * The cells that carry a jet, as grids: 1 to 5.
 *
 * Restricted to those on purpose, because plates 0-2 mean different things
 * under different grids and that is what a multiplexed tube is: a jet under
 * grids 1-5, the **battleship** under grid 0, and the digit segments a-c under
 * 7-8. Counting grid 0 here would read a battleship as three jets.
 */
const isJetCell = (grid: number) => grid >= GRID_JET_FAR && grid < GRID_LAUNCH;

function jetColumns(board: Board): number[] {
  return gridsShowing(board, PLATE_JET).filter(isJetCell);
}

/** The cells showing a jet in one lane, as grids. */
function laneColumns(board: Board, lane: number): number[] {
  return gridsShowing(board, [PLATE_JET[lane]!]).filter(isJetCell);
}

/** How many columns of one lane are showing a jet. */
function columnsLitInLane(board: Board, lane: number): number {
  return laneColumns(board, lane).length;
}

/** Every jet segment lit anywhere on the playfield. */
function jetSegmentCount(board: Board): number {
  return board
    .getFrame()
    .segments
    .filter(
      (segment) =>
        segment.duty > 0 && isJetCell(segment.grid) && PLATE_JET.includes(segment.plate),
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

describe('the program region has room to work in', () => {
  // `.PAGE` starts a routine on a 32-word boundary, which is how a BR is kept
  // inside its own page - but it also pads. Sixty of them cost 783 words of
  // padding against 1240 words of code, and left the ROM ten words from the
  // ceiling with nearly a quarter of the region empty. Only twenty-four
  // routines actually reach across a boundary; the rest were paying for
  // alignment they did not use.
  //
  // This is a ratchet, not a size limit. It fails when the padding creeps back,
  // which is the failure that is otherwise invisible until the next change has
  // nowhere to go - and by then it looks like the ROM being full rather than
  // the ROM being mostly gaps.
  it('spends more of the program region on code than on alignment padding', () => {
    const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
    const assembly = assemble(readFileSync(path, 'utf8'), path);
    const addresses = assembly.words
      .map((word) => word.address)
      .filter((address) => address < ROM_PROGRAM_SIZE);
    const code = addresses.length;
    const padding = Math.max(...addresses) + 1 - code;

    // Padding rather than total size, because the ratchet has to let real code
    // in and keep alignment waste out. A `.PAGE` on a routine that does not
    // need one adds no instructions and still consumes the rest of its page, so
    // it shows up here and nowhere else. 304 words at the time of writing,
    // against 783 before the unneeded directives came out.
    expect(padding, `${code} words of code, ${padding} of padding`).toBeLessThan(400);
  });
});

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
    // of segments driven into thin air. The launcher tally on grid 9's plates
    // 1-3 was the last of them: this unit has no lives display, so the ROM now
    // draws the SCORE label alone on that grid. Every lit address must resolve.
    const unmapped = board
      .getFrame()
      .segments
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

  it('lights the SCORE label, and only that, on the status grid', () => {
    // The tube has nothing else on this grid: no lives display, owner-confirmed.
    expect(platesUnder(board, GRID_STATUS)).toEqual([PLATE_SCORE_LABEL]);
  });

  it('brings the first jet in at the far column, in one lane only', () => {
    // A jet enters from the battleship side, which is grid 1 - the battleship
    // has grid 0 to itself and no jet is printed in that cell - and it enters
    // alone: the rest of the wave follows on its own countdown.
    expect(jetColumns(board)).toEqual([GRID_JET_FAR]);
    expect(
      platesUnder(board, GRID_JET_FAR).filter((plate) => PLATE_JET.includes(plate)),
    ).toHaveLength(1);
  });

  it('prints no jet in the battleship cell or the player cell, so drives none', () => {
    // The two end cells carry no aircraft on the glass. Their jet plates are
    // unwired, and a jet drawn there would be the phantom-segment fault again.
    for (const grid of [GRID_BSHIP, GRID_LAUNCH]) {
      for (const plate of PLATE_JET) {
        expect(platesUnder(board, grid), `grid ${grid} plate ${plate}`).not.toContain(plate);
      }
    }
  });

  it('leaves the battleship dark until a crossing starts', () => {
    // All three lanes, not just the centre one: the tube has a ship segment per
    // lane and none of them may be lit before a crossing.
    for (const plate of PLATE_BSHIP) {
      expect(platesUnder(board, GRID_BSHIP), `plate ${plate}`).not.toContain(plate);
    }
  });

  it('leaves every burst plate dark, because nothing has been destroyed', () => {
    for (let grid = 0; grid <= GRID_COLUMN_LAST; grid += 1) {
      for (const plate of PLATE_BURST) {
        expect(platesUnder(board, grid), `grid ${grid} plate ${plate}`).not.toContain(plate);
      }
    }
  });

  it('holds no jet rocket in the air before the jets have fired one', () => {
    expect(gridsShowing(board, PLATE_ROCKET).filter(isJetCell)).toEqual([]);
  });

  it('reads a single 0 at zero, with both leading columns blanked', () => {
    // assets/reference/tube-closeup-score0.webp: the lit unit at a zero score
    // shows one `0`, in the units column, with the tens and hundreds columns
    // dark. This ROM used to light the tens as well and read `00`, because only
    // the hundreds consulted its own digit before drawing. A leading digit is
    // blanked when it and every digit above it is zero; the units digit is not a
    // leading digit, so zero is a lit `0` and never a blank readout.
    expect(platesUnder(board, GRID_SCORE_U)).toEqual(DIGIT_ZERO_PLATES);
    expect(platesUnder(board, GRID_SCORE_T)).toEqual(DIGIT_BLANK_PLATES);
    // The hundreds is a half-digit sharing the tens digit's cell, so "blank"
    // means its one plate is dark rather than a whole column being dark.
    expect(platesUnder(board, GRID_SCORE_T)).not.toContain(PLATE_SCORE_HUNDREDS);
  });
});

describe('the score readout blanks leading digits, and only leading digits', () => {
  /**
   * The board at the first sweep on which the tens column lights.
   *
   * Reaching a two-digit score means actually scoring: the lever rests in the
   * centre lane, which is the lane the battleship crosses, and a battleship is
   * ten points (the printed ruler's "10" over its zone). Firing on alternate
   * sweeps re-triggers the edge-triggered launch each time a shot is spent, so
   * the run lands one on the ship within a few dozen sweeps. Nothing here is
   * timed to a frame number - the loop stops on what the tube shows - so a
   * cadence change moves when this happens without breaking the assertion.
   */
  function boardAtFirstTensDigit(): Board {
    const board = romBoard();
    // 900 sweeps rather than 400: the squadron now steps every 110 sweeps, so
    // jets arrive to be shot at half the rate this budget was written for and a
    // 400-sweep run no longer scores ten. The budget is a search bound, not a
    // property under test.
    for (let frame = 0; frame < 900; frame += 1) {
      board.setFire(frame % 2 === 0);
      board.runFrames(1);
      if (platesUnder(board, GRID_SCORE_T).length > 0) {
        return board;
      }
    }
    throw new Error('the tens column never lit: the run never reached ten points');
  }

  it('lights the tens column once the score reaches ten', () => {
    // assets/reference/tube-closeup-score10.webp: at ten the readout is `10`,
    // so the tens column is a blanked leading zero and not a dark column.
    //
    // The tens digit is pinned at 1 rather than the whole readout at `10`. A
    // score crosses ten by 1, 2, 3 or 10 points at a time, so the first score
    // with a tens digit is somewhere in 10-19 whichever way it got there, and
    // its tens digit is 1 in every case. It used to be exactly `10` because the
    // first ten points always came from the battleship in one hit; that is no
    // longer guaranteed, because a shot now has to be in the ship's own lane to
    // reach it and the ship is drawn in whichever lane it is standing in.
    const board = boardAtFirstTensDigit();
    expect(platesUnder(board, GRID_SCORE_T)).toEqual(DIGIT_ONE_PLATES);
    expect(platesUnder(board, GRID_SCORE_U).length).toBeGreaterThan(0);
    expect(platesUnder(board, GRID_SCORE_T)).not.toContain(PLATE_SCORE_HUNDREDS);
  });

  it('never blanks the units column, at any score it reaches', () => {
    // The units digit is never a leading digit. Whatever the score, and however
    // the game ends, something is always lit under grid 8 once the ROM has drawn
    // a field - a blank readout is not a state the real unit has.
    const board = romBoard();
    board.runFrames(3); // the first sweeps of a power-on, before the field exists
    for (let frame = 0; frame < 400; frame += 1) {
      board.setFire(frame % 2 === 0);
      board.runFrames(1);
      expect(platesUnder(board, GRID_SCORE_U).length).toBeGreaterThan(0);
    }
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

  /**
   * Sweeps between one lane's jet advancing a column, over `frames` sweeps.
   *
   * Measured **per lane**, because that is the quantity `PAT_STEP` controls:
   * each lane carries its own countdown reloaded from the same cadence,
   * deliberately out of phase so the jets step one at a time.
   *
   * This used to track `Math.max` across every lane, which is a different
   * quantity - three lanes stepping out of phase raise the maximum more often
   * than any single jet advances, so what it returned was a beat between lanes
   * rather than the cadence. It read correctly only while the phases were fixed
   * at power-on, and stopped when a jet reaching the G line began costing a
   * launcher instead of ending the game: a lane can now repopulate mid-run,
   * which re-phases it.
   *
   * An interval is recorded only when the lane advances by exactly one from a
   * column it already held, so a capture, a kill, a respawn or a sound blank
   * starts a fresh measurement instead of being averaged into the interval
   * spanning it.
   */
  function stepIntervals(skill: string, frames: number, lane = 0): number[] {
    const board = romBoard();
    board.setControl('skill', skill);
    const out: number[] = [];
    let held = -1;
    let since = 0;
    for (let i = 0; i < frames; i += 1) {
      board.runFrames(1);
      since += 1;
      const columns = laneColumns(board, lane);
      if (columns.length === 0) {
        held = -1;
        since = 0;
        continue;
      }
      const now = Math.max(...columns);
      if (held >= 0 && now === held + 1) {
        out.push(since);
      }
      if (now !== held) {
        held = now;
        since = 0;
      }
    }
    return out;
  }

  it('walks the squadron toward the missile station', () => {
    // Skill 1's fresh squadron steps every 110 sweeps, so 400 frames is three
    // steps or so. This asserts the direction of travel; the next one asserts
    // the rate.
    expect(leadingGridAfter('1', 400)).toBeGreaterThan(1);
  });

  it('steps a fresh skill-1 squadron on PAT_STEP entry 0', () => {
    // 110 sweeps is entry 0 after the ladder was scaled to the slowest steady
    // march the gameplay video shows - 2033 and 2050 ms, two three-column
    // traverses (docs/evidence/timing-analysis.md T1). This guards the sweep
    // count, which is the ROM's own unit; the wall clock it produces depends on
    // how much sound a given game plays.
    //
    // Every cadence here is denominated in sweeps, so if the sweep period is
    // retuned again this number has to move with it or the wall clock silently
    // changes. That this test fails on such a change is the point.
    const intervals = stepIntervals('1', 700);
    expect(intervals.length).toBeGreaterThanOrEqual(3);
    for (const sweeps of intervals) {
      expect(sweeps).toBeGreaterThanOrEqual(108);
      expect(sweeps).toBeLessThanOrEqual(113);
    }
    // 700 sweeps at the slowest cadence in the ladder is the longest emulator
    // run in this file - 1.3 s here, over 5 s on a loaded CI runner - so it sat
    // on the wrong side of vitest's 5 s default and reported the runner's load
    // rather than the ROM's cadence. Nothing is measured by how long it takes,
    // and the same run has failed on main for the same reason.
  }, 30_000);

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
    // The tube carries a dart per lane in each of the five columns the shot
    // crosses, and a shot launches into the column next to the launcher, which
    // is grid 4. So a shot fired with the lever up is that grid's top-lane dart
    // and neither of the other two lanes.
    expect(platesUnder(board, GRID_MISSILE_START)).toContain(PLATE_MISSILE[0]);
    expect(platesUnder(board, GRID_MISSILE_START)).not.toContain(PLATE_MISSILE[1]);
    expect(platesUnder(board, GRID_MISSILE_START)).not.toContain(PLATE_MISSILE[2]);
  });

  it('walks the shot across the field instead of parking it in one column', () => {
    // The regression the whole missile family exists to fix. The atlas used to
    // carry six missile segments on one grid, so the ROM drew every shot parked
    // beside the launcher for its entire flight while the hit tests advanced it
    // column by column somewhere the player could not see. A shot must now be
    // lit in more than one column over its life.
    const board = romBoard();
    board.setControl('lever', 'up');
    board.runFrames(4);
    board.setFire(true);
    const columns = new Set<number>();
    for (let frame = 0; frame < 24; frame += 1) {
      board.runFrames(1);
      for (const grid of gridsShowing(board, [PLATE_MISSILE[0]!])) {
        if (grid <= GRID_COLUMN_LAST && grid !== GRID_LAUNCH) columns.add(grid);
      }
    }
    expect([...columns].sort((left, right) => left - right).length).toBeGreaterThan(1);
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
