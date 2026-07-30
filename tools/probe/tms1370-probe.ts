// Drive `asm/jetfighter.asm` on the TMS1370 core, headlessly.
//
// Paths in this file are relative to the repository root.
//
// This is the harness the game program is measured with. `machine-probe.ts`
// beside it is the contract's CLI drive surface and goes through the whole
// board; what this one needs is smaller and lives one layer down: the core, the
// ROM, the output PLA, and the R and O pins as they actually move. No DOM, no
// timers, no clock of its own.
//
// It is a module rather than a CLI because everything that reads it is a test.
// A sweep here is a *measured* quantity - the cycles between two successive
// strobes of the same grid in the same pass - and `src/machine/board/`'s
// cadence constants are derived from the figure this harness reports rather
// than from an estimate of it.
//
// Two shapes, one machine. {@link runGame} runs a whole drive from an input
// schedule and hands back what happened; {@link Tms1370Machine} is the same
// machine stepped a slice at a time, for the suites that decide what to do next
// from what the tube is showing. The pin wiring is written once, in the class.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assemble } from '../tmsasm/assembler.js';
import { oplaImage, romImage } from '../tmsasm/output.js';
import { Tms1370Cpu } from '../../src/machine/cpu/tms1370/cpu.js';
import { Tms1370OutputPla } from '../../src/machine/cpu/tms1370/opla.js';
import { Tms1370Rom } from '../../src/machine/cpu/tms1370/memory.js';
import { PwmAccumulator, type PwmFrame, type SegmentDuty } from '../../src/machine/board/pwm.js';
import { REFRESH_TIMEOUT_CYCLES } from '../../src/machine/board/tms1370-cadence.js';
import {
  GRID_COUNT,
  K1,
  K2,
  K4,
  K8,
  O_PLATE_COUNT,
  PLATE_COUNT,
  R_GRID_LAST,
  R_GRID_MASK,
  R_PLATE_FIRST,
  R_PLATE_LAST,
  R_SPEAKER,
  R_STROBE_FIRST,
  R_STROBE_LAST,
} from '../../src/machine/cpu/tms1370/ports.js';

export type { PwmFrame, SegmentDuty };

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
 * The TMS1370 machine as a probe suite observes it: pins, tube and speaker.
 *
 * `runGame` below runs a whole drive and hands back what happened. This is the
 * same machine driven a slice at a time, for the suites that have to *decide*
 * what to do next from what the tube is showing - park the lever out of the
 * boat's lane, read the glass at 60 Hz and draw it, stop when the game ends.
 *
 * Three things it owns that the core does not:
 *
 * 1. **The R latch's history.** `Tms1370Ports` is a state object; this wants to
 *    know when a grid rose and when it fell, in cycles, because that interval is
 *    the whole of a segment's duty.
 * 2. **The frame period.** `src/machine/board/display.ts` closes a frame when a
 *    grid rises that has already risen, which was right for a machine that drew
 *    each grid once per sweep. This one draws four passes and visits grid 0 in
 *    three of them, so that rule would call every *pass* a frame and hand the
 *    renderer one family at a time. The boundary here is the sweep wrapping -
 *    grid 0 rising after the last grid has been strobed - which is the same
 *    marker `sweepPeriods` uses and the period the tube is actually refreshed
 *    over.
 * 3. **The blanking rule.** A tube nothing has driven for longer than
 *    `REFRESH_TIMEOUT_CYCLES` is dark, and the stalled interval comes out of the
 *    frame period it fell in rather than dimming the sweeps either side of it.
 *    Both are `Display`'s rules, applied here to this machine's frame boundary.
 *
 * No DOM, no timers, no clock of its own: nothing advances unless `step` is
 * called.
 */
export class Tms1370Machine {
  private readonly cpu: Tms1370Cpu;
  private readonly outputPla: Tms1370OutputPla;
  private readonly pwm = new PwmAccumulator(GRID_COUNT, PLATE_COUNT);
  private readonly contacts: Contacts = {};
  private readonly keepStrobes: boolean;

  private r = 0;
  private o = 0;

  private readonly _speakerEdges: SpeakerEdge[] = [];
  private readonly _strobes: Strobe[] = [];
  private readonly _litCells = new Set<string>();
  private readonly _oMasks = new Set<number>();
  private readonly _superimposedStrobes: number[] = [];
  private readonly _gridsStrobed = new Set<number>();
  private readonly gridRoseAt = new Map<number, number>();
  private _firstLitCycle: number | undefined;

  private sawLastGrid = false;
  private lastDriveCycle = 0;
  private lastFrame: PwmFrame | undefined;
  private _sweepCount = 0;

