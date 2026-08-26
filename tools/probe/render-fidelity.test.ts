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

import { describe, it, expect, vi } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import {
  Tms1370Machine,
  assembleGame,
  planesOf,
  rowColumns,
  slotsOf,
  squadronMap,
  type Plane,
} from './tms1370-probe.js';

/**
 * Wall-clock allowance for every drive in this file.
 *
 * **Not a measurement of anything, and deliberately generous.** Every bound the
 * drives themselves use is in emulated cycles and is deterministic - the same
 * ROM produces the same run every time. What varies is how long a shared runner
 * takes to execute it, and Vitest's per-test default is five seconds. The
 * slowest test here measures 1.4 s on an idle machine and has been observed at
 * 94 s on a contended one, with three suites competing; a timeout tuned to the
 * idle figure would turn a busy CI runner red for a reason that has nothing to
 * do with the ROM.
 *
 * So this is an escape hatch against starvation rather than a horizon: if a
 * drive ever genuinely hangs it still ends, and if the machine is merely loaded
 * it does not. The figures that mean something are all in cycles.
 */
const DRIVE_TIMEOUT_MS = 60_000;

vi.setConfig({ testTimeout: DRIVE_TIMEOUT_MS });

/** RAM files, from the map at the head of `asm/jetfighter.asm`. */
const FILE_D0 = 0;
const FILE_D1 = 1;
const FILE_D2 = 2;
const FILE_D3 = 3;
const FILE_STATE = 4;
const FILE_MISS = 7;

/** Where the two plane slots live, read from the assembled program's symbols. */
const SQUADRON = squadronMap(assembleGame());

/** `FILE_STATE` nibbles. */
const NIB_RCOL = 7;
const NIB_RLANE = 8;
const NIB_KILLS = 12;

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

/** `OPLA_A_PAIR`: the pair group's base index. Latch set, so plates 6-7 only. */
const OPLA_A_PAIR = 12;

/**
 * `RPL_R11`: the FILE_D3 code naming plate 8, which is the lane-2 missile.
 *
 * The pair group holds two plates, so only lanes 0 and 1 of the player's shot go
 * through the O port; lane 2 is R11 and is named in the R-plate file instead.
 * Any assertion about where the missile is drawn has to read both.
 */
const RPL_R11 = 1;

/**
 * The grid the player's shot in `lane` stands on, and 0 for no shot in that lane.
 *
 * **The only thing in this file that knows where missile state lives.** The
 * column now lives in `FILE_MISS`, one nibble per lane, with the lane implied by
 * which nibble holds it - the shape the owner describes
 * (`docs/evidence/owner-entity-model.md`, "Why the count is the clue"). There is
 * no lane indirection left to do: nibble `lane` is lane `lane`'s column.
 *
 * The ROM still fires one shot at a time, so at most one lane answers non-zero
 * today. That is a property of the firing guard and not of this map, and it is
 * why every assertion below was already written per lane.
 *
 * The nibble numbers are from the RAM map at the head of `asm/jetfighter.asm`.
 */
function missileCol(ram: Uint8Array, lane: number): number {
  const NIB_MC = 0;
  return ram[FILE_MISS * 16 + NIB_MC + lane] as number;
}

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
  /**
   * Per lane, the grids a plane stands on in it, as a bitmap over the columns.
   *
   * A bitmap and not a column, because two positioned planes can be in one row
   * and both of them are drawn. A reader returning one column per row would drop
   * the second, and the second is exactly the one a render fault hides behind.
   */
  readonly jets: readonly number[];
  /** Both plane slots as the RAM holds them, empties included, in slot order. */
  readonly slots: readonly Plane[];
  /** Near nibble of grids 1-5, indexed by grid. */
  readonly near: readonly number[];
  /** Far nibble of grids 1-5, indexed by grid. */
  readonly far: readonly number[];
  readonly rocketCol: number;
  readonly rocketLane: number;
  /** Pair nibble of grids 1-5, indexed by grid: the missile's O-port lanes. */
  readonly pair: readonly number[];
  /** R-plate code of grids 1-5, indexed by grid: lane 2's missile lives here. */
  readonly plate: readonly number[];
  /** Grid the player's shot in each lane stands on, 0 for a lane with no shot. */
  readonly missiles: readonly number[];
  /** Jets shot down in this wave, which `missile_kill` increments. */
  readonly kills: number;
  /** False while a sound holds the sweep and the tube is dark. */
  readonly refreshing: boolean;
}

