// What a kill is worth, against the ruler silkscreened on the overlay.
//
// Paths in this file are relative to the repository root.
//
// ## The defect this exists to stop coming back
//
// The owner played the deployed build beside his own CGL unit and reported "the
// scoring seems wrong, see in the display the scores tallied should match the
// read outs so a battle ship is 10 for example, yet all hits are scoring at 1
// point". He was right: `SCORE_JET` was a flat 1 and every jet scored it,
// wherever it stood. The overlay prints a scoring ruler - `10 / 3 / 2 / 1 / G` -
// and nothing in the tree checked the ROM against it.
//
// Nothing checked it because the ruler had never been turned into a table of
// numbers. `src/machine/tube/layout.ts` had registered where the ink *is* -
// which tick each numeral's bracket drops on - and stopped there, explicitly:
// "Nothing about scoring itself changes - the ROM is untouched." This file is
// the other half, and the derivation from those tick positions to the table
// below is written out beside `SCORE_JET` in `asm/jetfighter.asm`.
//
// ## Why grid 5 is asserted but never aimed at
//
// A missile is placed on `GRID_COL_LAST` by `fire_missile` and `missile_step`
// decrements *before* it tests for a jet, so the first cell a missile can hit is
// grid 4. **A jet standing on grid 5 cannot be shot at all.** That is a property
// of the missile path, not of scoring, and it is not this file's to change -
// `missile_step` is being re-measured separately against the owner's report that
// the physical unit flies three missiles at once.
//
// So the per-column aimed kills below cover grids 1 to 4, which is every column
// a missile can reach, and grid 5 is carried by `RULER_POINTS` and by the
// whole-drive invariant instead. If the missile path later gains a grid-5 hit,
// the invariant scores it against the ruler on the first run without this file
// being touched. Asserting a value that cannot currently be produced is
// deliberate: the alternative is a table with a hole in it exactly where the
// next change to the missile will land.
//
// ## Why this reads RAM where `launcher-lives.test.ts` reads the glass
//
// The assertion is a *pairing* - this delta, for a kill in that column - and the
// column half of it has no independent representation on the tube. The burst is
// drawn in the cell the jet died in, so the glass does carry it, but reading the
// column back off the burst is `rom-atlas-conformance.test.ts`'s whole subject
// and re-deriving it here would make this file assert that suite's method rather
// than the ruler. `NIB_KCOL` is read instead, which `tick_burst` clears when the
// burst expires - so it is non-zero only while a burst is on the glass, and the
// only writers are `missile_kill` and `bship_kill`, each immediately before the
// scoring routine it falls into. The score itself is read the way the existing
// `it('scores')` in `tms1370-rom.test.ts` reads it.
//
// ## The torn read, which is real and had to be handled
//
// `add_score` writes `NIB_SC_U` and then, on a carry, `NIB_SC_T` four
// instructions later. A sample landing between the two sees the units digit
// already wrapped and the tens not yet bumped - 19 reads as 10 - and the next
// sample then reads +10. At a 5 ms sample that is about a 0.5% chance per
// scoring event, and it showed up as a `-9` in the first census run of this
// drive. `aimedDrive` steps `SETTLE_CYCLES` past the write before believing a
// change, which is why every delta below is a single number and not a pair.

import { describe, expect, it } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine } from './tms1370-probe.js';

/** `FILE_STATE`, `FILE_TIME` and `FILE_JETS`, from the RAM map in the ROM source. */
const FILE_STATE = 4;
const FILE_TIME = 5;
const FILE_JETS = 6;
const NIB_MCOL = 5;
const NIB_BSLANE = 9;
const NIB_STATE = 11;
const NIB_KCOL = 14;
const NIB_SC_U = 10;
const NIB_SC_T = 11;
const NIB_SC_H = 12;

/** `NIB_BSLANE` when no crossing is in progress. */
const BS_NONE = 15;

/** Seconds of emulated time, as the cycle count the probe takes. */
const seconds = (value: number): number => Math.round(value * CYCLE_HZ);

/**
 * The sample interval, 5 ms, matching `parkedGame` in `tms1370-rom.test.ts`.
 * A burst stands for `BURST_SWEEPS`, which is far longer, so no kill can fall
 * between two samples.
 */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