  constructor(options: { readonly keepStrobes?: boolean } = {}) {
    this.keepStrobes = options.keepStrobes ?? false;
    const assembled = assembleGame();
    this.outputPla = new Tms1370OutputPla(oplaImage(assembled));
    this.cpu = new Tms1370Cpu({
      rom: new Tms1370Rom(romImage(assembled)),
      outputPla: this.outputPla,
      pins: {
        readK: () => this.readK(),
        writeOIndex: (index) => this.writeOIndex(index),
        writeR: (index, on) => this.writeR(index, on),
      },
    });
    this.cpu.reset();
  }

  /** Instruction cycles executed since power-on. */
  get cycles(): number {
    return this.cpu.cycles;
  }

  /** Sweeps the tube has completed - frame periods, on this machine. */
  get sweepCount(): number {
    return this._sweepCount;
  }

  /** Display-grid R lines driven at any point: R0-R8 only. */
  get gridsStrobed(): readonly number[] {
    return [...this._gridsStrobed].sort((left, right) => left - right);
  }

  /** Every grid strobe so far, when the machine was built with `keepStrobes`. */
  get strobes(): readonly Strobe[] {
    return this._strobes;
  }

  /** (grid, plate) pairs the ROM has lit at any point. */
  get litCells(): ReadonlySet<string> {
    return this._litCells;
  }

  /** Plate masks the O port has emitted, which closure is asserted over. */
  get oMasks(): ReadonlySet<number> {
    return this._oMasks;
  }

  /** Cycles at which more than one of R9/R10 was high. Must stay empty. */
  get superimposedStrobes(): readonly number[] {
    return this._superimposedStrobes;
  }

  /** The cycle of the first strobe of any grid - power-on to first light. */
  get firstLitCycle(): number | undefined {
    return this._firstLitCycle;
  }

  /** Every speaker edge so far, without consuming any. */
  get speakerEdges(): readonly SpeakerEdge[] {
    return this._speakerEdges;
  }

  /** RAM as it stands, as a flat 128-nibble image addressed `file * 16 + nibble`. */
  get ram(): Uint8Array {
    return Uint8Array.from({ length: 128 }, (_unused, address) =>
      this.cpu.ram.read(address >> 4, address & 0xf),
    );
  }

  /**
   * Write one RAM nibble directly - **the only way past the K matrix, and not
   * how a scenario is set up.**
   *
   * Everything else in this harness reaches the game the way a player does, by
   * closing a contact, and CLAUDE.md's "no game state outside the emulated RAM"
   * is why. This exists for the one case where the honest route is a CI
   * liability rather than a discipline: the win jingle needs 199 points, which
   * is minutes of emulated play, and the thing under test is the jingle rather
   * than the route to it.
   *
   * Used correctly it moves the machine *next to* the behaviour and lets the ROM
   * do the rest - set the score to 198 and let a kill carry it to 199 through
   * `add_score`, so `as_win` and `game_win` are still entered by the program's
   * own path. Used to write the outcome itself it would assert nothing, which is
   * the failure mode the rest of these suites exist to avoid.
   *
   * If you are reaching for this to avoid *driving* something, drive it.
   */
  pokeRam(file: number, nibble: number, value: number): void {
    this.cpu.ram.write(file, nibble, value);
  }

  /** Close one or more case contacts, leaving the rest as they are. */
  setContacts(change: Contacts): void {
    Object.assign(this.contacts, change);
  }

  /**
   * Advance the machine by a cycle budget.
   *
   * A budget, not a schedule: the last instruction may carry the count past the
   * budget, and the caller gets the cycles actually executed. Same contract as
   * `Board.step`, which is what makes a drive written against one readable
   * against the other.
   */
  step(budget: number): number {
    const from = this.cpu.cycles;
    const until = from + Math.max(0, budget);
    while (this.cpu.cycles < until) {
      this.cpu.step();
    }
    return this.cpu.cycles - from;
  }

  /**
   * Run until `count` further sweeps have completed, or `maxCycles` are spent.
   *
   * The ceiling is not optional and not a nicety: the ROM stops sweeping for the
   * whole of every sound and for good once the game ends, so a caller waiting on
   * a sweep that will not come needs the loop to end rather than the suite to
   * time out sixty seconds later.
   */
  runSweeps(count: number, maxCycles: number): number {
    const from = this.cpu.cycles;
    const target = this._sweepCount + count;
    while (this._sweepCount < target && this.cpu.cycles - from < maxCycles) {
      this.cpu.step();
    }
    return this.cpu.cycles - from;
  }