/**
 * Drive the machine with the lever parked, sampling state and display together.
 *
 * **The fire button is worked, and it has to be.** An earlier form of this drive
 * left it alone, and the missile assertion below was written against it: with no
 * shot ever launched there was no missile to draw, so the assertion held over an
 * empty set and **passed against a `rd_missile` deliberately broken to draw one
 * lane over**. It was caught by the deliberate break and by nothing else.
 *
 * That is the fourth vacuous assertion found on this run and the first that was
 * mine. The lesson is the drive rather than the assertion: a check on how an
 * actor is drawn is worth nothing unless the drive puts that actor on the glass,
 * and "the suite is green" cannot distinguish the two.
 *
 * Tapped rather than held because firing is edge triggered - `tick_fire` reads
 * `NIB_FIREP` first, so a held button launches one shot and no more.
 */
/**
 * A lever that walks the lanes, tapping fire once it has settled in each.
 *
 * **Every other assertion in this file wants a parked lever** - the fault they
 * were written for varied with the lever's lane, so each run holds one detent
 * and the lane is the parameter. Exactly one assertion wants the opposite, and
 * it is the one about shots in more than one lane at once: with the lever
 * parked, the player can only ever put a shot in the lane he is standing in, so
 * `bestFrame` could never exceed one **however the ROM behaved**. That is a
 * property of the drive, not of the machine, and it is why the seam needed its
 * own schedule rather than a longer run of the existing one.
 *
 * The schedule obeys the aiming rule `tms1370-probe.ts` sets out: the lever must
 * settle for at least one sweep before the press, or the shot goes down whichever
 * lane the lever held last. Here it settles for 200 ms - about thirteen sweeps -
 * which is far more than the rule needs and costs nothing.
 *
 * `BLOCK` is 400 ms so a full circuit of the three lanes takes 1.2 s, comfortably
 * inside one shot's 2.5 s flight (five columns at the measured 500 ms each). That
 * is the whole point: the third shot is fired while the first is still crossing,
 * which is the only way a rank of three is observable at all.
 */
const ROVE_BLOCK_SAMPLES = 40;
const ROVE_PRESS_FROM = 20;
const ROVE_PRESS_TO = 25;

const roving = (tap: number): { lane: number; fire: boolean } => {
  const within = tap % ROVE_BLOCK_SAMPLES;
  return {
    lane: Math.floor(tap / ROVE_BLOCK_SAMPLES) % LANE_COUNT,
    fire: within >= ROVE_PRESS_FROM && within < ROVE_PRESS_TO,
  };
};

function sample(lane: number, lever?: (tap: number) => { lane: number; fire: boolean }): readonly Sample[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane, fire: false });
  const samples: Sample[] = [];
  let taps = 0;
  while (machine.cycles < RUN_CYCLES) {
    if (lever === undefined) {
      machine.setContacts({ fire: Math.floor(taps / 10) % 2 === 0 });
    } else {
      machine.setContacts(lever(taps));
    }
    taps += 1;
    machine.step(SAMPLE_CYCLES);
    // Nothing before the first completed sweep is a picture. `reset` clears all
    // eight files and only then falls into `render`, so until a sweep has been
    // drawn the display files hold the clear's zeroes rather than a frame - and
    // zero is a legal *near* value but not a legal pair one, so an assertion
    // about pair indices reads the power-on window as a fault. That the tube
    // stays dark through the clear is asserted in `tms1370-rom.test.ts`, which
    // is where that claim belongs.
    if (machine.sweepCount < 1) {
      continue;
    }
    const ram = machine.ram;
    const nibble = (file: number, index: number): number => ram[file * 16 + index] as number;
    samples.push({
      seconds: machine.cycles / CYCLE_HZ,
      jets: Array.from({ length: LANE_COUNT }, (_unused, l) => rowColumns(planesOf(ram, SQUADRON), l)),
      slots: slotsOf(ram, SQUADRON),
      near: Array.from({ length: GRID_COL_LAST + 1 }, (_unused, g) => nibble(FILE_D0, g)),
      far: Array.from({ length: GRID_COL_LAST + 1 }, (_unused, g) => nibble(FILE_D1, g)),
      rocketCol: nibble(FILE_STATE, NIB_RCOL),
      rocketLane: nibble(FILE_STATE, NIB_RLANE),
      pair: Array.from({ length: GRID_COL_LAST + 1 }, (_unused, g) => nibble(FILE_D2, g)),
      plate: Array.from({ length: GRID_COL_LAST + 1 }, (_unused, g) => nibble(FILE_D3, g)),
      missiles: Array.from({ length: LANE_COUNT }, (_unused, l) => missileCol(ram, l)),
      kills: nibble(FILE_STATE, NIB_KILLS),
      refreshing: machine.isRefreshing(),
    });
  }
  return samples;
}

