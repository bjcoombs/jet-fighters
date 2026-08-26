// When does an unplayed game end? Parks the lever in each lane and times the
// last speaker edge.
//
// This is the re-derivation for `PARKED_GAME_END_S` in
// `tools/probe/game-horizons.ts`, and it exists because that constant is the one
// figure in `tools/probe/` that two suites both depend on and neither owns. It
// had already drifted - 43.2 s in one file against 36.9 s in the file that
// measured it - and a constant nobody can re-measure in one command is how that
// happens.
//
// Written against the ROM with the entry position drawn from the entropy nibble.
// Nothing is played: no fire, no lever movement, one skill setting. That is the
// point - the horizon has to hold for a machine nobody is attending to, which is
// the longest a game can take.
//
// Paths in this file are relative to the repository root.

import { Tms1370Machine } from '../tms1370-probe.js';
import { CYCLE_HZ } from '../../../src/machine/cpu/tms1370/timing.js';
import { PARKED_GAME_END_S } from '../game-horizons.js';

/** Long enough that a game which had not ended would be obvious. */
const CEILING_S = 90;
/** Sampling interval. Fine against the 0.67 s loss envelope. */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

const endings: number[] = [];
for (const lane of [0, 1, 2] as const) {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane });
  let lastEdge = 0;
  const ceiling = Math.round(CEILING_S * CYCLE_HZ);
  while (machine.cycles < ceiling) {
    machine.step(SAMPLE_CYCLES);
    for (const edge of machine.takeSpeakerEdges()) lastEdge = edge.cycle;
  }
  const seconds = lastEdge / CYCLE_HZ;
  endings.push(seconds);
  console.log(`lever parked in lane ${lane}: last speaker edge at ${seconds.toFixed(3)} s`);
}

const latest = Math.max(...endings);
console.log(`latest ending ${latest.toFixed(3)} s`);
console.log(`spread across lanes ${(latest - Math.min(...endings)).toFixed(3)} s`);
console.log(
  `PARKED_GAME_END_S is ${PARKED_GAME_END_S} s - ` +
    (latest <= PARKED_GAME_END_S
      ? `a ceiling, clearing the latest ending by ${(PARKED_GAME_END_S - latest).toFixed(3)} s`
      : `NO LONGER A CEILING: the latest ending is ${(latest - PARKED_GAME_END_S).toFixed(3)} s past it`),
);
