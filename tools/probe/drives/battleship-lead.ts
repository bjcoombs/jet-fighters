// Can the battleship be hit by leading it? It descends one lane per 1.29 s and a
// shot needs 3.0 s to reach the horizon, so a shot aimed where the boat *is*
// arrives more than two lanes late.
//
// Fires one shot per crossing as the boat enters the top lane, aimed two lanes
// ahead, across nine games. Written against the ROM with the missile at its
// measured 500 ms a column.
//
// It exists because the first measurement of this - aiming at the boat's current
// lane, 18 shots over 11 crossings, no kills - was nearly reported as "the
// battleship cannot be hit". It can: leading by two connects where leading by
// zero or one does not, which is a mechanic rather than a defect.
//
// `battleship-lead.test.ts` holds this drive's non-vacuity floors.

import { Tms1370Machine } from '../tms1370-probe.js';
import { isEntryPoint } from './entry-point.js';
const FILE_STATE = 4, FILE_MISS = 7, CYCLE_HZ = 58333, BS_NONE = 15;
const at = (f: number, n: number, r: Uint8Array) => r[f * 16 + n];
// The shot's column lives in FILE_MISS, one nibble per lane, so "is the barrel
// free" is a question about the whole rank rather than about one nibble.
const shotUp = (r: Uint8Array) => [0, 1, 2].some((l) => at(FILE_MISS, l, r) !== 0);

/** The nine games this drive plays: every skill against every starting lane. */
export const GAMES = 9;

export interface BattleshipLeadResult {
  /** Boat arrivals in the top lane, across all nine games. */
  readonly crossings: number;
  /** Shots taken, one per crossing while the barrel is free. */
  readonly shots: number;
  /** Score changes credited to the boat. */
  readonly kills: number;
}

/** Play the nine games and count what the lead produced. */
export function runBattleshipLead(): BattleshipLeadResult {
  let crossings = 0, shots = 0, kills = 0;
  for (const skill of [1, 2, 3]) for (const seedLane of [0, 1, 2]) {
    const m = new Tms1370Machine();
    m.setContacts({ skill, lane: seedLane, fire: false });
    let prevBs = BS_NONE, prevScore = 0, firedThis = false;
    for (let i = 0; i < 20 * 300; i++) {
      const ram = m.ram;
      const boat = at(FILE_STATE, 9, ram);
      if (boat !== BS_NONE && prevBs === BS_NONE) { crossings++; firedThis = false; }
      if (boat === BS_NONE) firedThis = false;
      prevBs = boat;
      if (!firedThis && boat === 0 && !shotUp(ram)) {
        m.setContacts({ lane: 2, fire: true }); shots++; firedThis = true;
      }
      m.step(CYCLE_HZ / 20);
      m.setContacts({ fire: false });
      const r2 = m.ram;
      const sc = at(5, 12, r2) * 100 + at(5, 11, r2) * 10 + at(5, 10, r2);
      if (sc !== prevScore) { if (at(FILE_STATE, 14, r2) - 1 === 0) kills++; prevScore = sc; }
      if (at(FILE_STATE, 11, r2) !== 0) break;
    }
  }
  return { crossings, shots, kills };
}

/** The one line this drive prints. */
export function formatBattleshipLead(r: BattleshipLeadResult): string {
  return `lead +2, fired as the boat enters: ${r.crossings} crossings, ${r.shots} shots, ${r.kills} boat kills`;
}

if (isEntryPoint(import.meta.url)) console.log(formatBattleshipLead(runBattleshipLead()));