/** The squadron as `row:column` pairs, for a failure message a reader can use. */
function describePlanes(shot: Sample): string {
  return shot.slots
    .map((plane, slot) => `${slot}=${plane.column === 0 ? 'empty' : `${plane.row}:${plane.column}`}`)
    .join(' ');
}

/** The lane bitmap the squadron justifies for `grid`, from the plane slots alone. */
function jetBitmap(jets: readonly number[], grid: number): number {
  return jets.reduce(
    (bits, grids, lane) => ((grids & (1 << grid)) !== 0 ? bits | (1 << lane) : bits),
    0,
  );
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

/**
 * The lane bitmap the player's shots justify for `grid`.
 *
 * Written against the state rather than against a count of missiles, so it holds
 * whether the ROM flies one shot or one per lane: every lane whose missile stands
 * on this grid is set, and nothing else is.
 *
 * An empty lane reads 0, and every caller asks about a playfield grid - 1 to 5 -
 * so an empty lane never sets its bit. This is `jetBitmap`'s shape for the same
 * reason: both are "which lanes does the state put on this column?".
 */
function missileBitmap(shot: Sample, grid: number): number {
  return shot.missiles.reduce(
    (bits, standsOn, lane) => (standsOn === grid ? bits | (1 << lane) : bits),
    0,
  );
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
                `with planes at [${describePlanes(shot)}]`,
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
      //
      // **The stay is followed per plane slot and not per lane**, which is what
      // the positioned model changes here. A lane no longer names one attacker:
      // two planes can be in one row and a per-lane walk would collapse them into
      // a single stay and pass while one of them was never drawn. A slot does
      // name one attacker for as long as it holds one, so a stay is "this slot
      // held this (row, column)" and it closes when either moves.
      const shots = sample(detent);
      const undrawn: string[] = [];
      const slotCount = shots[0]?.slots.length ?? 0;
      for (let slot = 0; slot < slotCount; slot += 1) {
        let stayRow = -1;
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
              `slot ${slot} stood in row ${stayRow} on grid ${stayGrid} from ` +
                `t=${stayFrom.toFixed(2)}s to t=${at.toFixed(2)}s and was never drawn there`,
            );
          }
        };
        for (const shot of shots) {
          const held = shot.slots[slot] as Plane;
          if (held.column !== stayGrid || held.row !== stayRow) {
            closeStay(shot.seconds);
            stayRow = held.row;
            stayGrid = held.column;
            stayDrawn = false;
            stayFrom = shot.seconds;
            stayDrawable = 0;
          }
          if (!shot.refreshing) {
            continue;
          }
          stayDrawable += 1;
          if (
            stayGrid >= GRID_COL_FIRST &&
            stayGrid <= GRID_COL_LAST &&
            ((shot.near[stayGrid] as number) & (1 << stayRow)) !== 0
          ) {
            stayDrawn = true;
          }
        }
        closeStay(shots[shots.length - 1]?.seconds ?? 0);
      }
      expect(undrawn.slice(0, 5), `${undrawn.length} planes were never drawn where they stood`).toEqual(
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
                `OPLA_A_FAR + ${drawn - OPLA_A_FAR}, planes at [${describePlanes(shot)}]`,
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

describe('the player\'s shot is drawn in the lane it flies down', () => {
  // ## Why this exists before the change it guards
  //
  // `rd_missile` is about to become a three-lane walk, and a three-lane walk in
  // the render step is exactly the shape that produced this file: `rd_jets`
  // doubling a lane bit it had never initialised. The missile walk will use the
  // same `NIB_RBIT`/`NIB_RLNE` scratch, so it can fail the same way, silently,
  // while every coverage-shaped suite goes greener for it.
  //
  // So this assertion is written and proved armed *first*, against the
  // single-missile ROM, by breaking `rd_missile` deliberately and checking that
  // it fails. A falsifier written after the change it is meant to falsify is
  // worth very little; three suites on this run were green on the defect they
  // policed, and all three had been written that way round.
  //
  // ## Reading both halves of the missile
  //
  // The shot is drawn in two different places and an assertion that read one of
  // them would pass for a ROM that lost the other. Lanes 0 and 1 are plates 6
  // and 7, so they go through the O port and land in the pair nibble of the
  // column the shot is on. **Lane 2 is plate 8, which is R11 and outside the PLA
  // entirely**, so it is named in `FILE_D3` as `RPL_R11` instead. Both are read
  // here, and the lane-2 half is the one a walk is most likely to drop, because
  // it is the arm that does not look like the other two.
  for (const detent of DETENTS) {
    it(`lights no missile lane the player has no shot in, lever in lane ${detent}`, () => {
      const shots = sample(detent);
      const wrong: string[] = [];
      shots.forEach((shot, index) => {
        if (!shot.refreshing) {
          return;
        }
        for (let grid = GRID_COL_FIRST; grid <= GRID_COL_LAST; grid += 1) {
          const justified = recentlyJustified(shots, index, grid, missileBitmap);

          // lanes 0 and 1, through the pair group
          const drawn = shot.pair[grid] as number;
          const bitmap = drawn >= OPLA_A_PAIR ? drawn - OPLA_A_PAIR : 0;
          const spurious = bitmap & ~justified;
          if (spurious !== 0) {
            wrong.push(
              `t=${shot.seconds.toFixed(2)}s grid ${grid}: pair nibble ${drawn} lights missile ` +
                `lane(s) ${[0, 1].filter((l) => spurious & (1 << l))} with shots at ` +
                `[${shot.missiles}]`,
            );
          }

          // lane 2, through the R-plate file
          if ((shot.plate[grid] as number) === RPL_R11 && (justified & (1 << 2)) === 0) {
            wrong.push(
              `t=${shot.seconds.toFixed(2)}s grid ${grid}: R-plate names the lane-2 missile ` +
                `with shots at [${shot.missiles}]`,
            );
          }
        }
      });
      expect(wrong.slice(0, 5), `${wrong.length} samples drew a shot the player has not got`).toEqual(
        [],
      );
    });
  }
});

describe('a shot in flight is drawn somewhere', () => {
  // The other direction, and it is not symmetric with the one above. A check
  // that only rejects lanes it should not see passes for a render step that
  // draws *nothing*: deliberately dropping `rd_missile`'s plate-8 arm, which is
  // the shape `rd_burst`'s recorded gap has, left the lane-2 shot undrawn and the
  // assertion above green. Both directions or neither.
  //
  // Asserted over the flight rather than per sample, for the reason the jet
  // walk's completeness check is: the display files lag the state by up to a
  // sweep, and a shot that is spent before the next render was never drawable.
  for (const detent of DETENTS) {
    it(`draws every shot the player fires, lever in lane ${detent}`, () => {
      const shots = sample(detent);
      const undrawn: string[] = [];
      // A flight per lane rather than one flight at a time: while the ROM holds
      // one shot only one of these three ever runs, and a rank of three needs no
      // second form of the check.
      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        let flying = false;
        let flightFrom = 0;
        let drawn = false;
        let drawable = 0;
        const close = (at: number): void => {
          if (flying && drawable >= STALE_SAMPLES && !drawn) {
            undrawn.push(
              `a shot flew in lane ${lane} from t=${flightFrom.toFixed(2)}s to ` +
                `t=${at.toFixed(2)}s and was never drawn`,
            );
          }
        };
        for (const shot of shots) {
          const grid = shot.missiles[lane] as number;
          const inFlight = grid >= GRID_COL_FIRST && grid <= GRID_COL_LAST;
          if (inFlight !== flying) {
            close(shot.seconds);
            flying = inFlight;
            flightFrom = shot.seconds;
            drawn = false;
            drawable = 0;
          }
          if (!inFlight || !shot.refreshing) {
            continue;
          }
          drawable += 1;
          const pairBitmap =
            (shot.pair[grid] as number) >= OPLA_A_PAIR
              ? (shot.pair[grid] as number) - OPLA_A_PAIR
              : 0;
          const litOnPort = (pairBitmap & (1 << lane)) !== 0;
          const litOnPlate = lane === 2 && (shot.plate[grid] as number) === RPL_R11;
          if (litOnPort || litOnPlate) {
            drawn = true;
          }
        }
        close(shots[shots.length - 1]?.seconds ?? 0);
      }
      expect(undrawn.slice(0, 5), `${undrawn.length} shots were never drawn`).toEqual([]);
    });
  }
});

