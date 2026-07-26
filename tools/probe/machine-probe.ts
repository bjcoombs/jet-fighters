// The machine probe: drive the emulated board from a terminal and report what
// the hardware did.
//
//     npx vite-node tools/probe/machine-probe.ts --cycles 400000
//     npx vite-node tools/probe/machine-probe.ts --cycles 400000 --input lever=up@200000
//     npx vite-node tools/probe/machine-probe.ts --cycles 400000 --input fire@200000 --emit-edges
//
// ## Why this exists
//
// The acceptance contract (docs/contract/v2.contract.md) drives criteria V3, V4
// and V5 through this file. Those criteria have to be checkable by an agent with
// no browser and no human, and the v2 machine layer - CPU, board, display,
// speaker - is pure TypeScript with no DOM dependency precisely so that is
// possible. This is the drive surface that turns that property into something
// runnable.
//
// It is not a test harness with a JSON coat on. Everything it reports is read
// off the board's own observation surface: `getStrobedGrids()` for the sweep,
// `getLitSegments()` for per-segment PWM duty, `takeSpeakerEdges()` for the D14
// transition stream. There is no path from here into game state, and there is
// deliberately none: inputs go in through `setControl`, which moves a case
// control and lets the ROM find out on its next strobe, exactly as a player's
// hand does. A probe that poked RAM to move the launcher would prove nothing
// about the ROM.
//
// ## The report
//
// One JSON object on stdout, with six keys and no others:
//
// | key            | what it is                                              |
// |----------------|---------------------------------------------------------|
// | `romWords`     | assembled words in the 2048-word program region          |
// | `ramNibbles`   | the assembler's static RAM high-water mark               |
// | `strobeCycles` | machine cycles actually executed                         |
// | `gridsStrobed` | distinct D0-D9 grids the ROM drove, ascending            |
// | `snapshots`    | the baseline, then one per `--input`, in event order     |
// | `speakerEdges` | `[cycle, level]` pairs; filled only with `--emit-edges`  |
//
// `speakerEdges` is always present and is an empty array when the flag is
// absent, so the object's shape does not change with the command line - a
// consumer parses one schema, not two.
//
// Node-side tool: no DOM, no browser globals, no runtime dependencies.

import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
// The whole `process` object, not `import { argv }` - see tools/hmasm/cli.ts for
// why vite-node makes the named export the wrong one to hold.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assemble, AsmError, type AssemblyResult } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { ROM_PROGRAM_SIZE } from '../../src/machine/cpu/memory.js';

/** Exit codes, matching hmasm's so a gate can treat the tools alike. */
export const EXIT = Object.freeze({
  ok: 0,
  sourceRejected: 1,
  usage: 2,
});

/** Machine cycles the probe runs when `--cycles` is not given. */
export const DEFAULT_CYCLES = 400_000;

/**
 * Display frames to complete before the baseline snapshot.
 *
 * The contract requires the baseline to be taken "once the machine has completed
 * at least one full display sweep". Two, not one: the first frame period runs
 * from power-on and therefore includes the ROM's reset and RAM-clear code, so
 * its duties are measured against a longer denominator than a steady frame's.
 * The second is a sweep and nothing else.
 */
export const BASELINE_FRAMES = 2;

/**
 * Display frames to complete after injecting an input, before snapshotting.
 *
 * Three, because moving a control does not move anything on the tube by itself.
 * The ROM has to strobe the line the contact sits on, decode it after that sweep
 * finishes, redraw the plate table, and then display the new table on the sweep
 * after that. An input injected mid-sweep may have missed its own line already,
 * so: one frame to reach a boundary, one to sample, one to display.
 */
export const SETTLE_FRAMES = 3;

/** The ROM the probe runs unless `--rom` names another source. */
export const DEFAULT_ROM_SOURCE = 'asm/jetfighter.asm';

/** A wrong command line, or a file that could not be read. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** One `--input name=value@cycle` event. */
export interface InputEvent {
  /** Control to move: `fire`, `lever` or `skill`. */
  readonly control: string;
  /** Position, or undefined for a bare `fire@N`, which presses the button. */
  readonly value?: string;
  /** Machine cycle at which to move it. */
  readonly cycle: number;
  /** The spec exactly as written, so a diagnostic can quote it. */
  readonly spec: string;
}

/** What one invocation was asked to do. */
export interface ProbeOptions {
  /** Machine cycles to run. */
  readonly cycles: number;
  /** Inputs to inject, in the order given on the command line. */
  readonly inputs: readonly InputEvent[];
  /** Fill `speakerEdges` in the report. */
  readonly emitEdges: boolean;
  /** Assembly source to run. */
  readonly romSource: string;
  /** Print usage and stop. */
  readonly help: boolean;
}

