// The comparison harness (PRD R7, contract V11): run a TMS1370 machine image
// and report the surface a comparison against the original can be made on.
//
// Paths in this file are relative to the repository root.
//
// ## What this compares, and why it is not the O port
//
// Our output PLA and Gakken's are **different tables by design**. Reproducing
// theirs in our ROM is an explicit non-goal of `docs/prd/jet-fighters-v3.md`,
// and `src/machine/board/o-pla.ts` is this repository's own 32-slot design
// justified from `src/machine/tube/atlas.json` and nothing else. So the index a
// program writes with `TDO`, and the eight-bit mask that index decodes to, are
// private to each machine image: two ROMs can put the identical picture on the
// identical glass through entirely different slots.
//
// Comparing O-port writes would therefore report a difference on every strobe
// of a perfectly faithful build. What is common to both machines is the tube -
// nine grids, twelve plates, 94 segments at fixed (grid, plate) addresses - so
// the comparison surface is **what lights on the glass**, per display sweep,
// plus the speaker's edges and the score the digits read out.
//
// That is also why comparing against the original needs *their* output PLA and
// not only their program dump: a dump alone emits five-bit indices, and without
// the table those indices decode through there is no statement about plates at
// all. Loading their table to interpret their dump is a different act from
// reproducing it in our ROM, and only the second is out of scope.
// `docs/research/comparison-surface.md` sets this out at length.
//
// ## The romset is absent, and that is the primary path
//
// None of `mp2110`, `tms1100_ginv_output.pla`, `ginv.svg` or
// `tms1100_common2_micro.pla` has been obtained by this project. Contract V11
// is explicit that a harness which cannot run without them fails, so the
// no-romset mode is the one this module is designed around and the alternative
// image is the option. Absence of a romset is not an error condition here and
// never sets a non-zero exit - see `tools/compare/cli.ts` for the exit codes.
//
// **No ROM content from the original is present in this repository**, and this
// module contains no decode of any original artifact. It reads what a caller
// hands it.
//
// ## Timing is compared in instruction cycles, never in seconds
//
// `src/machine/cpu/tms1370/timing.ts` records that MAME's 350 kHz is a fitted
// RC-oscillator approximation carrying a stated +/-50 kHz, so the instruction
// rate is the range `CYCLE_HZ_MIN`..`CYCLE_HZ_MAX` rather than a point. Every
// comparison below is made in instruction cycles, which is rate-free: two
// images executing the same number of instructions agree whatever the
// oscillator does. The spread enters only when a cycle count is *quoted* as a
// duration, and {@link cyclesToMillisecondRange} is the one place that happens.
//
// Node-side tool: no DOM, no timers, no Web APIs, no runtime dependencies.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assemble } from '../tmsasm/assembler.js';
import { oplaImage, romImage } from '../tmsasm/output.js';
import { Tms1370Cpu } from '../../src/machine/cpu/tms1370/cpu.js';
import { Tms1370OutputPla, O_PLA_ENTRY_COUNT } from '../../src/machine/cpu/tms1370/opla.js';
import { Tms1370Rom } from '../../src/machine/cpu/tms1370/memory.js';
import { ROM_WORD_COUNT } from '../../src/machine/cpu/tms1370/registers.js';
import { CYCLE_HZ_MAX, CYCLE_HZ_MIN } from '../../src/machine/cpu/tms1370/timing.js';
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
  R_PLATE_LAST,
  R_SPEAKER,
  R_STROBE_FIRST,
  R_STROBE_LAST,
} from '../../src/machine/cpu/tms1370/ports.js';
import {
  DIGIT_COUNT,
  GRID_SCORE_TENS,
  GRID_SCORE_UNITS,
  digitMask,
} from '../../src/machine/board/o-pla.js';
import { STROBE_CYCLES, SWEEP_INSTRUCTIONS } from '../../src/machine/board/tms1370-cadence.js';
// The vocabulary of a run - a strobe, a speaker edge, a contact change - is
// `tools/probe/tms1370-probe.ts`'s and is imported rather than restated. That
// module is the measurement instrument for our own ROM and stays so; what this
// one adds is the generalisation over *which* machine image is running, which
// the probe deliberately does not have. `harness.test.ts` pins the two together
// by asserting they produce an identical strobe and edge stream for our image,
// so the generalisation cannot drift into a second answer.
import type {
  Contacts,
  InputEvent,
  SpeakerEdge,
  Strobe,
} from '../probe/tms1370-probe.js';
import { cellKey } from '../probe/tms1370-probe.js';