describe('each lane of the rank is drawn under its own plate and no other', () => {
  // The off-by-one check for `rd_missile`'s three-lane render, and the reason it
  // is separate from the two assertions above.
  //
  // Those two are written against the *state*: the drawn lanes must be a subset
  // of the lanes `FILE_MISS` says hold a shot, and every shot must be drawn
  // somewhere. Both are the right shape for a rank of three, and both are also
  // satisfiable by a walk that is wrong in a way the state happens to excuse -
  // most of all while the ROM still fires one shot at a time, when "the lanes
  // that hold a shot" is a one-element set that a stale sample can widen.
  //
  // This one is written against the *drive* instead, which is what makes it a
  // per-lane check rather than a whole-picture one. The lever is parked in one detent for
  // the whole run and `tick_fire` fires down `NIB_LANE`, so **lane `detent` is
  // the only lane a shot can ever be in** - no lag, no torn read and no wave
  // reset changes that. So the picture may name lane `detent` and nothing else,
  // at every instant, on every playfield grid. An arm that adds a neighbouring
  // lane's bit, or tests a neighbouring lane's nibble, draws the shot under the
  // wrong plate and this fails on the first frame that holds a shot.
  //
  // ## Both halves, and the exclusion between them
  //
  // The lane is read from the pair nibble and the R-plate file together, and the
  // two are required to disagree: lanes 0 and 1 are plates 6 and 7 and go through
  // the O port, lane 2 is plate 8 and is named in `FILE_D3` as `RPL_R11`. So a
  // lane-2 shot that also raised a pair bit, or a lane-0 shot that also named the
  // R plate, fails here even though each half on its own looks right - which is
  // the plate-8 arm being reached for the wrong lane, the other way a three-lane
  // render goes wrong.
  //
  // Nothing else writes the nibbles this reads. `FILE_D2` at grids 1-5 is
  // `rd_missile`'s alone - `rd_launcher` writes grid 6 and the boat's burst grid
  // 0 - and the only other R-plate code a playfield grid takes is
  // `RPL_BURST + lane`, which is 2 to 4 and never 1.
  for (const detent of DETENTS) {
    it(`draws a shot fired in lane ${detent} under that lane's plate alone`, () => {
      const shots = sample(detent);
      const wrong: string[] = [];
      let drawnFrames = 0;
      for (const shot of shots) {
        if (!shot.refreshing) {
          continue;
        }
        for (let grid = GRID_COL_FIRST; grid <= GRID_COL_LAST; grid += 1) {
          const nibble = shot.pair[grid] as number;
          const onPort = nibble >= OPLA_A_PAIR ? nibble - OPLA_A_PAIR : 0;
          const onPlate = (shot.plate[grid] as number) === RPL_R11 ? 1 << 2 : 0;
          const drawn = onPort | onPlate;
          if (drawn === 0) {
            continue; // no shot drawn in this column, which is most of them
          }
          drawnFrames += 1;
          if (drawn !== 1 << detent) {
            wrong.push(
              `t=${shot.seconds.toFixed(2)}s grid ${grid}: the render drew lane(s) ` +
                `${[...Array(LANE_COUNT).keys()].filter((l) => drawn & (1 << l))} for a shot ` +
                `that can only be in lane ${detent} - pair nibble ${nibble}, R plate ` +
                `${shot.plate[grid]}, shots at [${shot.missiles}]`,
            );
          }
        }
      }
      // Non-vacuity, and it is load-bearing here rather than a formality: the
      // claim is "only lane `detent` is ever lit", which a ROM that draws no
      // missile at all satisfies perfectly. This file has already shipped one
      // assertion that passed because its drive never fired.
      expect(drawnFrames, `no shot was ever drawn in lane ${detent}`).toBeGreaterThan(0);
      expect(
        wrong.slice(0, 5),
        `${wrong.length} frames drew a lane-${detent} shot somewhere other than lane ${detent}`,
      ).toEqual([]);
    });
  }
});

