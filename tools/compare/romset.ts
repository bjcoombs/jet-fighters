// Loading the original artifacts, when there are any.
//
// Paths in this file are relative to the repository root.
//
// ## Nothing here is present in this repository
//
// This project has obtained **none** of the four romset artifacts. No ROM
// content from the original is committed here, no decode of one is recorded
// here, and nothing in this module has ever been run against a real file. It is
// a reader for artifacts that arrive from outside, and it is written so that
// the day one does arrive there is nothing to invent.
//
// `docs/prd/jet-fighters-v3.md` R7 is why it exists at all: a program dump on
// its own "cannot say what lights", because the eight O lines are the output of
// a 32-entry PLA the dump does not contain. So a comparison target is two
// files - the program image and the output PLA that interprets its `TDO`
// indices - and both are loaded here.
//
// Loading Gakken's table to interpret Gakken's dump is not the same act as
// reproducing it in our ROM. The second is an explicit non-goal of the PRD and
// of `src/machine/board/o-pla.ts`; the first is in scope and is what this file
// does. `docs/research/comparison-surface.md` separates the two at length.
//
// ## What is assumed, and marked as assumed
//
// The output PLA ships as a text file in Berkeley/espresso form. Two things
// about reading one cannot be settled from this side: which end of the input
// plane carries the status latch and which end of the output plane carries O7.
// Both are exposed as options, both default to MSB-first, and
// {@link describeAssumptions} states them in the report rather than leaving a
// reader to assume they were verified. They were not. Guessing silently is the
// failure mode this module is shaped to avoid.
//
// Node-side tool: no DOM, no timers, no Web APIs, no runtime dependencies.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  O_INDEX_BITS,
  O_LINE_COUNT,
  O_PLA_ENTRY_COUNT,
} from '../../src/machine/cpu/tms1370/opla.js';
import { ROM_WORD_COUNT } from '../../src/machine/cpu/tms1370/registers.js';
import type { MachineImage } from './harness.js';

/**
 * The four artifacts, by the file name each carries in a MAME romset.
 *
 * Named here so the harness reports "mp2110 is absent" rather than "a file is
 * absent", and so the two this module actually needs are visibly a subset of
 * the four the project as a whole is blocked on.
 */
export const ARTIFACTS = Object.freeze({
  /** The MP2110 mask ROM dump: 2048 eight-bit words. Gates R7. */
  machineImage: 'mp2110',
  /** Gakken's O output PLA. Without it a dump says nothing about plates. */
  outputPla: 'tms1100_ginv_output.pla',
  /** The microinstruction PLA. Gates R0, and through it R1, R2 and R5. */
  microPla: 'tms1100_common2_micro.pla',
  /** The artwork the segment addressing is read off. Gates R4. */
  artwork: 'ginv.svg',
});

/** The two artifacts a comparison target is made of. */
export const COMPARISON_ARTIFACTS: readonly string[] = Object.freeze([
  ARTIFACTS.machineImage,
  ARTIFACTS.outputPla,
]);

/** Which end of a PLA plane carries the most significant bit. */
export type BitOrder = 'msb-first' | 'lsb-first';

/**
 * How a Berkeley-form PLA's two planes are read.
 *
 * Defaults are stated, not verified. See the module header: this project has
 * never held the file, so the defaults are the conventional reading of the
 * format and nothing stronger.
 */
export interface PlaOptions {
  /** Leftmost input column: `msb-first` makes it the status latch's bit. */
  readonly inputOrder?: BitOrder;
  /** Leftmost output column: `msb-first` makes it O7. */
  readonly outputOrder?: BitOrder;
}

/** What a romset directory turned out to hold. */
export interface RomsetInspection {
  /** The directory that was looked in. */
  readonly directory: string;
  /** Artifact file names found there. */
  readonly present: readonly string[];
  /** Artifact file names not found there. */
  readonly absent: readonly string[];
  /** True when both {@link COMPARISON_ARTIFACTS} are present. */
  readonly comparable: boolean;
}

/** A missing artifact, a malformed one, or a directory that is not there. */
export class RomsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RomsetError';
  }
}

/** The file system calls this module makes. Injected so a test needs no fixtures. */
export interface RomsetFs {
  readonly exists: (path: string) => boolean;
  readonly readBytes: (path: string) => Uint8Array;
  readonly readText: (path: string) => string;
}

