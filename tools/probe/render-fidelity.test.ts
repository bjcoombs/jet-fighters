// Does the picture on the glass agree with the game state that produced it?
//
// Paths in this file are relative to the repository root.
//
// ## The gap this exists to close
//
// Every other probe suite asserts a *cadence* (`sweep-timing`, the march and gap
// intervals in `battleship-arrival`), a *set* (`rom-atlas-conformance`), or a
// *sound* (`speaker-bands`, `launcher-lives`). Not one of them relates what the
// machine believes to what it draws, at the same instant. So a render step can
// put the right actors in the wrong cells and every one of them stays green.
//
// One did. `rd_jets` initialised `NIB_RLNE` and then wrote the lane bit one
// nibble further up on the assumption that `NIB_RBIT` followed it; `NIB_RBIT` is
// 11 and `NIB_RLNE` is 12, so the bit landed in a nibble nothing reads and the
// jet walk began from whatever the previous sweep's last `lane_bit` caller had
// left behind - usually the lever's own lane. The squadron was drawn offset by
// the lever, and once the walk's doubling pushed the offset past bit 2 the near
// nibble left the NEAR group's 0-7 and indexed FAR instead, so the *near* pass
// emitted a far mask and painted the attackers' rockets into cells no rocket was
// in. The owner reported it as three separate faults: jets that would not
// advance, bullets from all over the place, and bursts nowhere near a jet.
//
// ## Why `rom-atlas-conformance` cannot catch this, and why the bug made it
// ## greener rather than red
//
// This is the load-bearing paragraph, and it is here because it will not be
// obvious to whoever reads these assertions next.
//
// That suite's success metric is coverage: the union of `(grid, plate)` pairs
// the ROM drove over a run must equal the set the atlas defines, in both
// directions. A jet drawn in the wrong lane is a legal atlas address. A phantom
// rocket is a legal atlas address. Both therefore *raise* the coverage it is
// measuring. A suite that asks "was every address driven?" rewards a render step
// for driving addresses it should not have, and the more thoroughly the picture
// is scrambled the more completely the atlas is covered.
//
// So coverage cannot be the only question asked of the render step. The question
// these three assertions ask instead is the complementary one - not "was this
// address ever driven?" but "was it driven *now*, and does the game state at
// this instant justify it?" Neither question implies the other, and the ROM
// passed the first for as long as it failed the second.
//
// ## Reading the display files rather than the pins
//
// The three assertions read `FILE_D0` and `FILE_D1` - the nibbles the render
// step leaves for the sweep to hand `TDO` - rather than the strobes themselves.
// That is deliberate: the nibble *is* the PLA index on this machine (the low
// bits of a low-bank index are the lane bitmap, see `asm/opla.inc.asm`), so a
// wrong nibble is the fault itself rather than a symptom of it, and the failure
// message can name the lane that is wrong instead of a plate mask.
//
// One consequence of that choice has to be allowed for, and getting it wrong is
// what a first draft of this file did. The display files are rewritten once a
// sweep by `render`, *after* the game work that moved the actors, so a sample
// taken between the two shows the previous sweep's picture against this sweep's
// state. That lag is correct behaviour, and it is **not** harmless to the naive
// form of the assertion: a jet that has just marched from grid 2 to grid 3 is
// still drawn at grid 2 for the rest of the sweep, so the picture lights a cell
// the state does not justify *now*. A stale frame is not a subset of a valid
// one; it is a valid frame of a moment that has passed.
//
// So a drawn bit is checked against the state that could have produced it -
// this sample's or one from inside the preceding sweep - and two conditions
// bound that window rather than a tolerance being chosen:
//
//   - samples are taken every 10 ms against a sweep of about 15 ms, so
//     `STALE_SAMPLES` covers one whole sweep and no more;
//   - samples where the tube is not being refreshed are skipped entirely. The
//     ROM stops sweeping for the whole of every sound (`note` does not strobe
//     the grids - that is why the battleship's buzz cannot be a note), so the
//     display files sit frozen for hundreds of milliseconds while the glass is
//     dark. Asserting over those is asserting about a picture nobody can see,
//     and it was what a first draft failed on.
//
// The other direction - a bit an actor wants that the files have not lit yet -
// is asserted over the run rather than per sample: every jet that stands in a
// cell must be drawn there at some point while it stands there.
//
// Neither allowance rescues the fault this file was written for. The old render
// step drew a jet in the lane the *lever* was in, and no recent state ever put a
// jet there, so widening the window in time does not make an offset in lane
// legal.