export type { Contacts, InputEvent, SpeakerEdge, Strobe };
export { cellKey };

/** The game program this repository builds, relative to the repository root. */
export const OUR_ROM_SOURCE = 'asm/jetfighter.asm';

/**
 * Sweeps one comparison run records by default.
 *
 * Stated in sweeps rather than in cycles or in seconds, because a sweep is the
 * unit the comparison surface is sampled in and it is rate-free: refining the
 * oscillator constant moves how long this takes on a wall clock and moves
 * nothing about what is compared. 200 is enough that the report shows the
 * surface changing rather than one still frame, and short enough that a run is
 * a couple of seconds of CPU.
 */
export const DEFAULT_SWEEPS = 200;

/** Instruction cycles a default run executes: {@link DEFAULT_SWEEPS} sweeps. */
export const DEFAULT_CYCLES = DEFAULT_SWEEPS * SWEEP_INSTRUCTIONS;

/**
 * How far apart two speaker edges may sit and still be the same edge, in
 * instruction cycles.
 *
 * One grid strobe. `asm/jetfighter.asm`'s `strobe` ticks the buzz between
 * `SETR` and `RSTR`, so a speaker edge is emitted from inside a grid's dwell
 * and the finest granularity at which two programs can be said to agree about
 * an edge is the dwell it fell in. Derived from `STROBE_CYCLES`, which
 * `src/machine/board/tms1370-cadence.ts` derives from the measured sweep
 * length, so a cadence change moves this with it (contract V14).
 */
export const SPEAKER_EDGE_TOLERANCE_CYCLES = Math.round(STROBE_CYCLES);

/**
 * How much later than the other machine a control may be acted on, in cycles.
 *
 * One sweep. A contact on K1/K2/K4 is only visible while its own column is
 * strobed, and the ROM comes round to a given column once a sweep, so two
 * images that both read the contact on their next pass can legitimately differ
 * by up to a whole sweep in when they act on it.
 */
export const INPUT_RESPONSE_TOLERANCE_CYCLES = SWEEP_INSTRUCTIONS;

/**
 * A machine image: a program ROM, the output PLA that interprets its `TDO`
 * indices, and where both came from.
 *
 * The PLA travels with the image rather than being a property of the harness,
 * which is the whole reason this type exists. Our image's table is ours and the
 * original's is Gakken's; a program image on its own says nothing about plates
 * (PRD R7's table: "a program image alone cannot say what lights").
 */
export interface MachineImage {
  /** Short label used in reports, e.g. `ours` or `mp2110`. */
  readonly name: string;
  /** Program words, at most {@link ROM_WORD_COUNT}. */
  readonly rom: Uint8Array;
  /** Output PLA masks, at most {@link O_PLA_ENTRY_COUNT}. */
  readonly opla: Uint8Array;
  /** Where the two above came from, printed verbatim in the report. */
  readonly provenance: string;
}

/** What one recording run is asked to do. */
export interface RecordOptions {
  /** Instruction cycles to execute. Defaults to {@link DEFAULT_CYCLES}. */
  readonly cycles?: number;
  /** Contact changes applied as the run passes them. */
  readonly input?: readonly InputEvent[];
}

/** The score as the two digit grids read out over one sweep. */
export interface ScoreReadout {
  /** Tens digit, or `undefined` when blank (leading-zero suppression). */
  readonly tens: number | undefined;
  /** Units digit, or `undefined` when blank. */
  readonly units: number | undefined;
  /** `score_hundreds`, grid 7 plate 7. */
  readonly hundreds: boolean;
  /** `score_label`, grid 8 plate 7. */
  readonly label: boolean;
  /**
   * The number a player reads off the glass, or `undefined` when either digit
   * lit a pattern that is not one of the ten shapes.
   */
  readonly value: number | undefined;
  /** Plates 0-6 as lit on grid 7 and grid 8, for a report to show verbatim. */
  readonly digitPlates: readonly [number, number];
}