describe('a pair nibble is a pair index, and never off the end of the group', () => {
  // The pair group is four slots - `OPLA_A_PAIR` plus a two-plate bitmap - so a
  // lane bit of 4 walks off the end of it exactly as a lane bit of 8 walks off
  // the end of the near group. `AMAAC` is four bits wide, so the sum wraps rather
  // than saturating and the index resolves somewhere else in the table or to
  // nothing at all. This is the pair-family sibling of the near-group overflow
  // that started this file, and the missile is about to become a three-lane walk
  // over exactly these plates.
  for (const detent of DETENTS) {
    it(`keeps every playfield pair nibble inside its group, lever in lane ${detent}`, () => {
      const strays: string[] = [];
      for (const shot of sample(detent)) {
        if (!shot.refreshing) {
          continue;
        }
        for (let grid = GRID_COL_FIRST; grid <= GRID_COL_LAST; grid += 1) {
          const drawn = shot.pair[grid] as number;
          if (drawn < OPLA_A_PAIR) {
            strays.push(
              `t=${shot.seconds.toFixed(2)}s grid ${grid}: pair nibble ${drawn} is below ` +
                `OPLA_A_PAIR, so the pair pass would emit a ${drawn < 8 ? 'digit' : 'blank-digit'} slot`,
            );
          }
        }
      }
      expect(strays.slice(0, 5), `${strays.length} samples left the pair group`).toEqual([]);
    });
  }
});