import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine } from './tms1370-probe.js';

/** RAM files, from the map at the head of `asm/jetfighter.asm`. */
const FILE_D0 = 0;
const FILE_D1 = 1;
const FILE_STATE = 4;
const FILE_JETS = 6;

/** `FILE_STATE` nibbles. */
const NIB_RCOL = 7;
const NIB_RLANE = 8;

/** The playfield columns the squadron flies down: grids 1-5. */
const GRID_COL_FIRST = 1;
const GRID_COL_LAST = 5;
const LANE_COUNT = 3;

/**
 * `OPLA_A_NEAR` is 0 and the near group is indices 0-7, so a near nibble above
 * seven is not a near mask at all - it is index 8-15, which is the FAR group.
 */
const NEAR_INDEX_MAX = 7;

/** `OPLA_A_FAR`: the far group's base index, from `asm/opla.inc.asm`. */
const OPLA_A_FAR = 8;

/** Long enough for several waves, entries, rocket launches and a crossing. */
const RUN_CYCLES = 40 * CYCLE_HZ;

/** A sample every 10 ms, which is well inside one sweep at ~65 Hz. */
const SAMPLE_CYCLES = CYCLE_HZ / 100;

/**
 * Samples a drawn frame may lag the state by: one sweep, and not a tolerance.
 *
 * A sweep is about 15 ms and a sample 10 ms, so two samples span one sweep and
 * this is that plus the sample the render itself fell in.
 */
const STALE_SAMPLES = 3;

interface Sample {
  readonly seconds: number;
  /** Grid each lane's jet stands on, 0 for an empty lane. */
  readonly jets: readonly number[];
  /** Near nibble of grids 1-5, indexed by grid. */
  readonly near: readonly number[];
  /** Far nibble of grids 1-5, indexed by grid. */
  readonly far: readonly number[];
  readonly rocketCol: number;
  readonly rocketLane: number;
  /** False while a sound holds the sweep and the tube is dark. */
  readonly refreshing: boolean;
}

/** Drive the machine with the lever parked, sampling state and display together. */
function sample(lane: number): readonly Sample[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane, fire: false });
  const samples: Sample[] = [];
  while (machine.cycles < RUN_CYCLES) {
    machine.step(SAMPLE_CYCLES);
    const ram = machine.ram;
    const nibble = (file: number, index: number): number => ram[file * 16 + index] as number;
    samples.push({
      seconds: machine.cycles / CYCLE_HZ,
      jets: Array.from({ length: LANE_COUNT }, (_unused, l) => nibble(FILE_JETS, l)),
      near: Array.from({ length: GRID_COL_LAST + 1 }, (_unused, g) => nibble(FILE_D0, g)),
      far: Array.from({ length: GRID_COL_LAST + 1 }, (_unused, g) => nibble(FILE_D1, g)),
      rocketCol: nibble(FILE_STATE, NIB_RCOL),
      rocketLane: nibble(FILE_STATE, NIB_RLANE),
      refreshing: machine.isRefreshing(),
    });
  }
  return samples;
}

/** The lane bitmap the squadron justifies for `grid`, from `FILE_JETS` alone. */
function jetBitmap(jets: readonly number[], grid: number): number {
  return jets.reduce((bits, standsOn, lane) => (standsOn === grid ? bits | (1 << lane) : bits), 0);
}

/**
 * Every lane bitmap for `grid` that this sample or the preceding sweep justify.
 *
 * The union in *time*, never in lane: a jet that was at grid 2 a sweep ago
 * excuses grid 2 still being lit in its own lane, and excuses nothing about any
 * other lane.
 */