/** One segment the tube lit, as the report writes it. */
export type SegmentTriple = readonly [grid: number, plate: number, duty: number];

/** One D14 transition, as the report writes it. */
export type EdgePair = readonly [cycle: number, level: number];

/** The tube over one completed frame period. */
export interface Snapshot {
  /** Machine cycle the snapshot was taken at. */
  readonly atCycle: number;
  /** Every segment with a non-zero duty, ordered by grid then plate. */
  readonly litSegments: readonly SegmentTriple[];
}

/** The whole report - the object written to stdout. */
export interface ProbeReport {
  readonly romWords: number;
  readonly ramNibbles: number;
  readonly strobeCycles: number;
  readonly gridsStrobed: readonly number[];
  readonly snapshots: readonly Snapshot[];
  readonly speakerEdges: readonly EdgePair[];
}

/** Streams the probe writes to. Injected so a test never writes to a terminal. */
export interface ProbeStreams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE = `machine-probe - drive the emulated Jet Fighters board headlessly

Usage:
  vite-node tools/probe/machine-probe.ts [options]

Options:
  --cycles <n>       machine cycles to run (default ${DEFAULT_CYCLES})
  --input <spec>     inject a control, repeatable. spec is name=value@cycle,
                     e.g. lever=up@200000, skill=2@0, or fire@200000 for a
                     bare press. Injected through the strobe matrix, never
                     into game state
  --emit-edges       include the D14 transition stream in the report
  --rom <path>       assembly source to run (default ${DEFAULT_ROM_SOURCE})
  --help, -h         print this text

Writes one JSON object to stdout: romWords, ramNibbles, strobeCycles,
gridsStrobed, snapshots, speakerEdges.

Exit codes: 0 ran, 1 the ROM was rejected, 2 bad command line or file error.
`;

/** Repo root, so the default ROM path does not depend on the shell's cwd. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Parse one `--input` spec.
 *
 * `name=value@cycle`, or `name@cycle` for a control whose default value is the
 * useful one (`fire@200000` presses the button). The cycle is split off at the
 * last `@` so a value containing one would still parse.
 *
 * @throws UsageError with the offending spec quoted.
 */
export function parseInputSpec(spec: string): InputEvent {
  const at = spec.lastIndexOf('@');
  if (at < 0) {
    throw new UsageError(`--input '${spec}' has no @cycle - expected name=value@cycle`);
  }

  const control = spec.slice(0, at);
  const cycleText = spec.slice(at + 1);
  if (control === '') {
    throw new UsageError(`--input '${spec}' names no control`);
  }

  const cycle = Number(cycleText);
  if (!/^\d+$/.test(cycleText) || !Number.isSafeInteger(cycle)) {
    throw new UsageError(
      `--input '${spec}' has a bad cycle '${cycleText}' - expected a whole number of machine cycles`,
    );
  }

  const equals = control.indexOf('=');
  if (equals < 0) {
    return { control, cycle, spec };
  }
  return {
    control: control.slice(0, equals),
    value: control.slice(equals + 1),
    cycle,
    spec,
  };
}

/** The flags that take a value. */
const VALUE_FLAGS = new Set(['--cycles', '--input', '--rom']);

/**
 * Parse `argv` after the interpreter and the script.
 *
 * `--flag value` and `--flag=value` are both accepted, because both are what
 * people type. `--input` may be repeated; every other flag takes its last value.
 *
 * @throws UsageError on an unknown flag, a flag missing its value, a
 *   non-positive cycle count, or any positional argument.
 */
export function parseArguments(args: readonly string[]): ProbeOptions {
  const inputs: InputEvent[] = [];
  let cycles = DEFAULT_CYCLES;
  let emitEdges = false;
  let romSource = resolve(repoRoot(), DEFAULT_ROM_SOURCE);
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;

    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--emit-edges') {
      emitEdges = true;
      continue;
    }

    const equals = argument.indexOf('=');
    const named = argument.startsWith('--') && equals > 0;
    const name = named ? argument.slice(0, equals) : argument;
    const inlineValue = named ? argument.slice(equals + 1) : undefined;

    if (!VALUE_FLAGS.has(name)) {
      throw new UsageError(
        argument.startsWith('-')
          ? `unknown option '${argument}'`
          : `unexpected argument '${argument}' - the probe takes options only`,
      );
    }

    const value = inlineValue ?? args[index + 1];
    if (value === undefined) {
      throw new UsageError(`${name} needs a value`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }

    switch (name) {
      case '--cycles': {
        const parsed = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new UsageError(`--cycles '${value}' is not a positive whole number of cycles`);
        }
        cycles = parsed;
        break;
      }
      case '--input':
        inputs.push(parseInputSpec(value));
        break;
      default:
        romSource = resolve(value);
        break;
    }
  }

  return { cycles, inputs, emitEdges, romSource, help };
}