/**
 * Samples before a kill in which the shot that did it has to be found: two, and
 * the second one is a torn read rather than a tolerance.
 *
 * `missile_kill` clears the shot, then clears the jet, then counts the kill, and
 * those are separate writes - a sample can land between the first and the second
 * and see a lane that still holds its jet with the shot already gone. One does,
 * deterministically, at t=27.27 s of the lever-in-lane-0 drive. So the sample
 * immediately before a kill can be empty of the shot that caused it, and the
 * pairing is looked for over the two samples before it instead. This is the same
 * hazard `scoring-ruler.test.ts` names for `add_score`'s two BCD digits.
 */
const ATTRIBUTION_SAMPLES = 2;

describe('a kill is credited to the lane the shot was flying down', () => {
  // The second seam of the multi-missile change, and the one that survives a
  // careful reading. `missile_kill` reads the lane from a stored nibble and
  // clears that lane's jet. Once `missile_step` becomes a walk the lane is the
  // loop index instead, and a `missile_kill` still reading the stored nibble
  // would credit whichever lane happened to be there: the wrong jet dies, the
  // burst prints in the wrong cell, and the score still goes up by one. Every
  // count in the game stays right while the wrong aircraft falls out of the sky.
  //
  // ## What is asserted, and why it is not "the lane the shot was in"
  //
  // The claim below is per lane and not per shot: **every lane that lost a jet
  // must have had a shot of the player's standing in the cell that jet stood
  // in.** That is the same statement for one missile and for three - with one
  // shot up, exactly one lane can answer it - and it does not go vacuous or
  // ambiguous when two jets fall in the same sample, which asking "which lane
  // was *the* shot in?" would.
  //
  // ## The one-column allowance, which is the meeting and not a tolerance
  //
  // The sample the kill lands in is no use for this: `missile_kill` clears the
  // shot and the jet together, so both read zero by then and the state that
  // justified the kill is an earlier sample's. In that sample the two are often
  // one column apart rather than on the same cell, because the sample is 10 ms
  // and the two ways they meet both take one step: `missile_step` tests the cell
  // before the shot leaves it and then advances into the jet's, and a jet
  // marching inward steps into a cell a standing shot already holds. Either way
  // the shot is on the jet's grid or on the next one out - never two cells off,
  // and never in another lane, which is the fault this is here to catch.
  //
  // Read off the state rather than the picture, because the claim is about which
  // jet the ROM removed and not about where it drew the burst.
  for (const detent of DETENTS) {
    it(`removes the jet the shot was aimed at, lever in lane ${detent}`, () => {
      const shots = sample(detent);
      const wrong: string[] = [];
      let checked = 0;
      shots.forEach((shot, index) => {
        const before = shots[index - 1];
        if (before === undefined || shot.kills <= before.kills) {
          return;
        }
        // The lane that lost a plane across this sample is the one to attribute
        // the kill to. `jets` is a bitmap of the grids that lane holds, so
        // "lost one" is a bit that was set and now is not - which stays right
        // when a lane holds two planes and only one of them is shot down.
        const emptied = [0, 1, 2].filter(
          (lane) => ((before.jets[lane] as number) & ~(shot.jets[lane] as number)) !== 0,
        );
        if (emptied.length === 0) {
          return; // the wave reset in the same sample; nothing to attribute
        }
        checked += 1;
        const recent = shots.slice(Math.max(0, index - ATTRIBUTION_SAMPLES), index);
        for (const lane of emptied) {
          // The shot and the jet it hit, in the same lane and within a column of
          // one another, in one of the samples just before the kill.
          const met = recent.some((at) => {
            const shotAt = at.missiles[lane] as number;
            const grids = at.jets[lane] as number;
            if (shotAt === 0) return false;
            // A plane on the shot's own grid, or on the next one in - the same
            // one-column allowance as before, read out of the bitmap.
            return ((grids >> shotAt) & 1) !== 0 || ((grids >> (shotAt - 1)) & 1) !== 0;
          });
          if (!met) {
            wrong.push(
              `t=${shot.seconds.toFixed(2)}s: a kill emptied lane(s) ${emptied}, and lane ` +
                `${lane} lost a plane (grids ${before.jets[lane]} -> ${shot.jets[lane]}) ` +
                `with no shot of the ` +
                `player's standing on it - shots were ` +
                recent.map((at) => `[${at.missiles}]`).join(' then '),
            );
          }
        }
      });
      // Non-vacuity, in the shape `tms1370-rom.test.ts` names: a check over kills
      // that never happened is a check over nothing, and this file has already
      // shipped one assertion that passed because its drive never fired.
      expect(checked, 'no jet was shot down in this run').toBeGreaterThan(0);
      expect(wrong.slice(0, 5), `${wrong.length} kills credited the wrong lane`).toEqual([]);
    });
  }
});