/** One display sweep: the frame the comparison is made per. */
export interface Frame {
  /** Position in the recording, from 0. */
  readonly index: number;
  /** Cycle the sweep's first strobe rose on. */
  readonly fromCycle: number;
  /** Cycle the next sweep's first strobe rose on. */
  readonly toCycle: number;
  /** `grid:plate` for every cell driven at any point in the sweep. */
  readonly litCells: ReadonlySet<string>;
  /** What the score grids read out over the sweep. */
  readonly score: ScoreReadout;
}

/** When one injected contact change first reached the glass and the speaker. */
export interface InputResponse {
  /** The event this measures. */
  readonly event: InputEvent;
  /**
   * Cycles from the event to the start of the first sweep whose lit set
   * differs from the sweep in progress when it was injected, or `undefined` if
   * the recording ended with no such sweep.
   */
  readonly litResponseCycles: number | undefined;
  /** Cycles from the event to the next speaker edge, or `undefined`. */
  readonly speakerResponseCycles: number | undefined;
}

/** Everything one run of one machine image put on its pins. */
export interface Recording {
  /** The image that produced it. */
  readonly image: MachineImage;
  /** Instruction cycles executed. */
  readonly cycles: number;
  /** Complete display sweeps, in order. A partial sweep at either end is cut. */
  readonly frames: readonly Frame[];
  /** R15 transitions, in cycle order. */
  readonly speakerEdges: readonly SpeakerEdge[];
  /** Every grid strobe, in rise order. */
  readonly strobes: readonly Strobe[];
  /** Display-grid R lines driven at any point: R0-R8 only. */
  readonly gridsStrobed: readonly number[];
  /** Cycles at which more than one of R9/R10 was high. Must be empty. */
  readonly superimposedStrobes: readonly number[];
  /** Cycle of the first strobe of any grid - power-on to first light. */
  readonly firstLitCycle: number | undefined;
  /** One entry per injected event, in event order. */
  readonly inputResponses: readonly InputResponse[];
  /** The score values the display passed through, in order, without repeats. */
  readonly scoreProgression: readonly (number | undefined)[];
}

/**
 * Assemble `asm/jetfighter.asm` into the image this repository runs.
 *
 * The only file system access in this module, and it reads our own source -
 * never a romset. Romset loading is `tools/compare/romset.ts`'s job and is kept
 * apart from this one so that the no-romset path has no code path through a
 * romset reader at all.
 */
export function ourMachineImage(source = OUR_ROM_SOURCE): MachineImage {
  const path = resolve(import.meta.dirname, '..', '..', source);
  const assembled = assemble(readFileSync(path, 'utf8'), path, {
    readInclude: (included, fromFile) => {
      const resolved = resolve(dirname(fromFile), included);
      return { file: resolved, source: readFileSync(resolved, 'utf8') };
    },
  });
  return {
    name: 'ours',
    rom: romImage(assembled),
    opla: oplaImage(assembled),
    provenance: `assembled from ${source} in this repository`,
  };
}

/**
 * Reject an image the hardware could not hold, naming which half is wrong.
 *
 * Called before a run rather than trusted from a loader, because an alternative
 * image arrives from outside this repository and the failure a caller needs is
 * "your dump is 4096 words" rather than a truncated comparison that looks fine.
 */
export function validateImage(image: MachineImage): void {
  if (image.rom.length > ROM_WORD_COUNT) {
    throw new RangeError(
      `machine image '${image.name}' holds ${image.rom.length} words, ` +
        `more than the ${ROM_WORD_COUNT} the TMS1370 addresses`,
    );
  }
  if (image.opla.length > O_PLA_ENTRY_COUNT) {
    throw new RangeError(
      `output PLA for '${image.name}' holds ${image.opla.length} entries, ` +
        `more than the ${O_PLA_ENTRY_COUNT} a five-bit index reaches`,
    );
  }
}