/** Assembled words that land in the program region - what the listing counts. */
export function programWordCount(result: AssemblyResult): number {
  return result.words.filter((word) => word.address < ROM_PROGRAM_SIZE).length;
}

/** Assemble the ROM the probe is to run. */
export function assembleRom(path: string): AssemblyResult {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new UsageError(`cannot read ${path}: ${reason}`);
  }
  return assemble(source, path, {
    readInclude: (included, fromFile) => {
      const resolved = resolve(dirname(fromFile), included);
      return { file: resolved, source: readFileSync(resolved, 'utf8') };
    },
  });
}

/** Read the tube's most recently completed frame as report triples. */
function takeSnapshot(board: Board): Snapshot {
  return {
    atCycle: board.cycles,
    litSegments: board
      .getLitSegments()
      .map((segment) => [segment.grid, segment.plate, segment.duty] as const),
  };
}

/**
 * Run `frames` further display sweeps.
 *
 * The budget is generous rather than tight: it exists so a ROM that stops
 * sweeping ends the probe instead of hanging it, not to bound normal execution.
 * A sweep of this ROM is a few thousand cycles, so 100k per frame is two orders
 * of magnitude of headroom.
 */
function advanceFrames(board: Board, frames: number): void {
  board.runFrames(frames);
}

/**
 * Run the machine and collect the report.
 *
 * The sequence is fixed by the contract: baseline first, taken after a full
 * sweep and before anything has been touched; then one snapshot per input, each
 * taken after that input has been strobed in. So no input yields exactly one
 * snapshot and one input yields two, whatever else the ROM is doing.
 *
 * Events are applied in ascending cycle order regardless of the order they were
 * written on the command line, because "at cycle N" is a statement about the
 * machine and not about the argument list.
 */
export function runProbe(options: ProbeOptions): ProbeReport {
  const assembly = assembleRom(options.romSource);
  const board = new Board(romImage(assembly));

  advanceFrames(board, BASELINE_FRAMES);
  const snapshots: Snapshot[] = [takeSnapshot(board)];

  const events = [...options.inputs].sort((left, right) => left.cycle - right.cycle);
  for (const event of events) {
    if (board.cycles < event.cycle) {
      board.step(event.cycle - board.cycles);
    }
    try {
      board.setControl(event.control, event.value);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new UsageError(`--input '${event.spec}': ${reason}`);
    }
    advanceFrames(board, SETTLE_FRAMES);
    snapshots.push(takeSnapshot(board));
  }

  if (board.cycles < options.cycles) {
    board.step(options.cycles - board.cycles);
  }

  // Drained once, at the end: the buffer is never emptied by anything else, so
  // this is the complete transition stream for the whole run.
  const edges = board.takeSpeakerEdges();

  return {
    romWords: programWordCount(assembly),
    ramNibbles: assembly.ramHighWater,
    strobeCycles: board.cycles,
    gridsStrobed: board.getStrobedGrids(),
    snapshots,
    speakerEdges: options.emitEdges
      ? edges.map((edge) => [edge.cycle, edge.level] as const)
      : [],
  };
}

/**
 * The report as it is written to stdout: one line, one object.
 *
 * Compact rather than indented, so "a single JSON object on stdout" is literally
 * true and a caller can read one line and parse it.
 */
export function formatReport(report: ProbeReport): string {
  return `${JSON.stringify(report)}\n`;
}

/**
 * Run one invocation.
 *
 * Returns an exit code rather than calling `exit`, so the whole probe is
 * testable and so the single place that ends the process is the entry guard.
 */
export function runCli(args: readonly string[], streams: ProbeStreams): number {
  let options: ProbeOptions;
  try {
    options = parseArguments(args);
  } catch (error) {
    streams.err(`machine-probe: ${(error as Error).message}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (options.help) {
    streams.out(USAGE);
    return EXIT.ok;
  }

  let report: ProbeReport;
  try {
    report = runProbe(options);
  } catch (error) {
    if (error instanceof AsmError) {
      streams.err(`machine-probe: ${error.message}\n`);
      return EXIT.sourceRejected;
    }
    if (error instanceof UsageError) {
      streams.err(`machine-probe: ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }

  streams.out(formatReport(report));
  return EXIT.ok;
}

/** True when this module is the program being run - see tools/hmasm/cli.ts. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return (
      resolve(entry) === fileURLToPath(import.meta.url) || basename(entry).startsWith('vite-node')
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exit(
    runCli(process.argv.slice(2), {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    }),
  );
}