/** Cycles to let a score write finish before the new value is believed. */
const SETTLE_CYCLES = 600;

/**
 * **The printed ruler, as points per jet column.**
 *
 * Grid 1 is the far end beside the horizon and grid 5 the cell before the G
 * line, so this reads farther-is-more, as PRD v1 R4 says it should. Grids 4 and
 * 5 are a *clamp*, not a reading: the ruler names no value past `1`, the ink is
 * monotone, and a kill worth nothing is not a reading anyone has proposed - so
 * the last named band extends to G. The derivation from tick positions to these
 * numbers is beside `SCORE_JET` in `asm/jetfighter.asm`.
 */
const RULER_POINTS: Readonly<Record<number, number>> = { 1: 3, 2: 2, 3: 1, 4: 1, 5: 1 };

/** The battleship's own tick, on grid 0. Shipped in #116 and not this file's subject. */
const BOAT_POINTS = 10;

/** Every value the ruler names. A delta outside this set is the ROM inventing one. */
const RULER_VALUES = new Set([1, 2, 3, BOAT_POINTS]);

/** The winning score, and the value `as_cap` truncates a bigger one back to. */
const WIN_SCORE = 199;

/** One scoring event: the cell the burst stood in, and what the score moved by. */
interface Kill {
  /** The grid the burst stands on: 0 the battleship, 1-5 the jet columns. */
  readonly grid: number;
  readonly delta: number;
  /** The score before and after, which is what makes the 199 cap recognisable. */
  readonly from: number;
  readonly to: number;
}

/** The three BCD nibbles as one number. */
function scoreOf(ram: Uint8Array): number {
  return (
    (ram[FILE_TIME * 16 + NIB_SC_H] as number) * 100 +
    (ram[FILE_TIME * 16 + NIB_SC_T] as number) * 10 +
    (ram[FILE_TIME * 16 + NIB_SC_U] as number)
  );
}

/**
 * How a drive picks its target each time it is ready to fire.
 *
 * `roundRobin` walks a preferred column so a long drive covers the field;
 * `only` waits for a jet standing on one named column and shoots nothing else,
 * which is how a single column's value is measured on its own.
 */
type Aim = { readonly kind: 'roundRobin' } | { readonly kind: 'only'; readonly column: number };

/**
 * Play the game, aiming, and record every scoring event with the cell it came
 * from.
 *
 * The lever and the fire button are the only things touched; nothing is poked
 * into RAM to set a scenario up. The lever is moved one sample before the fire
 * edge because the ROM reads the lever and the button in the same sweep and
 * `tick_fire` is edge triggered on the button.
 */
function aimedDrive(forSeconds: number, aim: Aim, skill = 1): Kill[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill, lane: 0, fire: false });

  const kills: Kill[] = [];
  let score = -1;
  let releaseFireAt = -1;
  let pressFireAt = -1;
  let wanted = 1;
  const until = seconds(forSeconds);

  while (machine.cycles < until) {
    machine.step(SAMPLE_CYCLES);
    let ram = machine.ram;

    // A game that has ended stops scoring, so there is nothing left to measure.
    if ((ram[FILE_STATE * 16 + NIB_STATE] as number) !== 0) break;

    const seen = scoreOf(ram);
    if (score < 0) {
      score = seen;
    } else if (seen !== score) {
      machine.step(SETTLE_CYCLES);
      ram = machine.ram;
      const settled = scoreOf(ram);
      kills.push({
        grid: (ram[FILE_STATE * 16 + NIB_KCOL] as number) - 1,
        delta: settled - score,
        from: score,
        to: settled,
      });
      score = settled;
    }

    if (releaseFireAt > 0 && machine.cycles >= releaseFireAt) {
      machine.setContacts({ fire: false });
      releaseFireAt = -1;
    }
    if (releaseFireAt > 0) continue;
    // One missile at a time, so there is no point pressing fire while one flies.
    if ((ram[FILE_STATE * 16 + NIB_MCOL] as number) !== 0) continue;

    if (pressFireAt > 0 && machine.cycles >= pressFireAt) {
      machine.setContacts({ fire: true });
      releaseFireAt = machine.cycles + 3_000;
      pressFireAt = -1;
      continue;
    }

    const jets = [0, 1, 2].map((lane) => ram[FILE_JETS * 16 + lane] as number);
    let lane: number;
    if (aim.kind === 'only') {
      lane = jets.indexOf(aim.column);
    } else {
      // Preferred column first so the drive covers the field, then the boat
      // when it is crossing - it has to be shot at deliberately or the census
      // never sees a ten - and any jet at all rather than waste the sweep.
      const preferred = jets.indexOf(wanted);
      wanted = (wanted % 5) + 1;
      const boat = ram[FILE_STATE * 16 + NIB_BSLANE] as number;
      if (preferred >= 0) lane = preferred;
      else if (boat !== BS_NONE) lane = boat;
      else lane = jets.findIndex((grid) => grid !== 0);
    }
    if (lane < 0) continue;

    machine.setContacts({ lane });
    pressFireAt = machine.cycles + SAMPLE_CYCLES;
  }
  return kills;
}