/**
 * Run one machine image and record what its pins did.
 *
 * The R latch is tracked here rather than read back from `Tms1370Ports` for the
 * same reason `tools/probe/tms1370-probe.ts` tracks it: this wants the
 * *history* - when a grid rose and fell, in cycles - and the port file is a
 * state object. Both read the same pin numbering out of `ports.ts`, so there is
 * no second answer about which R line is a grid.
 *
 * A cell counts as lit if it was driven at **any** point in the grid's dwell,
 * not only at the rise. Our own `strobe` writes `TDO` before `SETR`, so for our
 * image the two readings coincide; an alternative image that moves the O write
 * inside the dwell would light the glass and the rise-only reading would miss
 * it.
 */
export function record(image: MachineImage, options: RecordOptions = {}): Recording {
  validateImage(image);
  const cycles = options.cycles ?? DEFAULT_CYCLES;
  const outputPla = new Tms1370OutputPla(image.opla);
  const contacts: Contacts = {};
  const events = [...(options.input ?? [])].sort((left, right) => left.cycle - right.cycle);
  let nextEvent = 0;

  let r = 0;
  let o = 0;
  const gridsStrobed = new Set<number>();
  const speakerEdges: SpeakerEdge[] = [];
  const strobes: Strobe[] = [];
  const superimposedStrobes: number[] = [];
  const gridRoseAt = new Map<number, number>();
  const gridLitPlates = new Map<number, number>();
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

  /** Fold the plates driven right now into every grid currently high. */
  const accumulate = (): void => {
    if (gridRoseAt.size === 0) {
      return;
    }
    const plates = plateMask();
    for (const grid of gridRoseAt.keys()) {
      gridLitPlates.set(grid, (gridLitPlates.get(grid) ?? 0) | plates);
    }
  };

  const writeOIndex = (index: number): void => {
    accumulate();
    o = outputPla.decode(index) & 0xff;
    accumulate();
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
    if (index >= R_PLATE_FIRST && index <= R_PLATE_LAST) {
      // A plate line moved while grids may be high: that is new light.
      accumulate();
      return;
    }
    if (index > R_GRID_LAST) {
      // An R pin the map gives no role. There is none today - the budget is
      // exactly full - and the guard is here so that a pin map with a gap in it
      // does not fall through into the grid arm.
      return;
    }
    if (on) {
      gridsStrobed.add(index);
      gridRoseAt.set(index, cycle);
      gridLitPlates.set(index, plateMask());
      firstLitCycle ??= cycle;
      return;
    }
    const rose = gridRoseAt.get(index);
    if (rose === undefined) {
      return;
    }
    const lit = gridLitPlates.get(index) ?? 0;
    gridRoseAt.delete(index);
    gridLitPlates.delete(index);
    strobes.push({ cycle: rose, grid: index, plates: lit, cycles: cycle - rose });
  };

  const cpu = new Tms1370Cpu({
    rom: new Tms1370Rom(image.rom),
    outputPla,
    pins: { readK, writeOIndex, writeR },
  });
  cpu.reset();
  while (cpu.cycles < cycles) {
    while (nextEvent < events.length && (events[nextEvent] as InputEvent).cycle <= cpu.cycles) {
      Object.assign(contacts, (events[nextEvent] as InputEvent).change);
      nextEvent += 1;
    }
    cpu.step();
  }

  const frames = framesFrom(strobes);
  return {
    image,
    cycles: cpu.cycles,
    frames,
    speakerEdges,
    strobes,
    gridsStrobed: [...gridsStrobed].sort((left, right) => left - right),
    superimposedStrobes,
    firstLitCycle,
    inputResponses: events.map((event) => respondTo(event, frames, speakerEdges)),
    scoreProgression: scoreProgression(frames),
  };
}

