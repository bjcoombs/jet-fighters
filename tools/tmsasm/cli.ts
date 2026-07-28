// TMS1000-family assembler (PRD R2), the command line: tmsasm.
//
// Paths in this header are relative to the repository root.
//
//     npx vite-node tools/tmsasm/cli.ts asm/jetfighter.asm --listing /tmp/jf.lst
//
// That invocation is the acceptance contract's V1 driver, so the entry point
// lives at `tools/tmsasm/cli.ts` and `--listing <path>` is part of the
// interface rather than a convenience flag.
//
// The only part of the tool chain that touches the file system. `assemble` is
// pure and takes its `.INCLUDE` reader as a parameter precisely so this module
// can be the single place that knows about paths, and so the assembler stays
// testable without a fixture directory.
//
// ## Arguments are parsed by hand
//
// This repo ships zero runtime dependencies, and a flag parser for seven flags
// is thirty lines. Both `--listing path` and `--listing=path` are accepted
// because both are what people type.
//
// ## Exit codes
//
// | code | meaning                                                         |
// |------|-----------------------------------------------------------------|
// | 0    | assembled; every requested artefact was written                 |
// | 1    | the source was rejected - an `AsmError` with a position         |
// | 2    | the command line was wrong, or a file could not be read/written |
//
// A build gate can therefore treat any non-zero code as failure and tell a
// broken program from a broken invocation without parsing the message.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
// The whole `process` object, not `import { argv }`: the named exports of
// node:process are bound once, and vite-node *reassigns* `process.argv` after
// stripping the script path from it. Destructuring the import would leave this
// module holding the pre-launch array and reading the script's own path back as
// a source file.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assemble, AsmError, type AssemblyResult } from './assembler.js';
import { formatListing, formatSummary, formatSymbolTable, oplaImage, romImage } from './output.js';

/** Exit codes, named so the table in the header has one implementation. */
export const EXIT = Object.freeze({
  ok: 0,
  sourceRejected: 1,
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
  /** The source file to assemble. */
  readonly source: string;
  /** Where to write the listing, if asked for. */
  readonly listing?: string;
  /** Where to write the symbol table on its own, if asked for. */
  readonly symbols?: string;
  /** Where to write the ROM image, if asked for. */
  readonly output?: string;
  /** Where to write the O output PLA image, if asked for. */
  readonly opla?: string;
  /** Suppress the summary on stdout. */
  readonly quiet: boolean;
  /** Print usage and stop. */
  readonly help: boolean;
}

/** Streams the CLI writes to. Injected so a test never writes to a terminal. */
export interface CliStreams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE = `tmsasm - assembler for the TMS1370 core in this repo

Usage:
  vite-node tools/tmsasm/cli.ts <source.asm> [options]

Options:
  --listing <path>   write the listing: address, chapter, page, ordinal within
                     the page, physical offset, word and source line, headed by
                     the program word count and the RAM high-water mark
  --symbols <path>   write the symbol table on its own
  --output <path>    write the ROM image: 2048 eight-bit words, one byte each
  --opla <path>      write the O output PLA image: 32 eight-bit plate masks
  --quiet            do not print the summary
  --help, -h         print this text

Exit codes: 0 assembled, 1 source rejected, 2 bad command line or file error.
`;

/** The flags that take a value, and the option each one sets. */
const VALUE_FLAGS = Object.freeze({
  '--listing': 'listing',
  '--symbols': 'symbols',
  '--output': 'output',
  '--opla': 'opla',
  '-o': 'output',
} as const);

type ValueFlag = keyof typeof VALUE_FLAGS;

function isValueFlag(name: string): name is ValueFlag {
  return Object.hasOwn(VALUE_FLAGS, name);
}

/**
 * Parse `argv` after the interpreter and the script.
 *
 * @throws UsageError on an unknown flag, a flag missing its value, or anything
 *   other than exactly one source file.
 */
export function parseArguments(args: readonly string[]): CliOptions {
  const paths: Partial<Record<'listing' | 'symbols' | 'output' | 'opla', string>> = {};
  const positional: string[] = [];
  let quiet = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;

    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--quiet') {
      quiet = true;
      continue;
    }

    // `--listing=path` and `--listing path` are the same thing.
    const equals = argument.indexOf('=');
    const name = argument.startsWith('-') && equals > 0 ? argument.slice(0, equals) : argument;
    const inlineValue =
      argument.startsWith('-') && equals > 0 ? argument.slice(equals + 1) : undefined;

    if (isValueFlag(name)) {
      const value = inlineValue ?? args[index + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith('-'))) {
        throw new UsageError(`${name} needs a file path`);
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      paths[VALUE_FLAGS[name]] = value;
      continue;
    }

    if (argument.startsWith('-') && argument !== '-') {
      throw new UsageError(`unknown option '${argument}'`);
    }
    positional.push(argument);
  }

  if (help) {
    return { source: '', quiet, help: true };
  }
  if (positional.length === 0) {
    throw new UsageError('no source file given');
  }
  if (positional.length > 1) {
    throw new UsageError(
      `expected one source file, got ${positional.length}: ${positional.join(', ')}`,
    );
  }

  return { source: positional[0] as string, ...paths, quiet, help: false };
}