/** The real file system. */
export const nodeFs: RomsetFs = {
  exists: (path) => {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
  readBytes: (path) => new Uint8Array(readFileSync(path)),
  readText: (path) => readFileSync(path, 'utf8'),
};

/**
 * Look in a directory and say which of the four artifacts are there.
 *
 * A directory that does not exist is reported as one holding none of them, not
 * as an error. The whole point of contract V11's no-romset path is that the
 * ordinary case - nothing there - is a report rather than a failure, and a
 * caller that has to catch an exception to discover the ordinary case will
 * eventually let it escape as a non-zero exit.
 */
export function inspectRomset(directory: string, fs: RomsetFs = nodeFs): RomsetInspection {
  const names = Object.values(ARTIFACTS);
  const present = names.filter((name) => fs.exists(join(directory, name)));
  const absent = names.filter((name) => !present.includes(name));
  return {
    directory,
    present,
    absent,
    comparable: COMPARISON_ARTIFACTS.every((name) => present.includes(name)),
  };
}

/**
 * Load a comparison target from a romset directory.
 *
 * Throws only when a caller has *asked* for a target and it cannot be built -
 * an absent romset is discovered with {@link inspectRomset} and reported, never
 * thrown at. The message names the artifact so a reader knows which of the four
 * to go and find.
 */
export function loadComparisonTarget(
  directory: string,
  options: PlaOptions = {},
  fs: RomsetFs = nodeFs,
): MachineImage {
  const inspection = inspectRomset(directory, fs);
  for (const name of COMPARISON_ARTIFACTS) {
    if (!inspection.present.includes(name)) {
      throw new RomsetError(
        `${name} is not in ${directory}. A comparison target needs both ` +
          `${COMPARISON_ARTIFACTS.join(' and ')}: a program image alone cannot say ` +
          `what lights, because the O lines come out of a PLA the dump does not hold.`,
      );
    }
  }
  const romPath = join(directory, ARTIFACTS.machineImage);
  const plaPath = join(directory, ARTIFACTS.outputPla);
  const rom = fs.readBytes(romPath);
  if (rom.length > ROM_WORD_COUNT) {
    throw new RomsetError(
      `${romPath} holds ${rom.length} bytes, more than the ${ROM_WORD_COUNT} ` +
        `words a TMS1370 addresses`,
    );
  }
  return {
    name: ARTIFACTS.machineImage,
    rom,
    opla: loadOutputPla(plaPath, options, fs),
    provenance:
      `${romPath} (${rom.length} words) interpreted through ${plaPath}; ` +
      `${describeAssumptions(options)}`,
  };
}

/**
 * Read an output PLA, in either of the two forms one arrives in.
 *
 * A MAME romset carries it as Berkeley/espresso text. A caller who has already
 * converted one, or who is supplying a table of their own, can hand over a raw
 * image of at most 32 bytes instead - which is also the form
 * `tools/tmsasm/cli.ts --opla` writes, so our own table can be fed in as a
 * comparison target without a conversion step.
 */
export function loadOutputPla(
  path: string,
  options: PlaOptions = {},
  fs: RomsetFs = nodeFs,
): Uint8Array {
  const bytes = fs.readBytes(path);
  if (looksLikePlaText(bytes)) {
    return parsePla(fs.readText(path), options);
  }
  if (bytes.length > O_PLA_ENTRY_COUNT) {
    throw new RomsetError(
      `${path} is neither a Berkeley-form PLA nor a table of at most ` +
        `${O_PLA_ENTRY_COUNT} masks: it holds ${bytes.length} bytes`,
    );
  }
  const table = new Uint8Array(O_PLA_ENTRY_COUNT);
  table.set(bytes);
  return table;
}

/**
 * Whether a file is Berkeley-form PLA text rather than a raw table.
 *
 * Sniffed on the `.i`/`.o`/`.p` keywords the format opens with, over the first
 * kilobyte only. A raw 32-byte table cannot contain them and a PLA text file
 * always does, so the two forms are told apart by content rather than by
 * extension - the extension on a romset file is not ours to rely on.
 */
function looksLikePlaText(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf8', { fatal: false }).decode(bytes.subarray(0, 1024));
  return /^\s*(#|\.[iop]\b)/m.test(head);
}

/**
 * Parse a Berkeley/espresso PLA into 32 eight-bit masks.
 *
 * Sum of products, which is what the form means: each term is an input pattern
 * over `0`, `1` and `-`, and every index the pattern covers gets that term's
 * asserted output bits OR-ed in. A `-` in the output plane asserts nothing.
 *
 * The two bit orderings are {@link PlaOptions}'s and are **assumptions**. The
 * `.p` term count is checked against the terms actually read, because a file
 * truncated in transit is otherwise a table that parses and is wrong - and a
 * wrong table would be reported as a difference in the original's *display*,
 * which is exactly the false finding this harness exists to not produce.
 */
export function parsePla(text: string, options: PlaOptions = {}): Uint8Array {
  const inputOrder = options.inputOrder ?? 'msb-first';
  const outputOrder = options.outputOrder ?? 'msb-first';
  let inputs: number | undefined;
  let outputs: number | undefined;
  let declaredTerms: number | undefined;
  const terms: { pattern: string; asserted: string }[] = [];

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '' || line === '.e' || line === '.end') {
      continue;
    }
    if (line.startsWith('.')) {
      const [keyword, value] = line.split(/\s+/, 2);
      if (keyword === '.i') {
        inputs = Number(value);
      } else if (keyword === '.o') {
        outputs = Number(value);
      } else if (keyword === '.p') {
        declaredTerms = Number(value);
      }
      // `.type`, `.ilb`, `.ob` and the rest carry no information this reader
      // needs and are skipped rather than rejected: a romset file may carry
      // keywords MAME's own tools emit and refusing them would make a valid
      // artifact unreadable.
      continue;
    }
    const fields = line.split(/\s+/);
    if (fields.length < 2) {
      throw new RomsetError(`PLA term '${line}' has no output field`);
    }
    terms.push({ pattern: fields[0] as string, asserted: fields[1] as string });
  }

  if (inputs === undefined || outputs === undefined) {
    throw new RomsetError('PLA declares no .i and .o header; this is not a Berkeley-form PLA');
  }
  if (inputs !== O_INDEX_BITS) {
    throw new RomsetError(
      `PLA declares ${inputs} inputs; a TMS1370 output PLA is indexed by ` +
        `${O_INDEX_BITS} bits (status latch and accumulator)`,
    );
  }
  if (outputs !== O_LINE_COUNT) {
    throw new RomsetError(
      `PLA declares ${outputs} outputs; a TMS1370 drives ${O_LINE_COUNT} O lines`,
    );
  }
  if (declaredTerms !== undefined && declaredTerms !== terms.length) {
    throw new RomsetError(
      `PLA declares ${declaredTerms} terms and holds ${terms.length}; ` +
        `a truncated table would parse and be wrong`,
    );
  }

  const table = new Uint8Array(O_PLA_ENTRY_COUNT);
  for (const term of terms) {
    if (term.pattern.length !== inputs || term.asserted.length !== outputs) {
      throw new RomsetError(
        `PLA term '${term.pattern} ${term.asserted}' is not ${inputs} inputs ` +
          `and ${outputs} outputs wide`,
      );
    }
    const mask = maskOf(term.asserted, outputOrder);
    for (let index = 0; index < O_PLA_ENTRY_COUNT; index += 1) {
      if (covers(term.pattern, index, inputOrder)) {
        table[index] = (table[index] as number) | mask;
      }
    }
  }
  return table;
}

