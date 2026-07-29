// The comparison harness's command line (PRD R7, contract V11).
//
// Paths in this file are relative to the repository root.
//
//     npm run compare
//     npm run compare -- --original path/to/romset
//
// ## The first of those two is the primary invocation
//
// Contract V11: "A harness that cannot run without the romset fails, because
// that makes it unusable for the work it exists to support." This project has
// obtained none of the four romset artifacts and none is arriving on this run,
// so `npm run compare` with no arguments has to be a complete, useful,
// zero-exit run - not a degraded fallback that warns about what is missing and
// gives up.
//
// **The absence of a romset is never an error here.** It sets no exit code, it
// is not printed on stderr, and it is not a warning. It is a line in the report
// saying which artifacts were looked for and that none were found.
//
// ## Exit codes
//
// | code | meaning                                                          |
// |------|------------------------------------------------------------------|
// | 0    | the harness ran and the comparison surface matched               |
// | 1    | a genuine mismatch between the two recordings                    |
// | 2    | the command line was wrong, or a named file could not be read    |
//
// Only 1 means "the machines differ". A romset that is absent, partial, or in a
// directory that does not exist yields 0 with a report saying so - the harness
// has still reported our machine's surface, which is the work it exists to do
// today.
//
// Node-side tool: no DOM, no timers, no Web APIs, no runtime dependencies.

import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
// The whole `process` object, not `import { argv }`: vite-node reassigns
// `process.argv` after stripping the script path, and the named exports of
// node:process are bound once. `tools/tmsasm/cli.ts` records the same trap.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SWEEPS,
  runHarness,
  type InputEvent,
  type MachineImage,
} from './harness.js';
import { formatReport, reportJson } from './report.js';
import {
  RomsetError,
  inspectRomset,
  loadComparisonTarget,
  nodeFs,
  type BitOrder,
  type PlaOptions,
  type RomsetInspection,
} from './romset.js';
import { SWEEP_INSTRUCTIONS } from '../../src/machine/board/tms1370-cadence.js';

/** Exit codes, named so the table in the header has one implementation. */
export const EXIT = Object.freeze({
  ok: 0,
  mismatch: 1,
  usage: 2,
});

/** A wrong command line, or a file that could not be read or written. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** What one invocation was asked to do. */
export interface CliOptions {
  /** Where to look for the original artifacts, if anywhere. */
  readonly original?: string;
  /** Instruction cycles to run. */
  readonly cycles: number;
  /** Contact changes to inject. */
  readonly input: readonly InputEvent[];
  /** Emit the report as JSON rather than as text. */
  readonly json: boolean;
  /** Write the report here as well as to stdout. */
  readonly out?: string;
  /** How to read the supplied output PLA's two planes. */
  readonly pla: PlaOptions;
  /** Print usage and stop. */
  readonly help: boolean;
}

/** Streams the CLI writes to. Injected so a test never writes to a terminal. */
export interface CliStreams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE = `compare - the Jet Fighters comparison harness

Usage:
  npm run compare                              our machine image, no romset
  npm run compare -- --original <dir>          against an original dump

Options:
  --original <dir>       directory holding mp2110 and tms1100_ginv_output.pla.
                         Absent, or holding neither, is not an error: the
                         harness reports our own machine's surface and exits 0.
  --sweeps <n>           display sweeps to run (default ${DEFAULT_SWEEPS})
  --cycles <n>           instruction cycles to run, instead of --sweeps
  --input <spec>         name=value@cycle, repeatable: lever=up@120000,
                         skill=2@1000, fire@120000
  --pla-input-order <o>  msb-first (default) or lsb-first
  --pla-output-order <o> msb-first (default) or lsb-first
  --json                 write the report as JSON
  --out <path>           write the report to a file as well as to stdout
  --help, -h             print this text

Exit codes: 0 ran and matched, 1 a genuine mismatch, 2 bad command line or
file error. An absent romset is none of those three - it exits 0.
`;

/** The lever's three detents, as `--input lever=<name>` spells them. */
const LEVER_LANES = Object.freeze({ up: 0, centre: 1, center: 1, down: 2 });

/**
 * Parse one `--input` spec: `name=value@cycle`, or `fire@cycle`.
 *
 * The same shape `tools/probe/machine-probe.ts` takes, so a schedule written
 * for one drive works in the other. A control reaches the game by closing a
 * contact on the K matrix and never by poking game state, which is what makes
 * an input schedule a property of the run rather than of the program.
 */
export function parseInputSpec(spec: string): InputEvent {
  const at = spec.lastIndexOf('@');
  if (at < 0) {
    throw new UsageError(`--input '${spec}' has no @cycle`);
  }
  const cycle = Number(spec.slice(at + 1));
  if (!Number.isInteger(cycle) || cycle < 0) {
    throw new UsageError(`--input '${spec}' has no whole-number cycle`);
  }
  const body = spec.slice(0, at);
  if (body === 'fire') {
    return { cycle, change: { fire: true } };
  }
  if (body === 'unfire') {
    return { cycle, change: { fire: false } };
  }
  const [name, value] = body.split('=', 2);
  if (name === 'lever') {
    const lane = LEVER_LANES[value as keyof typeof LEVER_LANES];
    if (lane === undefined) {
      throw new UsageError(
        `--input '${spec}': lever takes ${Object.keys(LEVER_LANES).join(', ')}`,
      );
    }
    return { cycle, change: { lane } };
  }
  if (name === 'skill') {
    const skill = Number(value);
    if (![1, 2, 3].includes(skill)) {
      throw new UsageError(`--input '${spec}': skill takes 1, 2 or 3`);
    }
    return { cycle, change: { skill } };
  }
  throw new UsageError(`--input '${spec}': no such control`);
}