/**
 * Split a strobe stream into complete display sweeps.
 *
 * The boundary rule is `tools/probe/tms1370-probe.ts`'s, for the same reason it
 * gives: grid 8 is reached only in the two high-bank passes, which close the
 * sweep, so the first strobe of grid 0 after a strobe of grid 8 opens the next
 * one. That is a property of `SWEEP_PASSES` rather than of a pass order this
 * function has to know.
 *
 * Only sweeps bounded at both ends are returned. A partial sweep at the start
 * (the ROM's RAM clear runs before the first one) or at the end (the run simply
 * stopped) would compare as a difference between two identical machines, which
 * is the sort of false mismatch contract V11 exists to keep out of the report.
 */
export function framesFrom(strobes: readonly Strobe[]): readonly Frame[] {
  const boundaries: number[] = [];
  let sawLastGrid = false;
  for (let at = 0; at < strobes.length; at += 1) {
    const strobe = strobes[at] as Strobe;
    if (strobe.grid === GRID_COUNT - 1) {
      sawLastGrid = true;
      continue;
    }
    if (sawLastGrid && strobe.grid === 0) {
      boundaries.push(at);
      sawLastGrid = false;
    }
  }

  const frames: Frame[] = [];
  for (let at = 1; at < boundaries.length; at += 1) {
    const first = boundaries[at - 1] as number;
    const last = boundaries[at] as number;
    const litCells = new Set<string>();
    const digitPlates: [number, number] = [0, 0];
    for (let index = first; index < last; index += 1) {
      const strobe = strobes[index] as Strobe;
      for (let plate = 0; plate < PLATE_COUNT; plate += 1) {
        if ((strobe.plates >>> plate) & 1) {
          litCells.add(cellKey(strobe.grid, plate));
        }
      }
      if (strobe.grid === GRID_SCORE_TENS) {
        digitPlates[0] |= strobe.plates;
      }
      if (strobe.grid === GRID_SCORE_UNITS) {
        digitPlates[1] |= strobe.plates;
      }
    }
    frames.push({
      index: frames.length,
      fromCycle: (strobes[first] as Strobe).cycle,
      toCycle: (strobes[last] as Strobe).cycle,
      litCells,
      score: readScore(digitPlates[0], digitPlates[1]),
    });
  }
  return frames;
}

/** Plates 0-6, the seven-segment field of a score digit. */
const DIGIT_PLATE_MASK = (1 << 7) - 1;

/** Plate 7 on a score grid: `score_hundreds` on grid 7, `score_label` on grid 8. */
const SCORE_INDICATOR_PLATE_MASK = 1 << 7;

/** Every digit's plate mask, once, so a decode is a lookup rather than a scan. */
const DIGIT_BY_MASK = new Map<number, number>(
  Array.from({ length: DIGIT_COUNT }, (_unused, digit) => [digitMask(digit), digit]),
);

/**
 * Read the score off the two digit grids.
 *
 * This is a decode of the **glass**, not of either machine's output PLA. The
 * segment-to-plate assignment is `src/machine/tube/atlas.json`'s
 * (`score_tens_sega` at plate 0 through `score_tens_segg` at plate 6) and the
 * ten shapes are the conventional seven-segment ones, so the same decode reads
 * the original's tube as reads ours. Nothing here depends on which slot either
 * table happens to keep a digit in.
 *
 * A pattern that is not one of the ten shapes decodes to `undefined` rather
 * than to a nearest match: on a machine whose ROM is being validated, a
 * half-drawn numeral is a finding and rounding it to a digit would hide it.
 */
export function readScore(tensPlates: number, unitsPlates: number): ScoreReadout {
  const tens = decodeDigit(tensPlates & DIGIT_PLATE_MASK);
  const units = decodeDigit(unitsPlates & DIGIT_PLATE_MASK);
  const hundreds = (tensPlates & SCORE_INDICATOR_PLATE_MASK) !== 0;
  const label = (unitsPlates & SCORE_INDICATOR_PLATE_MASK) !== 0;
  // A blank tens digit is leading-zero suppression and reads as zero; a blank
  // units digit is not a number at all, and neither is an unrecognised shape.
  const value =
    units === undefined || tens === null || units === null
      ? undefined
      : (hundreds ? 100 : 0) + (tens ?? 0) * 10 + units;
  return {
    tens: tens ?? undefined,
    units: units ?? undefined,
    hundreds,
    label,
    value,
    digitPlates: [tensPlates, unitsPlates],
  };
}

