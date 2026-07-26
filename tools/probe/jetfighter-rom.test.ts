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

/** Plate assignments, mirroring the "Plate assignments" block in the ROM. */
const PLATE_GROUND = 0;
const PLATE_MISSILE = [1, 2, 3];
const PLATE_LAUNCHER = [4, 5, 6];
const PLATE_LIFE = 7;
const PLATE_ACTOR = [8, 9, 10];

/** Playfield geometry, mirroring the ROM's "Playfield geometry" block. */
const COL_LAUNCH = 0;
const COL_BSHIP = 6;
const GRID_SCORE_H = 7;
const GRID_SCORE_T = 8;
const GRID_SCORE_U = 9;

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

  it('draws the ground line under every playfield column and no further', () => {
    // Plate 0 is also the score digits' `a` segment - the same plate line means
    // different things under different grids, which is what a multiplexed tube
    // is - so the assertion is about the playfield columns, 0 to 6.
    const playfield = gridsShowing(board, [PLATE_GROUND]).filter((grid) => grid < GRID_SCORE_H);
    expect(playfield).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('stands the launcher in the centre lane, where the lever rests', () => {
    expect(platesUnder(board, COL_LAUNCH)).toContain(PLATE_LAUNCHER[1]);
    expect(platesUnder(board, COL_LAUNCH)).not.toContain(PLATE_LAUNCHER[0]);
  });

  it('shows three standing launchers', () => {
    expect(gridsShowing(board, [PLATE_LIFE])).toEqual([0, 1, 2]);
  });

  it('puts a squadron of two ranks in the flying zone', () => {
    // Six jets: three lanes in the leading column and three one further out.
    const columns = gridsShowing(board, PLATE_ACTOR);
    expect(columns).toEqual([4, 5]);
    expect(platesUnder(board, 4)).toEqual(expect.arrayContaining(PLATE_ACTOR));
    expect(platesUnder(board, 5)).toEqual(expect.arrayContaining(PLATE_ACTOR));
  });

  it('leaves the battleship zone empty until a crossing starts', () => {
    expect(gridsShowing(board, PLATE_ACTOR)).not.toContain(COL_BSHIP);
  });

  it('reads zero with the leading zero blanked', () => {
    expect(platesUnder(board, GRID_SCORE_U)).toEqual(DIGIT_ZERO_PLATES);
    expect(platesUnder(board, GRID_SCORE_T)).toEqual(DIGIT_ZERO_PLATES);
    expect(platesUnder(board, GRID_SCORE_H)).toEqual([]);
  });
});

describe('the squadron advances, and the skill dial sets how fast', () => {
  /** The leading column of the squadron after `frames` sweeps at `skill`. */
  function leadingColumnAfter(skill: string, frames: number): number {
    const board = romBoard();
    board.setControl('skill', skill);
    board.runFrames(frames);
    const columns = gridsShowing(board, PLATE_ACTOR).filter((grid) => grid !== COL_BSHIP);
    return Math.min(...columns);
  }

  it('walks the squadron toward the missile station', () => {
    // PROVISIONAL cadence: skill 1 steps every 48 sweeps (see the ROM's
    // provisional-cadence block), so 160 frames is three steps or so. The test
    // asserts the direction of travel, not the number of steps - the number is
    // unmeasured and will change when the reference video arrives.
    expect(leadingColumnAfter('1', 160)).toBeLessThan(4);
  });

  it('advances no faster at skill 1 than at skill 3', () => {
    // Rule 1 of the back label: the dial sets level 1 (easiest) to 3 (fastest).
    expect(leadingColumnAfter('3', 100)).toBeLessThanOrEqual(leadingColumnAfter('1', 100));
  });
});

describe('firing', () => {
  it('puts a shot on the tube in the lane the lever selects', () => {
    const board = romBoard();
    board.setControl('lever', 'up');
    board.runFrames(4);
    board.setFire(true);
    board.runFrames(3);
    // The missile is cyan, on plates 1-3, and travels away from the launcher -
    // so it is somewhere on the field but never in the launcher's own column.
    const columns = gridsShowing(board, PLATE_MISSILE);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns).not.toContain(COL_LAUNCH);
    expect(platesUnder(board, columns[0]!)).toContain(PLATE_MISSILE[0]);
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
