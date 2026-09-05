// The jets' rocket crosses the field a little faster than the player's missile.
//
// The owner's testimony (2026-09-05): the rocket reaches him at about the speed
// his own shot reaches the jets, and at exactly that speed it felt slightly slow
// against the hardware. The missile's cadence is MEASURED from video (500 ms a
// column, n = 744, `asm/jetfighter.asm` MISSILE_LO); the rocket's was a
// PROVISIONAL 7 sweeps and is now a pair at three quarters of the missile's.
// This holds both off the running machine rather than by reading the constants:
// each shot's column nibble is watched sweep by sweep, every dwell on a column
// must be its own pair's count, and the rocket's must sit between the missile's
// and two thirds of it - faster, but only slightly.
//
// A parked lever, which is what `launcher-lives.test.ts` uses to see rockets
// land; one game per lane, because a parked game is over after a rocket or two,
// at skill 3 where rockets are most frequent and at skill 1 so that neither
// shot's cadence is shown to follow the dial. The missile is timed in a game
// that taps fire whenever the rank is empty.

import { describe, expect, it } from "vitest";

import { CYCLE_HZ } from "../../src/machine/cpu/tms1370/timing.js";
import { Tms1370Machine, assembleGame } from "./tms1370-probe.js";

const symbol = (() => {
  const asm = assembleGame();
  return (name: string): number => {
    const found = asm.symbols.find((definition) => definition.name === name);
    if (found === undefined)
      throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
    return found.value;
  };
})();

/** Where the rocket records the column it is on; zero is none in flight. */
const ROCKET_COLUMN_ADDRESS = symbol("FILE_STATE") * 16 + symbol("NIB_RCOL");
/** Where the lane-0 missile records its column; the nibble index is the lane. */
const MISSILE_COLUMN_ADDRESS = symbol("FILE_MISS") * 16 + 0;
/** `ST_PLAY` is zero; anything else and the game is over, and no shot flies again. */
const STATE_ADDRESS = symbol("FILE_STATE") * 16 + symbol("NIB_STATE");

/** A low/high pair spent low first steps on the sweep after it reaches zero. */
const pairSweeps = (lo: string, hi: string): number =>
  symbol(hi) * 16 + symbol(lo) + 1;
const ROCKET_SWEEPS = pairSweeps("ROCKET_LO", "ROCKET_HI");
const MISSILE_SWEEPS = pairSweeps("MISSILE_LO", "MISSILE_HI");

/** A sweep with a sound in it parks; this is the ceiling one is given to finish. */
const SWEEP_CEILING_CYCLES = Math.round(0.7 * CYCLE_HZ);
/** Emulated seconds to watch a game at most; a game that ends sooner is left at its end. */
const HORIZON_S = 60;
/** Wall-clock allowance for four emulated games, as the other probe suites give theirs. */
const TEST_TIMEOUT_MS = 60_000;
/** Dwells wanted from each shot before the comparison means anything. */
const DWELLS_WANTED = 4;

/**
 * The sweeps a shot spent on each column it moved between, in one game: from the
 * sweep it arrived on a column to the sweep it left it. A launch and a landing
 * are not dwells. With `fire`, the button is tapped whenever the rank is empty -
 * a press on one sweep and the release on the next - so a missile is in flight
 * for most of the game.
 */
function columnDwells(
  address: number,
  lane: number,
  fire: boolean,
  skill: number,
): number[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill, lane });
  const dwells: number[] = [];
  let last = 0;
  let since = 0;
  let firing = false;
  const target = Math.round(HORIZON_S * CYCLE_HZ);
  while (
    machine.cycles < target &&
    (machine.ram[STATE_ADDRESS] as number) === 0
  ) {
    machine.runSweeps(1, SWEEP_CEILING_CYCLES);
    const sweep = machine.sweepCount;
    if (fire) {
      const empty = (machine.ram[MISSILE_COLUMN_ADDRESS] as number) === 0;
      if (!firing && empty) {
        machine.setContacts({ fire: true });
        firing = true;
      } else if (firing) {
        machine.setContacts({ fire: false });
        firing = false;
      }
    }
    const column = machine.ram[address] as number;
    if (column !== last) {
      if (last !== 0 && column !== 0) dwells.push(sweep - since);
      last = column;
      since = sweep;
    }
  }
  return dwells;
}

describe("the rocket and the missile", () => {
  it("are wound so the rocket is faster than the missile, but only slightly", () => {
    expect(ROCKET_SWEEPS).toBeLessThan(MISSILE_SWEEPS);
    expect(ROCKET_SWEEPS).toBeGreaterThanOrEqual((MISSILE_SWEEPS * 2) / 3);
  });

  it(
    "dwell their own pair's sweeps on every column, measured off the running machine",
    () => {
      // A parked game ends after a rocket or two, so the rockets come from one
      // game per lane at each skill; the missiles from one firing game per skill.
      const skills = [1, 3];
      const rocket = skills.flatMap((skill) =>
        [0, 1, 2].flatMap((lane) =>
          columnDwells(ROCKET_COLUMN_ADDRESS, lane, false, skill),
        ),
      );
      const missile = skills.flatMap((skill) =>
        columnDwells(MISSILE_COLUMN_ADDRESS, 0, true, skill),
      );
      expect(
        rocket.length,
        "no rockets flew far enough to be timed",
      ).toBeGreaterThanOrEqual(DWELLS_WANTED);
      expect(
        missile.length,
        "no missiles flew far enough to be timed",
      ).toBeGreaterThanOrEqual(DWELLS_WANTED);
      expect(
        new Set(missile),
        "the missile is the measured cadence and should be steady",
      ).toEqual(new Set([MISSILE_SWEEPS]));
      expect(
        new Set(rocket),
        "the rocket does not hold its own cadence",
      ).toEqual(new Set([ROCKET_SWEEPS]));
    },
    TEST_TIMEOUT_MS,
  );
});