/**
 * A digit's plate pattern to its value.
 *
 * Three outcomes, and they are three: `undefined` for a dark digit, `null` for
 * a lit pattern that is not one of the ten shapes, and a number otherwise. A
 * dark digit is the ROM suppressing a leading zero; an unrecognised one is the
 * ROM lighting something a player could not read.
 */
function decodeDigit(plates: number): number | undefined | null {
  if (plates === 0) {
    return undefined;
  }
  const digit = DIGIT_BY_MASK.get(plates);
  return digit === undefined ? null : digit;
}

/** The score values a recording's display passed through, without repeats. */
function scoreProgression(frames: readonly Frame[]): readonly (number | undefined)[] {
  const progression: (number | undefined)[] = [];
  for (const frame of frames) {
    if (progression.length === 0 || progression[progression.length - 1] !== frame.score.value) {
      progression.push(frame.score.value);
    }
  }
  return progression;
}

/**
 * When one injected contact change first showed on the glass and the speaker.
 *
 * Measured from the event to the start of the first sweep whose lit set differs
 * from the sweep that was in progress when the contact closed - not to the
 * first sweep that differs from its own predecessor, which the game's own
 * animation would satisfy on any cycle at all.
 */
function respondTo(
  event: InputEvent,
  frames: readonly Frame[],
  speakerEdges: readonly SpeakerEdge[],
): InputResponse {
  const at = frames.findIndex((frame) => frame.toCycle > event.cycle);
  const baseline = at < 0 ? undefined : frames[at];
  let litResponseCycles: number | undefined;
  if (baseline !== undefined) {
    for (let index = at + 1; index < frames.length; index += 1) {
      const frame = frames[index] as Frame;
      if (!sameCells(baseline.litCells, frame.litCells)) {
        litResponseCycles = frame.fromCycle - event.cycle;
        break;
      }
    }
  }
  const edge = speakerEdges.find((candidate) => candidate.cycle >= event.cycle);
  return {
    event,
    litResponseCycles,
    speakerResponseCycles: edge === undefined ? undefined : edge.cycle - event.cycle,
  };
}

/** Whether two lit-cell sets hold the same cells. */
export function sameCells(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const cell of left) {
    if (!right.has(cell)) {
      return false;
    }
  }
  return true;
}

// --- comparison --------------------------------------------------------------

/** One sweep, compared. */
export interface FrameComparison {
  readonly index: number;
  readonly matched: boolean;
  /** Cells the left recording lit and the right did not. */
  readonly onlyInLeft: readonly string[];
  /** Cells the right recording lit and the left did not. */
  readonly onlyInRight: readonly string[];
  readonly leftScore: number | undefined;
  readonly rightScore: number | undefined;
}

/** The speaker's two edge streams, aligned in cycle order. */
export interface SpeakerComparison {
  readonly leftEdges: number;
  readonly rightEdges: number;
  /** Edges that paired within {@link SPEAKER_EDGE_TOLERANCE_CYCLES}. */
  readonly matchedEdges: number;
  /** Largest cycle difference among the paired edges. */
  readonly worstSkewCycles: number;
  /** Index of the first edge that did not pair, or `undefined`. */
  readonly firstDivergence: number | undefined;
  readonly matched: boolean;
}

/** One injected event's response on both machines. */
export interface InputComparison {
  readonly event: InputEvent;
  readonly leftLitResponseCycles: number | undefined;
  readonly rightLitResponseCycles: number | undefined;
  readonly skewCycles: number | undefined;
  readonly matched: boolean;
}