function recentlyJustified(
  samples: readonly Sample[],
  index: number,
  grid: number,
  bitmap: (shot: Sample, grid: number) => number,
): number {
  let bits = 0;
  for (let back = 0; back <= STALE_SAMPLES && index - back >= 0; back += 1) {
    bits |= bitmap(samples[index - back] as Sample, grid);
  }
  return bits;
}

/** The lane bitmap the one rocket the ROM can hold justifies for `grid`. */
function rocketBitmap(shot: Sample, grid: number): number {
  return shot.rocketCol === grid && shot.rocketLane < LANE_COUNT ? 1 << shot.rocketLane : 0;
}

/** Every lever detent, because the bug's size was a function of exactly this. */
const DETENTS = [0, 1, 2] as const;

describe('the near pass draws the squadron where the squadron is', () => {
  for (const detent of DETENTS) {
    // The lever is what made the old fault vary: `NIB_RBIT` carried whatever
    // `rd_launcher` left, so lane 0 looked almost right and lane 1 was a
    // catastrophe. A single-lane run would have found it only by luck.
    it(`lights no lane the squadron does not stand in, lever in lane ${detent}`, () => {
      const shots = sample(detent);
      const wrong: string[] = [];
      shots.forEach((shot, index) => {
        if (!shot.refreshing) {
          return; // the tube is dark for the whole of a sound
        }
        for (let grid = GRID_COL_FIRST; grid <= GRID_COL_LAST; grid += 1) {
          const drawn = shot.near[grid] as number;
          if (drawn > NEAR_INDEX_MAX) {
            continue; // asserted at zero by its own test below
          }
          const justified = recentlyJustified(shots, index, grid, (at, g) => jetBitmap(at.jets, g));
          const spurious = drawn & ~justified;
          if (spurious !== 0) {
            wrong.push(
              `t=${shot.seconds.toFixed(2)}s grid ${grid}: near nibble ${drawn} lights ` +
                `lane(s) ${[...Array(LANE_COUNT).keys()].filter((l) => spurious & (1 << l))} ` +
                `with jets at [${shot.jets}]`,
            );
          }
        }
      });
      expect(wrong.slice(0, 5), `${wrong.length} samples drew a jet in a lane no jet was in`).toEqual(
        [],
      );
    });

    it(`draws every jet in the cell it stands in, lever in lane ${detent}`, () => {
      // The lag direction: not per sample, but over each stay. A jet that holds
      // a cell across several sweeps must be drawn there on at least one of
      // them, which is what "the squadron is visible" reduces to.
      //
      // "Long enough" is `STALE_SAMPLES` of *refreshing* samples, and both words
      // carry weight. A stay shorter than one render cycle was never drawable -
      // the jet arrived and was gone before `render` ran again - and a stay that
      // falls inside a sound was drawn to a tube that was dark for the whole of
      // it. Neither is a fault, and neither excuses a stay of ordinary length: a
      // march step is 16 sweeps at its very fastest, two orders of magnitude
      // above this floor, so every stay the squadron makes by marching is
      // asserted over.
      const shots = sample(detent);
      const undrawn: string[] = [];
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        let stayGrid = 0;
        let stayDrawn = false;
        let stayFrom = 0;
        let stayDrawable = 0;
        const closeStay = (at: number): void => {
          if (
            stayGrid >= GRID_COL_FIRST &&
            stayGrid <= GRID_COL_LAST &&
            stayDrawable >= STALE_SAMPLES &&
            !stayDrawn
          ) {
            undrawn.push(
              `lane ${lane} stood on grid ${stayGrid} from t=${stayFrom.toFixed(2)}s to ` +
                `t=${at.toFixed(2)}s and was never drawn there`,
            );
          }
        };
        for (const shot of shots) {
          const standsOn = shot.jets[lane] as number;
          if (standsOn !== stayGrid) {
            closeStay(shot.seconds);
            stayGrid = standsOn;
            stayDrawn = false;
            stayFrom = shot.seconds;
            stayDrawable = 0;
          }
          if (!shot.refreshing) {
            continue;
          }
          stayDrawable += 1;
          if (
            standsOn >= GRID_COL_FIRST &&
            standsOn <= GRID_COL_LAST &&
            ((shot.near[standsOn] as number) & (1 << lane)) !== 0
          ) {
            stayDrawn = true;
          }
        }
        closeStay(shots[shots.length - 1]?.seconds ?? 0);
      }
      expect(undrawn.slice(0, 5), `${undrawn.length} jets were never drawn where they stood`).toEqual(
        [],
      );
    });
  }
});

