// The jets' rocket and the player's missile cross the field at one rate.
//
// The owner's testimony (2026-09-05): the rocket reaches him at the speed his
// own shot reaches the jets. The missile's cadence is MEASURED from video (500 ms
// a column, n = 744, `asm/jetfighter.asm` MISSILE_LO); the rocket's was a
// PROVISIONAL 7 sweeps and is now the missile's own pair. This holds the two
// together off the running machine rather than by reading the constants: each
// shot's column nibble is watched sweep by sweep, and every dwell on a column
// must be the same count of sweeps for both.
//
// Skill 3, where rockets are most frequent, and a parked lever, which is what
// `launcher-lives.test.ts` uses to see them land; one game per lane, because a
// parked game is over after a rocket or two. The missile is timed in a game that
// taps fire whenever the rank is empty.

import { describe, expect, it } from 'vitest';

import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine, assembleGame } from './tms1370-probe.js';

const symbol = (() => {
  const asm = assembleGame();
  return (name: string): number => {
    const found = asm.symbols.find((definition) => definition.name === name);
    if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
    return found.value;
  };
})();

/** Where the rocket records the column it is on; zero is none in flight. */
const ROCKET_COLUMN_ADDRESS = symbol('FILE_STATE') * 16 + symbol('NIB_RCOL');
/** Where the lane-0 missile records its column; the nibble index is the lane. */
const MISSILE_COLUMN_ADDRESS = symbol('FILE_MISS') * 16 + 0;

/** A low/high pair spent low first steps on the sweep after it reaches zero. */
const pairSweeps = (lo: string, hi: string): number => symbol(hi) * 16 + symbol(lo) + 1;
const ROCKET_SWEEPS = pairSweeps('ROCKET_LO', 'ROCKET_HI');
const MISSILE_SWEEPS = pairSweeps('MISSILE_LO', 'MISSILE_HI');

/** A sweep with a sound in it parks; this is the ceiling one is given to finish. */
const SWEEP_CEILING_CYCLES = Math.round(0.7 * CYCLE_HZ);
/** Emulated seconds to watch a game: a parked one is over well inside this. */
const HORIZON_S = 60;
/** Dwells wanted from each shot before the comparison means anything. */
const DWELLS_WANTED = 4;

/**
 * The sweeps a shot spent on each column it moved between, in one game: from the
 * sweep it arrived on a column to the sweep it left it. A launch and a landing
 * are not dwells. With `fire`, the button is tapped whenever the rank is empty -
 * a press on one sweep and the release on the next - so a missile is in flight
 * for most of the game.
 */
function columnDwells(address: number, lane: number, fire: boolean): number[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 3, lane });
  const dwells: number[] = [];
  let last = 0;
  let since = 0;
  let firing = false;
  const target = Math.round(HORIZON_S * CYCLE_HZ);
  while (machine.cycles < target) {
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

describe('the rocket and the missile', () => {
  it('are wound to the same pair in the ROM', () => {
    expect(ROCKET_SWEEPS).toBe(MISSILE_SWEEPS);
  });

  it('dwell the same number of sweeps on every column, measured off the running machine', () => {
    // A parked game ends after a rocket or two, so the rockets come from one
    // game per lane; the missiles from one game that fires.
    const rocket = [0, 1, 2].flatMap((lane) => columnDwells(ROCKET_COLUMN_ADDRESS, lane, false));
    const missile = columnDwells(MISSILE_COLUMN_ADDRESS, 0, true);
    expect(rocket.length, 'no rockets flew far enough to be timed').toBeGreaterThanOrEqual(DWELLS_WANTED);
    expect(missile.length, 'no missiles flew far enough to be timed').toBeGreaterThanOrEqual(DWELLS_WANTED);
    expect(new Set(missile), 'the missile is the measured cadence and should be steady').toEqual(new Set([MISSILE_SWEEPS]));
    expect(new Set(rocket), 'the rocket does not hold the missile\'s cadence').toEqual(new Set([ROCKET_SWEEPS]));
  });
});
