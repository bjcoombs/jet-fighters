// Can a plane enter onto a cell a missile is already standing in, and survive?
//
// `missile-rank.test.ts` counts coincidences between a shot and a jet on the
// same column in the same row, and asserts the shot never walks away from one.
// Once `jet_enter` could place a plane at column 2 as well as column 1 - the
// last two cells a missile passes through on its way to the horizon - that
// assertion started failing - measured here at 6 of 88 coincidences.
//
// This isolates why. For every coincidence it records whether the jet was
// already standing there in the previous frame, **marched onto it**, or
// **appeared on it**, so a pass-through caused by a spawn can be told from a
// pass-through caused by a collision test that missed.
//
// ## The three classes are resolved per slot, not per row
//
// The first version of this drive asked the row a question the row cannot
// answer: "was some plane on this cell a frame ago, or one grid further out?"
// Two planes can share a row, so a *new* plane at column 2 with an *older* plane
// at column 1 reads as the column-1 plane having marched - and the spawn is then
// counted as a march and its pass-through blamed on the collision test.
//
// A slot is the identity that survives a frame. `slotsOf` returns both slots in
// slot order, empties included, the ROM writes an entry into one slot and clears
// only the column when a plane dies, and the sampling interval here is a third
// of a sweep - so following slot `s` from one frame to the next follows one
// plane. The row is used for one thing only: deciding that a shot and a jet are
// on the same cell at all.
//
// `entry-onto-missile.test.ts` holds this drive's non-vacuity floors. A
// classifier is only as good as the coincidences it was shown, so what is
// floored is the coincidence count and the population of both fresh classes -
// zero of either means the classification below was never exercised.
//
// Paths in this file are relative to the repository root.

import {
  Tms1370Machine,
  assembleGame,
  slotsOf,
  squadronMap,
  type Plane,
} from '../tms1370-probe.js';
import { CYCLE_HZ } from '../../../src/machine/cpu/tms1370/timing.js';
import { isEntryPoint } from './entry-point.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const SQUADRON = squadronMap(ASM);
const FILE_MISS = symbol('FILE_MISS');
const NIB_MC = symbol('NIB_MC');
const STATE = symbol('FILE_STATE') * 16 + symbol('NIB_STATE');
const KILLS = symbol('FILE_STATE') * 16 + symbol('NIB_KILLS');

const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);
const DRIVE_SECONDS = 90;
const BLOCKS = [50, 60, 70] as const;

interface Frame {
  readonly shots: readonly number[];
  readonly planes: readonly Plane[];
  readonly kills: number;
}

export interface EntryOntoMissileResult {
  /** Shot and jet on the same cell in the same frame - the opportunity count. */
  readonly coincidences: number;
  /** Shots that walked away from a jet that was already standing there. */
  readonly passedWithSettledJet: number;
  /** Shots that walked away from a jet that marched onto the cell that frame. */
  readonly passedAfterMarch: number;
  /** Shots that walked away from a jet that spawned onto the cell that frame. */
  readonly passedAfterSpawn: number;
  /** Coincidences whose jet arrived by marching. */
  readonly freshByMarch: number;
  /** Coincidences whose jet arrived by spawning. */
  readonly freshBySpawn: number;
}