/** A bit order, or a usage error naming the two that exist. */
function parseBitOrder(flag: string, value: string): BitOrder {
  if (value !== 'msb-first' && value !== 'lsb-first') {
    throw new UsageError(`${flag} takes msb-first or lsb-first, got '${value}'`);
  }
  return value;
}

/** A positive whole number, or a usage error. */
function parseCount(flag: string, value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0) {
    throw new UsageError(`${flag} takes a positive whole number, got '${value}'`);
  }
  return count;
}

/**
 * Parse `argv` after the interpreter and the script.
 *
 * Hand-rolled for the same reason `tools/tmsasm/cli.ts` is: this repo ships
 * zero runtime dependencies and a parser for nine flags is short. Both
 * `--flag value` and `--flag=value` are accepted because both are what people
 * type.
 */
export function parseArguments(args: readonly string[]): CliOptions {
  let original: string | undefined;
  let cycles: number | undefined;
  let sweeps: number | undefined;
  let json = false;
  let out: string | undefined;
  let help = false;
  let inputOrder: BitOrder | undefined;
  let outputOrder: BitOrder | undefined;
  const input: InputEvent[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--json') {
      json = true;
      continue;
    }

    const equals = argument.indexOf('=');
    const isFlag = argument.startsWith('--');
    const name = isFlag && equals > 0 ? argument.slice(0, equals) : argument;
    const inline = isFlag && equals > 0 ? argument.slice(equals + 1) : undefined;
    const take = (): string => {
      const value = inline ?? args[index + 1];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) {
        throw new UsageError(`${name} needs a value`);
      }
      if (inline === undefined) {
        index += 1;
      }
      return value;
    };

    switch (name) {
      case '--original':
        original = take();
        break;
      case '--cycles':
        cycles = parseCount(name, take());
        break;
      case '--sweeps':
        sweeps = parseCount(name, take());
        break;
      case '--input':
        input.push(parseInputSpec(take()));
        break;
      case '--out':
        out = take();
        break;
      case '--pla-input-order':
        inputOrder = parseBitOrder(name, take());
        break;
      case '--pla-output-order':
        outputOrder = parseBitOrder(name, take());
        break;
      default:
        throw new UsageError(`unknown option '${argument}'`);
    }
  }

  if (cycles !== undefined && sweeps !== undefined) {
    throw new UsageError('--cycles and --sweeps say the same thing; give one');
  }
  return {
    ...(original === undefined ? {} : { original }),
    cycles: cycles ?? (sweeps ?? DEFAULT_SWEEPS) * SWEEP_INSTRUCTIONS,
    input,
    json,
    ...(out === undefined ? {} : { out }),
    pla: {
      ...(inputOrder === undefined ? {} : { inputOrder }),
      ...(outputOrder === undefined ? {} : { outputOrder }),
    },
    help,
  };
}

/**
 * Run one invocation.
 *
 * Returns an exit code rather than calling `exit`, so the whole CLI is testable
 * and so the single place that ends the process is the entry-point guard below.
 */
export function runCli(args: readonly string[], streams: CliStreams): number {
  let options: CliOptions;
  try {
    options = parseArguments(args);
  } catch (error) {
    streams.err(`compare: ${(error as Error).message}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (options.help) {
    streams.out(USAGE);
    return EXIT.ok;
  }

  let romset: RomsetInspection | undefined;
  let against: MachineImage | undefined;

  if (options.original !== undefined) {
    romset = inspectRomset(options.original, nodeFs);
    if (romset.comparable) {
      try {
        against = loadComparisonTarget(options.original, options.pla, nodeFs);
      } catch (error) {
        // A romset that is *there* and unreadable is a file error, not a
        // mismatch: the machines have not been compared at all. An absent one
        // never reaches here - `comparable` is false and the run carries on
        // against our own image.
        if (error instanceof RomsetError) {
          streams.err(`compare: ${error.message}\n`);
          return EXIT.usage;
        }
        throw error;
      }
    }
  }

  const result = runHarness({
    cycles: options.cycles,
    input: options.input,
    ...(against === undefined ? {} : { against }),
  });
  const report = options.json
    ? `${JSON.stringify(reportJson({ result, ...(romset === undefined ? {} : { romset }) }), null, 2)}\n`
    : formatReport({ result, ...(romset === undefined ? {} : { romset }) });
  streams.out(report);

  if (options.out !== undefined) {
    try {
      writeFileSync(options.out, report);
    } catch (cause) {
      streams.err(
        `compare: cannot write ${options.out}: ${
          cause instanceof Error ? cause.message : String(cause)
        }\n`,
      );
      return EXIT.usage;
    }
  }

  return result.comparison.matched ? EXIT.ok : EXIT.mismatch;
}

/**
 * True when this module is the program being run, not one being imported.
 *
 * Two shapes, because the tool is run both ways - `tools/tmsasm/cli.ts` records
 * why vite-node needs the second one.
 */
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