/** The whole comparison of two recordings. */
export interface Comparison {
  readonly left: Recording;
  readonly right: Recording;
  /** Sweeps compared: the shorter recording's count. */
  readonly framesCompared: number;
  readonly framesMatched: number;
  /** Only the sweeps that differ, in order. */
  readonly frameMismatches: readonly FrameComparison[];
  /** True when both recordings hold the same number of complete sweeps. */
  readonly frameCountsAgree: boolean;
  readonly speaker: SpeakerComparison;
  readonly leftScoreProgression: readonly (number | undefined)[];
  readonly rightScoreProgression: readonly (number | undefined)[];
  readonly scoreProgressionAgrees: boolean;
  readonly inputs: readonly InputComparison[];
  /** False only on a genuine mismatch - what sets the CLI's exit code. */
  readonly matched: boolean;
}

/**
 * Compare two recordings on the surface both machines share.
 *
 * Sweeps are paired by ordinal, not by cycle. Two images reach the same sweep
 * at different cycles as soon as either one spends instructions the other does
 * not - a sound suspends the sweep on this machine - and pairing by cycle would
 * report every sweep after the first sound as a mismatch when the glass is
 * identical. The cycle a sweep started on is still reported, so a drift in
 * *when* the sweeps happen is visible rather than absorbed.
 */
export function compare(left: Recording, right: Recording): Comparison {
  const framesCompared = Math.min(left.frames.length, right.frames.length);
  const frameMismatches: FrameComparison[] = [];
  let framesMatched = 0;
  for (let index = 0; index < framesCompared; index += 1) {
    const leftFrame = left.frames[index] as Frame;
    const rightFrame = right.frames[index] as Frame;
    const onlyInLeft = [...leftFrame.litCells].filter((cell) => !rightFrame.litCells.has(cell));
    const onlyInRight = [...rightFrame.litCells].filter((cell) => !leftFrame.litCells.has(cell));
    const scoresAgree = leftFrame.score.value === rightFrame.score.value;
    const matched = onlyInLeft.length === 0 && onlyInRight.length === 0 && scoresAgree;
    if (matched) {
      framesMatched += 1;
      continue;
    }
    frameMismatches.push({
      index,
      matched: false,
      onlyInLeft: onlyInLeft.sort(),
      onlyInRight: onlyInRight.sort(),
      leftScore: leftFrame.score.value,
      rightScore: rightFrame.score.value,
    });
  }

  const speaker = compareSpeaker(left.speakerEdges, right.speakerEdges);
  const scoreProgressionAgrees =
    left.scoreProgression.length === right.scoreProgression.length &&
    left.scoreProgression.every((value, at) => value === right.scoreProgression[at]);
  const inputs = compareInputs(left.inputResponses, right.inputResponses);
  const frameCountsAgree = left.frames.length === right.frames.length;

  return {
    left,
    right,
    framesCompared,
    framesMatched,
    frameMismatches,
    frameCountsAgree,
    speaker,
    leftScoreProgression: left.scoreProgression,
    rightScoreProgression: right.scoreProgression,
    scoreProgressionAgrees,
    inputs,
    matched:
      frameMismatches.length === 0 &&
      frameCountsAgree &&
      speaker.matched &&
      scoreProgressionAgrees &&
      inputs.every((input) => input.matched),
  };
}

/**
 * Pair two speaker-edge streams in order, within the tolerance.
 *
 * Edge *n* of one stream is compared with edge *n* of the other: a stream that
 * is missing an edge diverges from that point on, which is the honest report -
 * an inserted or dropped transition inverts every level that follows it, and a
 * resynchronising matcher would describe an inverted waveform as a small skew.
 */
function compareSpeaker(
  left: readonly SpeakerEdge[],
  right: readonly SpeakerEdge[],
): SpeakerComparison {
  const pairs = Math.min(left.length, right.length);
  let matchedEdges = 0;
  let worstSkewCycles = 0;
  let firstDivergence: number | undefined;
  for (let index = 0; index < pairs; index += 1) {
    const leftEdge = left[index] as SpeakerEdge;
    const rightEdge = right[index] as SpeakerEdge;
    const skew = Math.abs(leftEdge.cycle - rightEdge.cycle);
    if (leftEdge.level !== rightEdge.level || skew > SPEAKER_EDGE_TOLERANCE_CYCLES) {
      firstDivergence ??= index;
      continue;
    }
    matchedEdges += 1;
    worstSkewCycles = Math.max(worstSkewCycles, skew);
  }
  return {
    leftEdges: left.length,
    rightEdges: right.length,
    matchedEdges,
    worstSkewCycles,
    firstDivergence,
    matched: firstDivergence === undefined && left.length === right.length,
  };
}