  /** Take every speaker edge buffered since the last call. */
  takeSpeakerEdges(): readonly SpeakerEdge[] {
    return this._speakerEdges.splice(0, this._speakerEdges.length);
  }

  /** Instruction cycles since a grid was last driven. Zero while one is up. */
  refreshGap(cycle = this.cpu.cycles): number {
    if ((this.r & R_GRID_MASK) !== 0) {
      return 0;
    }
    return Math.max(0, cycle - this.lastDriveCycle);
  }

  /** True while the sweep is still refreshing the tube. */
  isRefreshing(cycle = this.cpu.cycles): boolean {
    return this.refreshGap(cycle) <= REFRESH_TIMEOUT_CYCLES;
  }

  /** The last sweep the tube completed, or an empty frame before the first. */
  getFrame(): PwmFrame {
    return (
      this.lastFrame ?? {
        startCycle: this.pwm.frameStart,
        endCycle: this.pwm.frameStart,
        cycles: 0,
        segments: [],
      }
    );
  }

  /**
   * What is on the tube at `cycle` - the frame a renderer should draw.
   *
   * `Display.getObservedFrame`'s rule, and for its reason: a stalled sweep
   * completes no period, so the last completed one would go on being reported as
   * lit for as long as the ROM held the speaker. Past the refresh timeout this
   * reports what is true instead - no grid driven, so nothing lit.
   */
  getObservedFrame(cycle = this.cpu.cycles): PwmFrame {
    if (this.isRefreshing(cycle)) {
      return this.getFrame();
    }
    return {
      startCycle: this.lastDriveCycle,
      endCycle: cycle,
      cycles: cycle - this.lastDriveCycle,
      segments: [],
    };
  }

  /** Segments lit over the last completed sweep, with their duty. */
  getLitSegments(cycle = this.cpu.cycles): readonly SegmentDuty[] {
    return this.getObservedFrame(cycle).segments;
  }

  /** Distinct display grids driven since power-on, ascending. */
  getStrobedGrids(): readonly number[] {
    return this.gridsStrobed;
  }

  private readK(): number {
    let value = this.contacts.fire ? K8 : 0;
    const column = (this.r >>> R_STROBE_FIRST) & 0b11;
    if (column & 0b01 && this.contacts.skill !== undefined) {
      value |= [K1, K2, K4][this.contacts.skill - 1] ?? 0;
    }
    if (column & 0b10 && this.contacts.lane !== undefined) {
      value |= [K1, K2, K4][this.contacts.lane] ?? 0;
    }
    return value;
  }

  private plateMask(): number {
    return (this.o & 0xff) | (((this.r >>> R_PLATE_FIRST) & 0xf) << O_PLATE_COUNT);
  }

  private writeOIndex(index: number): void {
    const next = this.outputPla.decode(index) & 0xff;
    this._oMasks.add(next);
    if (next === this.o) {
      return;
    }
    this.o = next;
    this.pwm.recordState(this.r & R_GRID_MASK, this.plateMask(), this.cpu.cycles);
  }

  private writeR(index: number, on: boolean): void {
    const before = this.r;
    this.r = on ? this.r | (1 << index) : this.r & ~(1 << index);
    if (this.r === before) {
      return;
    }
    const cycle = this.cpu.cycles;
    if (index === R_SPEAKER) {
      this._speakerEdges.push({ cycle, level: on ? 1 : 0 });
      return;
    }
    if (index >= R_STROBE_FIRST && index <= R_STROBE_LAST) {
      const driven =
        ((this.r >>> R_STROBE_FIRST) & 0b01) + ((this.r >>> (R_STROBE_FIRST + 1)) & 0b01);
      if (driven > 1) {
        this._superimposedStrobes.push(cycle);
      }
      return;
    }
    if (index >= R_PLATE_FIRST && index <= R_PLATE_LAST) {
      this.pwm.recordState(this.r & R_GRID_MASK, this.plateMask(), cycle);
      return;
    }
    if (index > R_GRID_LAST) {
      return;
    }
    if (on) {
      this.gridRose(index, cycle);
    } else {
      this.gridFell(index, cycle);
    }
    this.pwm.recordState(this.r & R_GRID_MASK, this.plateMask(), cycle);
  }