describe('the player can have a shot in more than one lane at once', () => {
  // The third seam. **This was `it.fails()` until the per-lane gate landed**,
  // and the conversion to a plain `it()` here is the obligation that mechanism
  // came with, discharged.
  //
  // ## What it recorded, and why the red was the point
  //
  // `it.fails()` meant "expected to fail *because the seam is unbuilt*", never
  // "known broken". The body was live, executable and un-weakened throughout: it
  // ran every time the suite ran, and Vitest failed the run if it ever *passed*.
  // What it recorded was a fact about the ROM - firing gated on one shot
  // anywhere rather than one per lane - not a fact about the assertion. It was
  // written before the change it guards, because that is the only way to know an
  // assertion is armed for the seam it covers.
  //
  // So the red was success, and it arrived in the pull request that needed it:
  // the moment the gate became per lane this test started passing, `it.fails()`
  // started failing, and the branch that landed multi-missile went red until the
  // `.fails` came off. The failure mode it was guarding against was reading that
  // red as a regression and suppressing it.
  //
  // It must never be weakened, skipped or deleted to green a branch. The seam it
  // covers is invisible to every other assertion in this file, each of which is
  // about a shot that already exists.
  //
  // The gate that used to block this read like an input check rather than like
  // missile state, which is exactly why a multi-missile change could draw three
  // shots correctly, step three shots correctly, and still fire only one: every
  // assertion above would pass, because each is about a shot that exists. The
  // gate now lives in `fire_missile` and tests `FILE_MISS[the lever's lane]`
  // alone, so a shot in another lane is no longer a refusal.
  //
  // The owner's account of the physical unit is the specification here - tap,
  // tap, tap and three shots stand in the three lanes, staggered by column:
  //
  //     >xx
  //     X>X
  //     xx>
  //
  // and the 500 ms measurement corroborates it, because a rank of three is only
  // observable if a shot is still in flight when the next is fired. At 28 ms a
  // column it crossed in 140 ms and no trio could ever have been seen.
  //
  // Read off the drawn picture rather than off state, deliberately: it is the
  // one claim here that is about what the player sees, it is what the owner
  // described, and it does not assume where per-lane state ends up living.
  it('draws shots in two lanes at the same instant', () => {
    const lanesSeen = new Set<number>();
    let bestFrame = 0;
    // One roving run rather than three parked ones - see `roving`. A parked
    // lever cannot put shots in two lanes whatever the ROM does, so looping the
    // detents here would assert nothing about the seam.
    {
      for (const shot of sample(0, roving)) {
        if (!shot.refreshing) {
          continue;
        }
        const lanes = new Set<number>();
        for (let grid = GRID_COL_FIRST; grid <= GRID_COL_LAST; grid += 1) {
          const drawn = shot.pair[grid] as number;
          const bitmap = drawn >= OPLA_A_PAIR ? drawn - OPLA_A_PAIR : 0;
          for (const lane of [0, 1]) {
            if (bitmap & (1 << lane)) lanes.add(lane);
          }
          if ((shot.plate[grid] as number) === RPL_R11) lanes.add(2);
        }
        bestFrame = Math.max(bestFrame, lanes.size);
        for (const lane of lanes) lanesSeen.add(lane);
      }
    }
    // Every lane must be reachable at all, or the check below could pass on a
    // ROM that simply never draws two of them.
    expect([...lanesSeen].sort(), 'the shot never reached some lane').toEqual([0, 1, 2]);
    expect(bestFrame, 'no frame ever held shots in two lanes at once').toBeGreaterThan(1);
  });

  // The other half of the rule, and the half a passing seam test cannot see.
  //
  // The gate is `FILE_MISS[the lever's lane] != 0` **and nothing else**. A build
  // that deleted the gate outright would pass the assertion above with room to
  // spare - three lanes, several shots, every frame it wants - while letting the
  // player stack shots on top of each other in one lane. So the refusal is
  // asserted here directly, because "shots appear in more lanes now" and "the
  // gate still refuses" are independent claims and only the first is popular.
  //
  // Read off the column rather than off a press count: a shot's column walks
  // *outward*, grid 5 down toward the horizon, one step per interval. It is
  // therefore monotonically decreasing for as long as that shot lives, and the
  // only thing that can raise it is `fire_missile` writing GRID_COL_LAST. So a
  // rise while the lane was already occupied is exactly a shot fired into an
  // occupied lane, with no need to model the edge-triggered press at all.
  it('refuses a second shot in a lane that already holds one', () => {
    let occupiedPresses = 0;
    for (const detent of DETENTS) {
      const shots = sample(detent);
      for (let i = 1; i < shots.length; i += 1) {
        const before = (shots[i - 1] as Sample).missiles[detent] as number;
        const after = (shots[i] as Sample).missiles[detent] as number;
        if (before > 0) {
          occupiedPresses += 1;
          expect(
            after,
            `a shot was fired into lane ${detent} while it still held one at grid ${before}`,
          ).toBeLessThanOrEqual(before);
        }
      }
    }
    // Non-vacuity, in the shape `tms1370-rom.test.ts` names: the check above is
    // a check over nothing unless the drive actually spent time with a shot in
    // flight in the lever's own lane while fire was being tapped.
    expect(occupiedPresses, 'no sample ever caught a shot in flight in the lever lane').toBeGreaterThan(
      100,
    );
  });
});
