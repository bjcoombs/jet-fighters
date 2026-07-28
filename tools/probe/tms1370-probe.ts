// Drive `asm/jetfighter.asm` on the TMS1370 core, headlessly.
//
// Paths in this file are relative to the repository root.
//
// This is the harness the v3 game program is measured with while the board and
// the renderer are still HMCS44's - `tools/probe/machine-probe.ts` drives that
// machine and v3 task 13 re-derives it. What this one needs is smaller and
// lives one layer down: the core, the ROM, the output PLA, and the R and O pins
// as they actually move. No DOM, no timers, no clock of its own.
//
// It is a module rather than a CLI because everything that reads it is a test.
// A sweep here is a *measured* quantity - the cycles between two successive
// strobes of the same grid in the same pass - and `src/machine/board/`'s
// cadence constants are derived from the figure this harness reports rather
// than from an estimate of it.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assemble } from '../tmsasm/assembler.js';
import { oplaImage, romImage } from '../tmsasm/output.js';
import { Tms1370Cpu } from '../../src/machine/cpu/tms1370/cpu.js';
import { Tms1370OutputPla } from '../../src/machine/cpu/tms1370/opla.js';
import { Tms1370Rom } from '../../src/machine/cpu/tms1370/memory.js';
import {
  GRID_COUNT,
  K1,
  K2,
  K4,
  K8,
  O_PLATE_COUNT,
  PLATE_COUNT,
  R_GRID_LAST,
  R_PLATE_FIRST,
  R_SPEAKER,
  R_STROBE_FIRST,
  R_STROBE_LAST,
} from '../../src/machine/cpu/tms1370/ports.js';

/** The game program, relative to the repository root. */
export const ROM_SOURCE = 'asm/jetfighter.asm';

/** Assemble the game program, resolving includes against its own directory. */
export function assembleGame(source = ROM_SOURCE): ReturnType<typeof assemble> {
  const path = resolve(import.meta.dirname, '..', '..', source);
  return assemble(readFileSync(path, 'utf8'), path, {
    readInclude: (included, fromFile) => {
      const resolved = resolve(dirname(fromFile), included);
      return { file: resolved, source: readFileSync(resolved, 'utf8') };
    },
  });
}

/** One R15 transition, stamped with the instruction cycle it happened on. */
export interface SpeakerEdge {
  readonly cycle: number;
  readonly level: 0 | 1;
}

/** One grid strobe: which grid, which plates were driven, and for how long. */
export interface Strobe {
  readonly cycle: number;
  readonly grid: number;
  /** 12-bit plate mask: O0-O7 low, R11-R14 high. */
  readonly plates: number;
  /** Instruction cycles the grid stayed high. */
  readonly cycles: number;
}

/** What the case contacts return to K, as the run's input schedule leaves them. */
export interface Contacts {
  /** Lever lane 0-2, or `undefined` for the lever between detents. */
  lane?: number;
  /** Skill dial 1-3, or `undefined` for no contact closed. */
  skill?: number;
  /** The fire button, which is K8 and is not on a strobe column. */
  fire?: boolean;
}

/** One scheduled change to the contacts, applied when the run reaches `cycle`. */
export interface InputEvent {
  readonly cycle: number;
  readonly change: Contacts;
}

export interface RunOptions {
  /** Instruction cycles to execute. */
  readonly cycles: number;
  /** Contact changes to apply as the run passes them. */
  readonly input?: readonly InputEvent[];
  /** Keep every strobe rather than only the counts. Off by default: a second
   *  of emulated time is about 40000 of them. */
  readonly keepStrobes?: boolean;
}

export interface RunResult {
  /** Instruction cycles actually executed. */
  readonly cycles: number;
  /** Display-grid R lines driven at any point: R0-R8 only. */
  readonly gridsStrobed: readonly number[];
  /** R15 transitions, in cycle order. */
  readonly speakerEdges: readonly SpeakerEdge[];
  /** Every grid strobe, when `keepStrobes`; otherwise empty. */
  readonly strobes: readonly Strobe[];
  /** (grid, plate) pairs the ROM lit at any point in the run. */
  readonly litCells: ReadonlySet<string>;
  /** Plate masks the O port emitted, which closure is asserted over. */
  readonly oMasks: ReadonlySet<number>;
  /** Cycles at which more than one of R9/R10 was high. Must be empty. */
  readonly superimposedStrobes: readonly number[];
  /** The cycle of the first strobe of any grid - power-on to first light. */
  readonly firstLitCycle: number | undefined;
  /** RAM as the run left it. */
  readonly ram: Uint8Array;
}

/** `grid:plate`, the key `litCells` uses. */
export function cellKey(grid: number, plate: number): string {
  return `${grid}:${plate}`;
}

/**
 * Run the game program and record what the pins did.
 *
 * The R latch is tracked here rather than through `Tms1370Ports` because this
 * harness wants the *history* - when a grid rose and fell, in cycles - and the
 * port file is a state object. Both read the same pin numbering out of
 * `ports.ts`, so there is no second answer about which R line is a grid.
 */