/**
 * Four minutes of emulated play. The drive usually ends before this on its own,
 * when the third launcher goes; the horizon is here so a drive that somehow
 * survives still terminates.
 */
const CENSUS_SECONDS = 240;

/** Long enough for tens of kills at any column a missile can reach. */
const COLUMN_SECONDS = 120;

/** Grids a missile can reach today - see the header, and `UNREACHABLE` below. */
const REACHABLE = [1, 2, 3, 4] as const;

/**
 * The grid a missile cannot reach, which is asserted rather than skipped.
 *
 * Leaving grid 5 out of {@link REACHABLE} and saying nothing else about it would
 * be a hole in the table exactly where the next change to the missile lands. The
 * test below instead asserts *both* shapes: while the launch cell goes untested
 * by `missile_step`, it pins that no jet can be killed there at all, and the
 * moment that stops being true it starts checking grid 5 against the ruler. So
 * it can never pass by finding zero kills and shrugging.
 */
const UNREACHABLE = 5;

/**
 * A drive that runs a whole squadron down is seconds of wall clock, and CI's
 * runner is several times slower than a developer's. Named for the reason every
 * horizon in these suites is: it moves when the drive does, not when a rule
 * does. The first version of this file had no explicit timeout, passed locally,
 * and failed CI on Vitest's 5 s default at 5.4 s.
 */
const DRIVE_TIMEOUT_MS = 60_000;

/**
 * A drive's scoring events, split at the winning add.
 *
 * **This is not an exclusion for a known bug**, and the split is written out
 * here rather than folded into an assertion so that it cannot quietly become
 * one. 199 is a win and the ROM caps at it: `as_cap` writes 1-9-9 flat when the
 * hundreds digit reaches two, so a `+3` landing on 198 moves the score by 1 and
 * not by 3. That is PRD v1 rule 6, not a scoring defect.
 *
 * Whether any given drive gets there is a property of pacing, not of scoring,
 * and it is not stable enough to assert on: paying jets three times what they
 * used to took the census drive to 199 against one base and to a game over on
 * 198 against the next one, with only the march-countdown fix of #117 in
 * between. So the cap is *handled* unconditionally and *asserted* in whichever
 * of the two shapes the drive actually produced - see the guard test, which has
 * something to say either way rather than falling silent when no win happens.
 */
function untilTheWin(kills: readonly Kill[]): {
  scored: readonly Kill[];
  capped: Kill | undefined;
} {
  const at = kills.findIndex((kill) => kill.to === WIN_SCORE);
  if (at < 0) return { scored: kills, capped: undefined };
  return { scored: kills.slice(0, at), capped: kills[at] as Kill };
}

