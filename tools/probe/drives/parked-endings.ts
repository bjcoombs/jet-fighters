// When does an unplayed game end? Times the last speaker edge, three ways.
//
// This is the re-derivation for every constant in `tools/probe/game-horizons.ts`,
// and it exists because those are the figures in `tools/probe/` that several
// suites depend on and none owns. Two had already drifted: 43.2 s in one file
// against the 36.9 s the file that measured it carried, and one *name* holding
// 24.6 s in two files and 26.2 s in a third. A constant nobody can re-measure in
// one command is how that happens, so this prints each figure beside its
// constant and says whether the constant is still a ceiling.
//
// Three drives, because they are three quantities and today's numbers agreeing
// is not a reason to treat them as one:
//
//   - the lever parked in each lane at skill 1 - PARKED_GAME_END_S
//   - no contact closed at all, not even the dial - UNATTENDED_SILENCE_S
//   - the dial closed at each setting, lever untouched -
//     UNATTENDED_SILENCE_ANY_SKILL_S
//
// Written against the ROM with the entry position drawn from the entropy nibble.
// Nothing is played: no fire, no lever movement. That is the point - the horizon
// has to hold for a machine nobody is attending to, which is the longest a game
// can take.
//
// `parked-endings.test.ts` holds this drive's non-vacuity floors. The failure
// mode here is not a zero opportunity count but a zero *ending*: a drive that
// never heard the speaker, or a game that never ended inside the ceiling, both
// report a number, and neither number measures a horizon.
//
// Paths in this file are relative to the repository root.

import { Tms1370Machine } from '../tms1370-probe.js';
import { CYCLE_HZ } from '../../../src/machine/cpu/tms1370/timing.js';
import {
  PARKED_GAME_END_S,
  UNATTENDED_SILENCE_ANY_SKILL_S,
  UNATTENDED_SILENCE_S,
} from '../game-horizons.js';
import { isEntryPoint } from './entry-point.js';

/** Long enough that a game which had not ended would be obvious. */
export const CEILING_S = 90;
/** Sampling interval. Fine against the 0.67 s loss envelope. */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);

/** Run to the ceiling and hand back the last speaker edge, in seconds. */
function lastEdgeSeconds(contacts: Parameters<Tms1370Machine['setContacts']>[0] | null): number {
  const machine = new Tms1370Machine();
  if (contacts !== null) machine.setContacts(contacts);
  let lastEdge = 0;
  const ceiling = Math.round(CEILING_S * CYCLE_HZ);
  while (machine.cycles < ceiling) {
    machine.step(SAMPLE_CYCLES);
    for (const edge of machine.takeSpeakerEdges()) lastEdge = edge.cycle;
  }
  return lastEdge / CYCLE_HZ;
}

/** Says whether a constant is still the ceiling it claims to be. */
function ceilingReport(name: string, constant: number, measured: number): string {
  return (
    `${name} is ${constant} s - ` +
    (measured <= constant
      ? `a ceiling, clearing the latest ending by ${(constant - measured).toFixed(3)} s`
      : `NO LONGER A CEILING: the latest ending is ${(measured - constant).toFixed(3)} s past it`)
  );
}

export interface ParkedEndingsResult {
  /** Last speaker edge with the lever parked in lane 0, 1 and 2, at skill 1. */
  readonly byLane: readonly number[];
  /** Last speaker edge with no contact closed at all. */
  readonly untouched: number;
  /** Last speaker edge with each skill closed and the lever untouched. */
  readonly bySkill: readonly number[];
}

/** Time the last speaker edge, seven ways. */
export function runParkedEndings(): ParkedEndingsResult {
  return {
    byLane: ([0, 1, 2] as const).map((lane) => lastEdgeSeconds({ skill: 1, lane })),
    untouched: lastEdgeSeconds(null),
    bySkill: [1, 2, 3].map((skill) => lastEdgeSeconds({ skill })),
  };
}

/** The lines this drive prints. */
export function formatParkedEndings(r: ParkedEndingsResult): readonly string[] {
  const latest = Math.max(...r.byLane);
  return [
    ...r.byLane.map(
      (seconds, lane) => `lever parked in lane ${lane}: last speaker edge at ${seconds.toFixed(3)} s`,
    ),
    `latest ending ${latest.toFixed(3)} s`,
    `spread across lanes ${(latest - Math.min(...r.byLane)).toFixed(3)} s`,
    ceilingReport('PARKED_GAME_END_S', PARKED_GAME_END_S, latest),
    // The unattended machine: nothing closed at all, which is a different drive
    // from a parked lever and gets a different constant. Then the same with each
    // skill setting closed, which is a third.
    '',
    `no contact closed at all: last speaker edge at ${r.untouched.toFixed(3)} s`,
    ceilingReport('UNATTENDED_SILENCE_S', UNATTENDED_SILENCE_S, r.untouched),
    ...r.bySkill.map(
      (seconds, index) =>
        `skill ${index + 1}, lever untouched: last speaker edge at ${seconds.toFixed(3)} s`,
    ),
    ceilingReport(
      'UNATTENDED_SILENCE_ANY_SKILL_S',
      UNATTENDED_SILENCE_ANY_SKILL_S,
      Math.max(r.untouched, ...r.bySkill),
    ),
  ];
}

if (isEntryPoint(import.meta.url)) {
  for (const line of formatParkedEndings(runParkedEndings())) console.log(line);
}