export function runGame(options: RunOptions): RunResult {
  const assembled = assembleGame();
  const outputPla = new Tms1370OutputPla(oplaImage(assembled));
  const contacts: Contacts = {};
  const events = [...(options.input ?? [])].sort((left, right) => left.cycle - right.cycle);
  let nextEvent = 0;

  let r = 0;
  let o = 0;
  const gridsStrobed = new Set<number>();
  const speakerEdges: SpeakerEdge[] = [];
  const strobes: Strobe[] = [];
  const litCells = new Set<string>();
  const oMasks = new Set<number>();
  const superimposedStrobes: number[] = [];
  const gridRoseAt = new Map<number, number>();
  let firstLitCycle: number | undefined;

  const plateMask = (): number =>
    (o & 0xff) | (((r >>> R_PLATE_FIRST) & 0xf) << O_PLATE_COUNT);

  const readK = (): number => {
    let value = contacts.fire ? K8 : 0;
    const column = (r >>> R_STROBE_FIRST) & 0b11;
    if (column & 0b01 && contacts.skill !== undefined) {
      value |= [K1, K2, K4][contacts.skill - 1] ?? 0;
    }
    if (column & 0b10 && contacts.lane !== undefined) {
      value |= [K1, K2, K4][contacts.lane] ?? 0;
    }
    return value;
  };

  const writeOIndex = (index: number): void => {
    o = outputPla.decode(index) & 0xff;
    oMasks.add(o);
  };

  const writeR = (index: number, on: boolean): void => {
    const before = r;
    r = on ? r | (1 << index) : r & ~(1 << index);
    if (r === before) {
      return;
    }
    const cycle = cpu.cycles;
    if (index === R_SPEAKER) {
      speakerEdges.push({ cycle, level: on ? 1 : 0 });
      return;
    }
    if (index >= R_STROBE_FIRST && index <= R_STROBE_LAST) {
      const driven = ((r >>> R_STROBE_FIRST) & 0b01) + ((r >>> (R_STROBE_FIRST + 1)) & 0b01);
      if (driven > 1) {
        superimposedStrobes.push(cycle);
      }
      return;
    }
    if (index > R_GRID_LAST) {
      return;
    }
    if (on) {
      gridsStrobed.add(index);
      gridRoseAt.set(index, cycle);
      firstLitCycle ??= cycle;
      const plates = plateMask();
      for (let plate = 0; plate < PLATE_COUNT; plate += 1) {
        if ((plates >>> plate) & 1) {
          litCells.add(cellKey(index, plate));
        }
      }
      return;
    }
    const rose = gridRoseAt.get(index);
    if (rose === undefined) {
      return;
    }
    gridRoseAt.delete(index);
    if (options.keepStrobes) {
      strobes.push({ cycle: rose, grid: index, plates: plateMask(), cycles: cycle - rose });
    }
  };

  const cpu = new Tms1370Cpu({
    rom: new Tms1370Rom(romImage(assembled)),
    outputPla,
    pins: { readK, writeOIndex, writeR },
  });
  cpu.reset();
  while (cpu.cycles < options.cycles) {
    while (nextEvent < events.length && (events[nextEvent] as InputEvent).cycle <= cpu.cycles) {
      Object.assign(contacts, (events[nextEvent] as InputEvent).change);
      nextEvent += 1;
    }
    cpu.step();
  }

  return {
    cycles: cpu.cycles,
    gridsStrobed: [...gridsStrobed].sort((left, right) => left - right),
    speakerEdges,
    strobes,
    litCells,
    oMasks,
    superimposedStrobes,
    firstLitCycle,
    ram: Uint8Array.from(
      { length: 128 },
      (_unused, address) => cpu.ram.read(address >> 4, address & 0xf),
    ),
  };
}

/**
 * The sweep period, in instruction cycles, measured off the running machine.
 *
 * Taken between successive rises of grid 0 in the *near* pass, identified as
 * the first strobe of grid 0 after a strobe of grid 8 - grid 8 is only reached
 * in the two high-bank passes, which is what makes it the sweep's boundary
 * marker without the harness having to know the pass order.
 *
 * Returns every interval rather than a mean, because the sweep is not
 * frequency-stable by design: the between-sweep work varies with what is on the
 * glass, and a sound stops the sweep outright. A caller wanting one number
 * should say which population it is taking it over.
 */
export function sweepPeriods(strobes: readonly Strobe[]): readonly number[] {
  const boundaries: number[] = [];
  let sawLastGrid = false;
  for (const strobe of strobes) {
    if (strobe.grid === GRID_COUNT - 1) {
      sawLastGrid = true;
      continue;
    }
    if (sawLastGrid && strobe.grid === 0) {
      boundaries.push(strobe.cycle);
      sawLastGrid = false;
    }
  }
  const periods: number[] = [];
  for (let at = 1; at < boundaries.length; at += 1) {
    periods.push((boundaries[at] as number) - (boundaries[at - 1] as number));
  }
  return periods;
}

/** Split a speaker-edge stream into events at any silence longer than `gap`. */
export function splitSounds(
  edges: readonly SpeakerEdge[],
  gap: number,
): readonly { readonly from: number; readonly to: number; readonly edges: number }[] {
  const sounds: { from: number; to: number; edges: number }[] = [];
  let current: { from: number; to: number; edges: number } | undefined;
  for (const edge of edges) {
    if (!current || edge.cycle - current.to > gap) {
      current = { from: edge.cycle, to: edge.cycle, edges: 1 };
      sounds.push(current);
      continue;
    }
    current.to = edge.cycle;
    current.edges += 1;
  }
  return sounds;
}

/**
 * The dominant repetition rate of one sound, in hertz.
 *
 * A square wave on one pin has no spectrum worth taking: the period is the time
 * between every second edge, and the honest figure is the median of those
 * rather than a transform of a two-level signal.
 */
export function soundHz(
  edges: readonly SpeakerEdge[],
  from: number,
  to: number,
  cycleHz: number,
): number {
  const within = edges.filter((edge) => edge.cycle >= from && edge.cycle <= to);
  const periods: number[] = [];
  for (let at = 2; at < within.length; at += 2) {
    periods.push((within[at] as SpeakerEdge).cycle - (within[at - 2] as SpeakerEdge).cycle);
  }
  if (periods.length === 0) {
    return 0;
  }
  periods.sort((left, right) => left - right);
  const median = periods[periods.length >> 1] as number;
  return cycleHz / median;
}