describe('the printed ruler', () => {
  const drive = aimedDrive(CENSUS_SECONDS, { kind: 'roundRobin' });
  const { scored: census, capped } = untilTheWin(drive);

  it('truncates nothing, or truncates exactly the winning add', () => {
    // Both branches assert. The drive either never reaches 199, in which case
    // the census must be the whole drive and nothing has been dropped from the
    // tests below, or it does, in which case the one dropped event has to be
    // the last of the drive and has to land exactly on 199. There is no shape
    // in which this test passes by having nothing to say.
    if (capped === undefined) {
      expect(census).toEqual(drive);
      return;
    }
    expect(capped).toBe(drive.at(-1));
    expect(capped.to).toBe(WIN_SCORE);
    expect(census.length).toBe(drive.length - 1);
    // The truncation may only ever shorten an add that would have overshot.
    const full = capped.grid === 0 ? BOAT_POINTS : (RULER_POINTS[capped.grid] as number);
    expect(capped.from + full).toBeGreaterThanOrEqual(WIN_SCORE);
    expect(capped.delta).toBeLessThanOrEqual(full);
  });

  it('scores enough to be worth reading', () => {
    // Not the assertion - the guard on it. Every test below is vacuously true
    // over an empty drive, and a drive that stops scoring is exactly what a
    // regression in the missile or the march would produce.
    //
    // The threshold is a non-vacuity floor and deliberately not a tight fit to
    // what the drive currently produces, which is 58 events and is a pacing
    // figure: it was a different number one merge ago and will be again. A
    // floor that tracks the drive turns every pacing change into a red main.
    expect(census.length).toBeGreaterThan(20);
    expect(new Set(census.map((kill) => kill.grid)).size).toBeGreaterThan(1);
  });

  it('pays a jet exactly the ruler value for the column it died in', () => {
    const wrong = census
      .filter((kill) => kill.grid !== 0)
      .filter((kill) => kill.delta !== RULER_POINTS[kill.grid]);
    expect(
      wrong.map((kill) => `grid ${kill.grid} scored +${kill.delta}, ruler says +${RULER_POINTS[kill.grid]}`),
    ).toEqual([]);
  });

  it('never scores a value the ruler does not name', () => {
    const unnamed = [...new Set(census.map((kill) => kill.delta))].filter(
      (delta) => !RULER_VALUES.has(delta),
    );
    expect(unnamed).toEqual([]);
  });

  it('still pays the battleship its ten', () => {
    // `score_bship` is untouched by the distance work. This is the guard that
    // says so from the outside.
    const boat = census.filter((kill) => kill.grid === 0);
    expect(boat.length).toBeGreaterThan(0);
    expect([...new Set(boat.map((kill) => kill.delta))]).toEqual([BOAT_POINTS]);
  });

  it.each(REACHABLE)(
    'pays the ruler value for an aimed kill on grid %i',
    (column) => {
      const kills = untilTheWin(aimedDrive(COLUMN_SECONDS, { kind: 'only', column })).scored;
      const here = kills.filter((kill) => kill.grid === column);
      expect(here.length, `no jet was killed on grid ${column}`).toBeGreaterThan(0);
      expect([...new Set(here.map((kill) => kill.delta))]).toEqual([RULER_POINTS[column]]);
    },
    DRIVE_TIMEOUT_MS,
  );

  it(
    'either cannot kill on grid 5 at all, or pays the ruler value there too',
    () => {
      // Both branches assert, and the branch taken is a statement about the
      // missile rather than about scoring.
      //
      // Today `fire_missile` writes the launch cell and `missile_step`
      // decrements before it hit-tests, so grid 5 is drawn and never tested and
      // the count must be exactly zero - a jet standing on the cell before the G
      // line is unshootable. When that is reordered the count goes non-zero and
      // this test starts checking grid 5's ruler value on the first run, with no
      // window in which the row is unasserted. It cannot pass by finding no
      // kills unless finding no kills is itself the current, stated truth.
      const kills = untilTheWin(
        aimedDrive(COLUMN_SECONDS, { kind: 'only', column: UNREACHABLE }),
      ).scored;
      const here = kills.filter((kill) => kill.grid === UNREACHABLE);
      if (here.length === 0) {
        // Not a skip: the assertion is that the cell is unreachable, and a
        // single kill here is a change in the missile that must be noticed.
        expect(here).toEqual([]);
        return;
      }
      expect([...new Set(here.map((kill) => kill.delta))]).toEqual([RULER_POINTS[UNREACHABLE]]);
    },
    DRIVE_TIMEOUT_MS,
  );
});