  private gridRose(grid: number, cycle: number): void {
    // Drive resuming after the sweep stopped. The stall comes out of the frame
    // period it happened in: the tube was not being scanned then, so it is not
    // refresh time, and leaving it in would make the sweeps either side of a
    // sound read as dim ones. `PwmAccumulator.exclude`, and `Display`'s rule.
    if ((this.r & R_GRID_MASK & ~(1 << grid)) === 0) {
      const gap = cycle - this.lastDriveCycle;
      if (gap > REFRESH_TIMEOUT_CYCLES) {
        this.pwm.exclude(gap);
      }
    }

    // The sweep wrapping, which is this machine's frame boundary. The last grid
    // is only reached in the two high-bank passes, so seeing it and then grid 0
    // is the boundary without the harness having to know the pass order - the
    // same marker `sweepPeriods` takes its periods between.
    if (grid === GRID_COUNT - 1) {
      this.sawLastGrid = true;
    } else if (grid === 0 && this.sawLastGrid) {
      this.lastFrame = this.pwm.endFrame(cycle);
      this._sweepCount += 1;
      this.sawLastGrid = false;
    }

    this._gridsStrobed.add(grid);
    this.gridRoseAt.set(grid, cycle);
    this._firstLitCycle ??= cycle;
    const plates = this.plateMask();
    for (let plate = 0; plate < PLATE_COUNT; plate += 1) {
      if ((plates >>> plate) & 1) {
        this._litCells.add(cellKey(grid, plate));
      }
    }
  }

  private gridFell(grid: number, cycle: number): void {
    if ((this.r & R_GRID_MASK) === 0) {
      this.lastDriveCycle = cycle;
    }
    const rose = this.gridRoseAt.get(grid);
    if (rose === undefined) {
      return;
    }
    this.gridRoseAt.delete(grid);
    if (this.keepStrobes) {
      this._strobes.push({ cycle: rose, grid, plates: this.plateMask(), cycles: cycle - rose });
    }
  }
}

/**
 * Run the game program and record what the pins did.
 *
 * The whole-drive form of {@link Tms1370Machine}: apply the input schedule as
 * the run passes it, and hand back what happened. A suite that has to decide
 * what to do next from what the tube is showing drives the machine directly
 * instead.
 */
export function runGame(options: RunOptions): RunResult {
  const machine = new Tms1370Machine({ keepStrobes: options.keepStrobes ?? false });
  const events = [...(options.input ?? [])].sort((left, right) => left.cycle - right.cycle);
  let nextEvent = 0;

  while (machine.cycles < options.cycles) {
    while (nextEvent < events.length && (events[nextEvent] as InputEvent).cycle <= machine.cycles) {
      machine.setContacts((events[nextEvent] as InputEvent).change);
      nextEvent += 1;
    }
    machine.step(1);
  }

  return {
    cycles: machine.cycles,
    gridsStrobed: machine.gridsStrobed,
    speakerEdges: machine.speakerEdges,
    strobes: machine.strobes,
    litCells: machine.litCells,
    oMasks: machine.oMasks,
    superimposedStrobes: machine.superimposedStrobes,
    firstLitCycle: machine.firstLitCycle,
    ram: machine.ram,
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

/**
 * The repetition rate of a pulse train, by harmonic-comb periodicity.
 *
 * `soundHz` above is the right tool for a note: a square wave's period is the
 * time between every second edge and the median of those is the pitch. It is
 * the wrong tool for the battleship's buzz, and
 * `docs/evidence/audio-reference.md` says why at length - the buzz is clocked
 * off the display sweep, so its edges are not evenly spaced, and it overlaps
 * whatever else the game is sounding. A median period reads the jitter, and an
 * edges-per-second count reads the march beep's edges as if they were the
 * buzz's.
 *
 * So this scores each candidate f0 the way that document's detector does:
 * treat the edges as an impulse train and take the magnitude of its transform
 * at f0. A 627 Hz march beep inside the window contributes nothing at 90 Hz;
 * an 86 Hz buzz does. The scan range is the measured band widened either side,
 * so a rate outside the band is reported rather than clamped into it.
 */
export function combPeriodicityHz(
  edges: readonly SpeakerEdge[],
  from: number,
  to: number,
  cycleHz: number,
  lowHz = 60,
  highHz = 140,
): number {
  const within = edges.filter((edge) => edge.cycle >= from && edge.cycle <= to);
  if (within.length < 4) {
    return 0;
  }
  let bestHz = 0;
  let bestScore = -1;
  for (let hz = lowHz; hz <= highHz; hz += 0.25) {
    let real = 0;
    let imaginary = 0;
    for (const edge of within) {
      const phase = (2 * Math.PI * hz * edge.cycle) / cycleHz;
      real += Math.cos(phase);
      imaginary += Math.sin(phase);
    }
    const score = Math.hypot(real, imaginary);
    if (score > bestScore) {
      bestScore = score;
      bestHz = hz;
    }
  }
  return bestHz;
}
