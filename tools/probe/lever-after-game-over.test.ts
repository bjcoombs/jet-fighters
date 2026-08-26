// Paths in this file are relative to the repository root.
//
// Regression test for a defect the owner reported after playing the deployed
// build against his own physical unit: "I'm still able to move my rocket
// launcher" once a game has ended, when every other control had already
// stopped responding.
//
// `is_lever` (P_INPUT, asm/jetfighter.asm) wrote NIB_LANE straight off the K
// matrix every sweep with no check on NIB_STATE, so the launcher kept
// tracking the lever after ST_OVER/ST_WIN even though `tick` (P_TICK) had
// already stopped running the jets, the missile and the fire gate. The fix
// does not touch is_lever - see the note on `tk_ended` for why gating there
// would have cost words on every sweep of every game, which this codebase's
// cadence figures are measured against. Instead `game_lost`/`game_win` pin
// NIB_LANE into NIB_LAUNCH_FROZEN the instant the game ends, and `tk_ended`
// restores it every sweep from there on, undoing whatever is_lever wrote
// earlier that same sweep.

import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine, assembleGame } from './tms1370-probe.js';
import { PARKED_HORIZON_S } from './game-horizons.js';

function symbolValue(name: string): number {
  const asm = assembleGame();
  const found = asm.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
}

const STATE_ADDRESS = symbolValue('FILE_STATE') * 16 + symbolValue('NIB_STATE');
const LANE_ADDRESS = symbolValue('FILE_STATE') * 16 + symbolValue('NIB_LANE');
const ST_PLAY = symbolValue('ST_PLAY');
const GRID_PLAYER = symbolValue('GRID_PLAYER');

/**
 * Latest a parked-lever game ends, widened - the "still coming" ceiling, not an
 * estimate of when the game ends.
 *
 * **This was `43.2 * 1.4`**, and the 43.2 was a copy of a figure
 * `launcher-lives.test.ts` had already re-measured to 36.9 s. Neither file owned
 * it, so it moved in one and not the other and nothing went red - the horizon
 * was simply longer than it needed to be, which is the failure mode that hides.
 * It is imported now, and `tools/probe/drives/parked-endings.ts` re-derives it.
 */
const HORIZON_S = PARKED_HORIZON_S;

/** `runSweeps`' ceiling while waiting for one sweep - a sound parks it. */
const SWEEP_CEILING_CYCLES = Math.round(0.7 * CYCLE_HZ);

describe('the lever stops moving the launcher once the game has ended', () => {
  it(
    'freezes NIB_LANE, and what the tube draws at GRID_PLAYER, at the lane the game ended in',
    () => {
      const machine = new Tms1370Machine();
      machine.setContacts({ skill: 1, lane: 0 });

      const target = Math.round(HORIZON_S * CYCLE_HZ);
      while (machine.cycles < target && machine.ram[STATE_ADDRESS] === ST_PLAY) {
        machine.runSweeps(1, SWEEP_CEILING_CYCLES);
      }
      expect(
        machine.ram[STATE_ADDRESS],
        'the drive must reach an ending, or nothing below tests anything',
      ).not.toBe(ST_PLAY);

      // Let the capture burst that ended the game finish (NIB_CAPTURE, a few
      // dozen sweeps) before taking either snapshot below, so what changes at
      // GRID_PLAYER between them can only be the lever - not the burst still
      // fading from the ending itself.
      for (let sweep = 0; sweep < 40; sweep += 1) {
        machine.runSweeps(1, SWEEP_CEILING_CYCLES);
      }

      const laneAtEnding = machine.ram[LANE_ADDRESS];
      const launcherPlatesAtEnding = machine
        .getFrame()
        .segments.filter((segment) => segment.grid === GRID_PLAYER)
        .map((segment) => segment.plate)
        .sort();

      // Move the lever through both lanes it did not end in, holding each for
      // several sweeps - exactly the input a still-working control would see.
      for (const lane of [1, 2].map((offset) => (laneAtEnding + offset) % 3)) {
        machine.setContacts({ lane });
        for (let sweep = 0; sweep < 5; sweep += 1) {
          machine.runSweeps(1, SWEEP_CEILING_CYCLES);
        }
      }

      expect(machine.ram[LANE_ADDRESS]).toBe(laneAtEnding);
      const launcherPlatesAfter = machine
        .getFrame()
        .segments.filter((segment) => segment.grid === GRID_PLAYER)
        .map((segment) => segment.plate)
        .sort();
      expect(launcherPlatesAfter).toEqual(launcherPlatesAtEnding);
    },
    60_000,
  );
});