/**
 * Assemble a file from disk, resolving `.INCLUDE` relative to the including
 * file rather than to the working directory - an include names a neighbour of
 * the file that writes it, and moving the build out of the repo root should not
 * change which file that is.
 */
export function assembleFile(path: string): AssemblyResult {
  const readSource = (target: string): string => {
    try {
      return readFileSync(target, 'utf8');
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new UsageError(`cannot read ${target}: ${reason}`);
    }
  };

  return assemble(readSource(path), path, {
    readInclude: (included, fromFile) => {
      const resolved = resolve(dirname(fromFile), included);
      return { file: resolved, source: readFileSync(resolved, 'utf8') };
    },
  });
}

/**
 * Quote the offending source line with a caret under the column.
 *
 * Tabs in the prefix are copied through rather than expanded, so the caret lands
 * under the right character whatever tab width the reader's terminal uses.
 */
function excerpt(error: AsmError): string {
  let text: string;
  try {
    text = readFileSync(error.position.file, 'utf8');
  } catch {
    // The position may name a file this process never opened - an assembly of a
    // string, or a source that has since moved. The message alone still says
    // where; there is simply no line to quote.
    return '';
  }
  const line = text.split(/\r\n|\r|\n/)[error.position.line - 1];
  if (line === undefined) {
    return '';
  }
  const gutter = String(error.position.line);
  const pad = ' '.repeat(gutter.length);
  const prefix = line.slice(0, error.position.column - 1).replace(/[^\t]/g, ' ');
  return `\n ${gutter} | ${line}\n ${pad} | ${prefix}^`;
}

function write(path: string, contents: string | Uint8Array): void {
  try {
    writeFileSync(path, contents);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new UsageError(`cannot write ${path}: ${reason}`);
  }
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
    streams.err(`tmsasm: ${(error as Error).message}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (options.help) {
    streams.out(USAGE);
    return EXIT.ok;
  }

  let result: AssemblyResult;
  try {
    result = assembleFile(options.source);
  } catch (error) {
    if (error instanceof AsmError) {
      streams.err(`${error.message}${excerpt(error)}\n`);
      return EXIT.sourceRejected;
    }
    if (error instanceof UsageError) {
      streams.err(`tmsasm: ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }

  try {
    if (options.listing !== undefined) {
      write(options.listing, formatListing(result));
    }
    if (options.symbols !== undefined) {
      write(options.symbols, `${formatSymbolTable(result)}\n`);
    }
    if (options.output !== undefined) {
      write(options.output, romImage(result));
    }
    if (options.opla !== undefined) {
      write(options.opla, oplaImage(result));
    }
  } catch (error) {
    if (error instanceof UsageError) {
      streams.err(`tmsasm: ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }

  if (!options.quiet) {
    streams.out(`${formatSummary(result)}\n`);
  }
  return EXIT.ok;
}

/**
 * True when this module is the program being run, not one being imported.
 *
 * Two shapes to recognise, because the tool is run both ways. Under plain Node
 * `argv[1]` is this file. Under vite-node - the form the acceptance gate uses,
 * since nothing here is compiled ahead of time - `argv[1]` is the vite-node
 * binary and the script path has already been consumed out of the argument
 * list, so there is nothing left to compare against; vite-node runs exactly one
 * entry module, and this is it. Anything else (vitest importing the module for
 * its tests) matches neither and does not run the CLI.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return (
      resolve(entry) === fileURLToPath(import.meta.url) ||
      basename(entry).startsWith('vite-node')
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