/** Pool the three firing cadences and classify every coincidence they produced. */
export function runEntryOntoMissile(): EntryOntoMissileResult {
  let coincidences = 0;
  let passedAfterSpawn = 0;
  let passedAfterMarch = 0;
  let passedWithSettledJet = 0;
  let freshByMarch = 0;
  let freshBySpawn = 0;

  for (const block of BLOCKS) {
    const machine = new Tms1370Machine();
    machine.setContacts({ skill: 1, lane: 0, fire: false });
    const frames: Frame[] = [];
    const until = DRIVE_SECONDS * CYCLE_HZ;
    for (let tick = 0; machine.cycles < until; tick += 1) {
      const within = tick % block;
      machine.setContacts({
        lane: (Math.floor(tick / block) % 3) as 0 | 1 | 2,
        fire: within >= block / 2 && within < block / 2 + 5,
      });
      machine.step(SAMPLE_CYCLES);
      const ram = machine.ram;
      if ((ram[STATE] as number) !== 0) break;
      frames.push({
        shots: [0, 1, 2].map((lane) => ram[FILE_MISS * 16 + NIB_MC + lane] as number),
        // Slot-indexed, deliberately NOT filtered: index IS the slot, and losing
        // that is what made the classifier below wrong. See the note there.
        planes: slotsOf(ram, SQUADRON),
        kills: ram[KILLS] as number,
      });
    }

    // A coincidence: a shot and a jet on the same row and column. Resolve it when
    // the shot's column next changes.
    const open: ({ column: number; arrival: 'settled' | 'march' | 'spawn' } | undefined)[] = [
      undefined,
      undefined,
      undefined,
    ];
    for (let i = 1; i < frames.length; i += 1) {
      const previous = frames[i - 1] as Frame;
      const current = frames[i] as Frame;
      for (let lane = 0; lane < 3; lane += 1) {
        const shot = current.shots[lane] as number;
        const pending = open[lane];
        if (pending !== undefined && shot !== pending.column) {
          const killed = shot === 0 && current.kills !== previous.kills;
          if (!killed && shot !== 0 && shot < pending.column) {
            // Split by HOW the jet got there. The first draft lumped march
            // arrivals and spawn arrivals together as "fresh", so a marching jet
            // that a shot walked away from would have been reported as a spawn
            // escape - which is the difference between a spawn gap and a
            // collision-test defect.
            if (pending.arrival === 'spawn') passedAfterSpawn += 1;
            else if (pending.arrival === 'march') passedAfterMarch += 1;
            else passedWithSettledJet += 1;
          }
          open[lane] = undefined;
        }
        if (shot === 0 || open[lane] !== undefined) continue;
        // **Resolved by SLOT, and the first draft of this was wrong for want of
        // that.** It asked whether *any* plane had been one grid further out in
        // this row, which a second plane satisfies: a plane settled at column 1
        // and a new plane spawning at column 2 in the same row read as the first
        // one having marched, so the spawn was booked as `freshByMarch` and never
        // reached `freshBySpawn`. The `planes` array is slot-indexed above and is
        // no longer filtered, so the same slot can be followed across frames.
        //
        // Both slots are considered, and the strongest class wins: a settled jet
        // and a spawn can stand on one cell together, and that coincidence is a
        // question about the settled jet - the collision test had a target there
        // before the spawn arrived. Taking the first matching slot would exclude
        // it as a spawn and lose the evidence.
        const arrivals = current.planes
          .map((plane, slot) => ({ plane, was: previous.planes[slot] as Plane }))
          .filter((pair) => pair.plane.column === shot && pair.plane.row === lane)
          .map(({ was }) =>
            was.row === lane && was.column === shot
              ? 'settled'
              : was.row === lane && was.column === shot - 1
                ? 'march'
                : 'spawn',
          );
        if (arrivals.length === 0) continue;
        const settled = arrivals.includes('settled');
        const marched = !settled && arrivals.includes('march');
        if (!settled) {
          // This slot arrived on the cell this frame. A march moves the same slot
          // one grid inward in the same row; a spawn fills a slot that was empty.
          if (marched) freshByMarch += 1;
          else freshBySpawn += 1;
        }
        coincidences += 1;
        open[lane] = {
          column: shot,
          arrival: settled ? 'settled' : marched ? 'march' : 'spawn',
        };
      }
    }
  }

  return {
    coincidences,
    passedWithSettledJet,
    passedAfterMarch,
    passedAfterSpawn,
    freshByMarch,
    freshBySpawn,
  };
}

/** The lines this drive prints. */
export function formatEntryOntoMissile(r: EntryOntoMissileResult): readonly string[] {
  return [
    `coincidences: ${r.coincidences}`,
    `shots that walked away, jet already settled on the cell: ${r.passedWithSettledJet}`,
    `shots that walked away, jet MARCHED onto the cell that frame: ${r.passedAfterMarch}`,
    `shots that walked away, jet SPAWNED onto the cell that frame: ${r.passedAfterSpawn}`,
    `fresh coincidences by march: ${r.freshByMarch}, by spawn: ${r.freshBySpawn}`,
  ];
}

if (isEntryPoint(import.meta.url)) {
  for (const line of formatEntryOntoMissile(runEntryOntoMissile())) console.log(line);
}