/** Whether an input pattern covers one index, under the assumed ordering. */
function covers(pattern: string, index: number, order: BitOrder): boolean {
  for (let column = 0; column < pattern.length; column += 1) {
    const character = pattern[column];
    if (character === '-' || character === '~') {
      continue;
    }
    const bit = order === 'msb-first' ? pattern.length - 1 - column : column;
    const wanted = character === '1' ? 1 : 0;
    if (((index >>> bit) & 1) !== wanted) {
      return false;
    }
  }
  return true;
}

/** An output plane field as an eight-bit mask, under the assumed ordering. */
function maskOf(asserted: string, order: BitOrder): number {
  let mask = 0;
  for (let column = 0; column < asserted.length; column += 1) {
    if (asserted[column] !== '1') {
      continue;
    }
    const bit = order === 'msb-first' ? asserted.length - 1 - column : column;
    mask |= 1 << bit;
  }
  return mask;
}

/**
 * The bit-ordering assumptions in a form a report can print.
 *
 * Printed on every run that loads a PLA, and worded so it cannot be read as a
 * verified fact. If the original's display comes out garbled, this line is the
 * first thing to try reversing - which is the practical reason it is in the
 * report rather than in a comment here.
 */
export function describeAssumptions(options: PlaOptions = {}): string {
  const inputOrder = options.inputOrder ?? 'msb-first';
  const outputOrder = options.outputOrder ?? 'msb-first';
  return (
    `PLA plane ordering ASSUMED (input ${inputOrder}, output ${outputOrder}) - ` +
    `unverified, this project has decoded no original artifact`
  );
}