/** Pair the two machines' responses to the same injected events. */
function compareInputs(
  left: readonly InputResponse[],
  right: readonly InputResponse[],
): readonly InputComparison[] {
  const pairs = Math.min(left.length, right.length);
  const comparisons: InputComparison[] = [];
  for (let index = 0; index < pairs; index += 1) {
    const leftResponse = left[index] as InputResponse;
    const rightResponse = right[index] as InputResponse;
    const both =
      leftResponse.litResponseCycles !== undefined &&
      rightResponse.litResponseCycles !== undefined;
    const skewCycles = both
      ? Math.abs(
          (leftResponse.litResponseCycles as number) -
            (rightResponse.litResponseCycles as number),
        )
      : undefined;
    comparisons.push({
      event: leftResponse.event,
      leftLitResponseCycles: leftResponse.litResponseCycles,
      rightLitResponseCycles: rightResponse.litResponseCycles,
      skewCycles,
      matched:
        leftResponse.litResponseCycles === rightResponse.litResponseCycles ||
        (skewCycles !== undefined && skewCycles <= INPUT_RESPONSE_TOLERANCE_CYCLES),
    });
  }
  return comparisons;
}

/**
 * A cycle count as a duration, in milliseconds, as a range.
 *
 * The single place in this harness where cycles become seconds, and it returns
 * two numbers because there is only an answer to within MAME's stated
 * +/-50 kHz on the oscillator (`src/machine/cpu/tms1370/timing.ts`). Quoting a
 * midpoint would be asserting a rate this project is explicitly not entitled to
 * - contract V10 requires that midpoint appear nowhere as a threshold.
 */
export function cyclesToMillisecondRange(cycles: number): readonly [number, number] {
  return [(cycles / CYCLE_HZ_MAX) * 1000, (cycles / CYCLE_HZ_MIN) * 1000];
}

// --- the two modes -----------------------------------------------------------

/** What one comparison run was asked to do, whichever mode it is in. */
export interface HarnessOptions extends RecordOptions {
  /**
   * The comparison target. Absent - the ordinary case, since no romset has been
   * obtained - runs {@link Mode.selfConsistency} against our own image.
   */
  readonly against?: MachineImage;
}

/** Which of the two modes a run took. */
export const Mode = Object.freeze({
  /**
   * No romset present: record our image, report its surface, and compare a
   * second recording of the same image against the first.
   *
   * The second recording is not ceremony. It is what makes the mode able to
   * fail: it drives the whole comparison path - sweep splitting, cell
   * differencing, edge pairing, score progression - so a report that says
   * "matched" is a report from a comparator that ran, and any state leaking
   * between two runs of the same image shows up here rather than as a mystery
   * in a later comparison against the original.
   */
  selfConsistency: 'self-consistency',
  /** A romset is present: our image against theirs, interpreted through theirs. */
  original: 'against-original',
} as const);

export type ModeName = (typeof Mode)[keyof typeof Mode];

/** One run of the harness, in whichever mode the arguments put it. */
export interface HarnessResult {
  readonly mode: ModeName;
  readonly comparison: Comparison;
}

/**
 * Run the harness.
 *
 * With no `against` image this is the primary path and the one contract V11 is
 * driven on. It is not a degraded fallback: the romset is absent, this project
 * has never held it, and a harness that could not report our own machine's
 * surface without it would be unusable for the work it exists to support.
 */
export function runHarness(options: HarnessOptions = {}): HarnessResult {
  const ours = ourMachineImage();
  const left = record(ours, options);
  if (options.against === undefined) {
    return {
      mode: Mode.selfConsistency,
      comparison: compare(left, record(ours, options)),
    };
  }
  return {
    mode: Mode.original,
    comparison: compare(left, record(options.against, options)),
  };
}
