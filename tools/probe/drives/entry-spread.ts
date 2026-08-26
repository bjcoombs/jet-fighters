// Where do planes enter, and how far apart do the two of them stand?
//
// Two numbers come out of this. The first is the histogram of entry positions -
// which (row, column) each plane arrives at. The second is the histogram of the
// **column gap** between the two planes while both are airborne, which is the
// figure that says whether the squadron is marching in lockstep or staggered.
//
// Task 12 measured the second against the ROM as it stood when `jet_enter`
// wrote `GRID_COL_FIRST` for every entry: the gap was zero 66% of the time and
// never exceeded 1. Both planes entered at the far column and the entry
// countdown is short against the march step, so they filled both slots between
// two march steps and then advanced together for the rest of their lives. The
// consequence is that `assets/reference/device-front-gameplay.jpg` - two jets
// airborne at different distances - is not a picture that ROM produced.
//
// Run it before and after any change to the spawn path.
//
// `entry-spread.test.ts` holds this drive's non-vacuity floors: a spawn path
// that stopped producing entries would print an empty histogram, and an empty
// histogram is not a measurement of anything.
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
import { SWEEP_INSTRUCTIONS } from '../../../src/machine/board/tms1370-cadence.js';
import { isEntryPoint } from './entry-point.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const SQUADRON = squadronMap(ASM);
const STATE = symbol('FILE_STATE') * 16 + symbol('NIB_STATE');

/** Sampling interval. A march step is 32 sweeps at its fastest, far coarser. */
const SAMPLE_CYCLES = Math.round(CYCLE_HZ / 200);
/** Emulated seconds one drive plays. */
const DRIVE_SECONDS = 90;
/** Firing cadences to pool over: one phase decides one answer. */
const BLOCKS = [50, 60, 70, 45, 85] as const;

const bump = <K>(map: Map<K, number>, key: K): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

export interface EntrySpreadResult {
  /** Entry cells as `r<row>c<column>`, ascending by key. */
  readonly entries: readonly (readonly [cell: string, count: number])[];
  /** Column gaps between the two airborne planes, ascending by gap. */
  readonly gaps: readonly (readonly [gap: number, count: number])[];
  /** Frames both slots held a plane - the gap histogram's denominator. */
  readonly gapSamples: number;
  /** Entries seen across all drives - the histogram's denominator. */
  readonly total: number;
}

/** Pool the five firing cadences and histogram what the spawn path produced. */
export function runEntrySpread(): EntrySpreadResult {
  const entries = new Map<string, number>();
  const gaps = new Map<number, number>();
  let gapSamples = 0;

  for (const block of BLOCKS) {
    const machine = new Tms1370Machine();
    machine.setContacts({ skill: 1, lane: 0, fire: false });
    let previous: readonly Plane[] = slotsOf(machine.ram, SQUADRON);
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
      const slots = slotsOf(ram, SQUADRON);
      for (let slot = 0; slot < slots.length; slot += 1) {
        const now = slots[slot] as Plane;
        const was = previous[slot] as Plane;
        // A slot that held nothing and now holds a plane is an entry.
        if (was.column === 0 && now.column !== 0) bump(entries, `r${now.row}c${now.column}`);
      }
      const flying = slots.filter((plane) => plane.column !== 0);
      if (flying.length === 2) {
        const [a, b] = flying as [Plane, Plane];
        bump(gaps, Math.abs(a.column - b.column));
        gapSamples += 1;
      }
      previous = slots;
    }
  }

  const sortedEntries = [...entries].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    entries: sortedEntries.map(([cell, count]) => [cell, count] as const),
    gaps: [...gaps].sort((a, b) => a[0] - b[0]).map(([gap, count]) => [gap, count] as const),
    gapSamples,
    total: sortedEntries.reduce((sum, [, count]) => sum + count, 0),
  };
}

/** The lines this drive prints. */
export function formatEntrySpread(r: EntrySpreadResult): readonly string[] {
  return [
    `sweep constant ${SWEEP_INSTRUCTIONS} instructions`,
    `entry positions over ${BLOCKS.length} drives (${r.total} entries):`,
    ...r.entries.map(([key, count]) => `  ${key}: ${count} (${((100 * count) / r.total).toFixed(1)}%)`),
    `column gap while both planes are airborne (${r.gapSamples} samples):`,
    ...r.gaps.map(([gap, count]) => `  gap ${gap}: ${count} (${((100 * count) / r.gapSamples).toFixed(1)}%)`),
  ];
}

if (isEntryPoint(import.meta.url)) {
  for (const line of formatEntrySpread(runEntrySpread())) console.log(line);
}