describe('a near nibble is a near index, and never a far one', () => {
  for (const detent of DETENTS) {
    // The half of the fault the owner reported as "bullets come from all over
    // the place". `AMAAC` is four bits wide and the near group is eight of the
    // sixteen low-bank indices, so a bitmap that overflows past lane 2 does not
    // clip or wrap into nothing - it becomes a *far* index under the same latch,
    // and the near pass emits a mask for plates 3-5. The atlas calls those
    // `rocket_lane{0,1,2}_col{n}`, so the overflow paints the attackers' shots.
    it(`never hands the near pass a far index, lever in lane ${detent}`, () => {
      const overflows: string[] = [];
      for (const shot of sample(detent)) {
        for (let grid = GRID_COL_FIRST; grid <= GRID_COL_LAST; grid += 1) {
          const drawn = shot.near[grid] as number;
          if (drawn > NEAR_INDEX_MAX) {
            overflows.push(
              `t=${shot.seconds.toFixed(2)}s grid ${grid}: near nibble ${drawn} is ` +
                `OPLA_A_FAR + ${drawn - OPLA_A_FAR}, jets at [${shot.jets}]`,
            );
          }
        }
      }
      expect(
        overflows.slice(0, 5),
        `${overflows.length} samples indexed the far group from the near pass`,
      ).toEqual([]);
    });
  }
});

describe('the far pass draws a rocket only where a rocket is', () => {
  for (const detent of DETENTS) {
    // `NIB_RCOL` and `NIB_RLANE` are one nibble each, so the ROM can hold
    // exactly one rocket: one column, one lane. Anything else on a playfield
    // grid's far plates is a phantom, whatever produced it.
    //
    // Worth knowing before this is read as the assertion that caught the
    // phantom rockets: it is not. Those reached the glass through the *near*
    // nibble overflowing into a far index, which is the test above, and this
    // pair of nibbles was correct throughout - it passes on the pre-fix ROM.
    // It is here because the far pass is the other route to the same segments
    // and nothing was watching it.
    it(`lights at most the one rocket the ROM holds, lever in lane ${detent}`, () => {
      const shots = sample(detent);
      const phantoms: string[] = [];
      shots.forEach((shot, index) => {
        if (!shot.refreshing) {
          return;
        }
        for (let grid = GRID_COL_FIRST; grid <= GRID_COL_LAST; grid += 1) {
          const drawn = shot.far[grid] as number;
          const bitmap = drawn >= OPLA_A_FAR ? drawn - OPLA_A_FAR : 0;
          const spurious = bitmap & ~recentlyJustified(shots, index, grid, rocketBitmap);
          if (spurious !== 0) {
            phantoms.push(
              `t=${shot.seconds.toFixed(2)}s grid ${grid}: far nibble lights rocket lane(s) ` +
                `${[...Array(LANE_COUNT).keys()].filter((l) => spurious & (1 << l))} ` +
                `with the rocket at col ${shot.rocketCol} lane ${shot.rocketLane}`,
            );
          }
        }
      });
      // Two rocket lanes lit under one grid fails on the first of them whatever
      // the window allows, because one nibble cannot be stale in two lanes at
      // once and the ROM has only ever held one rocket.
      expect(
        phantoms.slice(0, 5),
        `${phantoms.length} samples drew a rocket the ROM was not flying`,
      ).toEqual([]);
    });
  }
});
