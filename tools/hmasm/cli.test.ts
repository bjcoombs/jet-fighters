import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT, parseArguments, runCli, UsageError, type CliStreams } from './cli.js';
import { ROM_SIZE } from '../../src/machine/cpu/memory.js';

let workspace: string;

beforeAll(() => {
  // Nothing is ever written inside the repository: the CLI's whole job is to
  // write files, and a test that leaves artefacts in the tree is a test that
  // eventually gets committed.
  workspace = mkdtempSync(join(tmpdir(), 'hmasm-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** Run the CLI, capturing what it wrote to each stream. */
function run(args: readonly string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const streams: CliStreams = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  return { code: runCli(args, streams), out, err };
}

/** Write a source file into the scratch directory and return its path. */
function sourceFile(name: string, contents: string): string {
  const path = join(workspace, name);
  writeFileSync(path, contents);
  return path;
}

describe('parseArguments', () => {
  it('takes the source file as the only positional argument', () => {
    expect(parseArguments(['asm/example.asm'])).toMatchObject({
      source: 'asm/example.asm',
      quiet: false,
      help: false,
    });
  });

  it('accepts a value flag written either way round', () => {
    expect(parseArguments(['a.asm', '--listing', 'out.lst']).listing).toBe('out.lst');
    expect(parseArguments(['a.asm', '--listing=out.lst']).listing).toBe('out.lst');
  });

  it('takes the exact invocation the build gate uses', () => {
    expect(parseArguments(['asm/jetfighter.asm', '--listing', '/tmp/jf.lst'])).toMatchObject({
      source: 'asm/jetfighter.asm',
      listing: '/tmp/jf.lst',
    });
  });

  it('reads the ROM image path from --output or -o', () => {
    expect(parseArguments(['a.asm', '--output', 'jf.rom']).output).toBe('jf.rom');
    expect(parseArguments(['a.asm', '-o', 'jf.rom']).output).toBe('jf.rom');
  });

  it('takes --symbols and --quiet', () => {
    const options = parseArguments(['a.asm', '--symbols', 'jf.sym', '--quiet']);
    expect(options.symbols).toBe('jf.sym');
    expect(options.quiet).toBe(true);
  });

  it('needs no source file when asked for help', () => {
    expect(parseArguments(['--help']).help).toBe(true);
    expect(parseArguments(['-h']).help).toBe(true);
  });

  it('rejects an unknown option', () => {
    expect(() => parseArguments(['a.asm', '--verbose'])).toThrow(UsageError);
    expect(() => parseArguments(['a.asm', '--verbose'])).toThrow(/unknown option '--verbose'/);
  });

  it('rejects a value flag with nothing after it', () => {
    expect(() => parseArguments(['a.asm', '--listing'])).toThrow(/--listing needs a file path/);
    expect(() => parseArguments(['a.asm', '--listing', '--quiet'])).toThrow(
      /--listing needs a file path/,
    );
  });

  it('rejects no source file, and more than one', () => {
    expect(() => parseArguments([])).toThrow(/no source file given/);
    expect(() => parseArguments(['a.asm', 'b.asm'])).toThrow(/expected one source file, got 2/);
  });
});

describe('runCli - artefacts', () => {
  it('assembles the example program and prints its summary', () => {
    const result = run(['asm/example.asm']);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toMatch(/^; Assembled words: \d+ in the program region$/m);
    expect(result.err).toBe('');
  });

  it('writes a listing, a symbol table and a ROM image where told', () => {
    const listing = join(workspace, 'example.lst');
    const symbols = join(workspace, 'example.sym');
    const rom = join(workspace, 'example.rom');
    const result = run([
      'asm/example.asm',
      '--listing',
      listing,
      '--symbols',
      symbols,
      '--output',
      rom,
      '--quiet',
    ]);

    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toBe('');
    expect(readFileSync(listing, 'utf8')).toMatch(/^\$000 \| \$280 \| reset:/m);
    expect(readFileSync(symbols, 'utf8')).toMatch(/^; main +\| LABEL +\| \$020$/m);
    // Two bytes per ten-bit word, low byte first, for the whole ROM.
    const image = readFileSync(rom);
    expect(image).toHaveLength(ROM_SIZE * 2);
    expect(image[0]).toBe(0x80);
    expect(image[1]).toBe(0x02);
  });

  it('resolves an .INCLUDE relative to the file that wrote it', () => {
    const directory = mkdtempSync(join(workspace, 'inc-'));
    writeFileSync(join(directory, 'tail.asm'), 'LBI 2\n');
    const main = join(directory, 'main.asm');
    writeFileSync(main, 'LAI 1\n.INCLUDE "tail.asm"\n');
    const listing = join(workspace, 'include.lst');

    expect(run([main, '--listing', listing, '--quiet']).code).toBe(EXIT.ok);
    expect(readFileSync(listing, 'utf8')).toMatch(/^\$001 \| \$052 \| LBI 2$/m);
  });

  it('prints usage on --help without needing a source file', () => {
    const result = run(['--help']);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toMatch(/^hmasm - assembler/);
  });
});

describe('runCli - diagnostics', () => {
  it('rejects a bad source with code 1, quoting the line and the column', () => {
    const path = sourceFile('bad.asm', 'NOP\n        LAI 16\n');
    const result = run([path, '--quiet']);
    expect(result.code).toBe(EXIT.sourceRejected);
    expect(result.err).toMatch(/:2:13: LAI immediate out of range: 16/);
    expect(result.err).toContain(' 2 |         LAI 16\n');
    expect(result.err).toContain('   |             ^');
  });

  it('copies a tab into the caret line rather than expanding it', () => {
    // The lexer counts a tab as one column, so the caret line has to reproduce
    // the tab to land under the operand at whatever tab width the terminal uses.
    const path = sourceFile('tabbed.asm', '\tLAI 16\n');
    expect(run([path, '--quiet']).err).toContain(' 1 | \tLAI 16\n   | \t    ^');
  });

  it('reports a missing source file as a usage error, not a source error', () => {
    const result = run([join(workspace, 'nowhere.asm')]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.err).toMatch(/^hmasm: cannot read .*nowhere\.asm: ENOENT/);
  });

  it('reports an unwritable output path as a usage error', () => {
    const result = run(['asm/example.asm', '--listing', join(workspace, 'no', 'such', 'dir.lst')]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.err).toMatch(/^hmasm: cannot write /);
  });

  it('rejects a bad command line with code 2 and prints usage', () => {
    const result = run(['--nonsense']);
    expect(result.code).toBe(EXIT.usage);
    expect(result.err).toMatch(/unknown option '--nonsense'/);
    expect(result.err).toContain('Usage:');
  });
});

describe('the build gate invocation, run for real', () => {
  it('exits 0 and writes a well-formed listing under vite-node', () => {
    // The exact shape the acceptance contract runs, as a subprocess: it proves
    // the module executes itself when vite-node is the launcher, which nothing
    // in-process can check, and it proves the summary a gate greps for is there.
    const listing = join(workspace, 'gate.lst');
    execFileSync(
      join(process.cwd(), 'node_modules', '.bin', 'vite-node'),
      ['tools/hmasm/cli.ts', 'asm/example.asm', '--listing', listing],
      { cwd: process.cwd(), stdio: 'pipe' },
    );

    const text = readFileSync(listing, 'utf8');
    const words = Number(/^; Assembled words: (\d+)/m.exec(text)?.[1]);
    const highest = Number(/^; Highest address: (\d+)/m.exec(text)?.[1]);
    const ram = Number(/^; RAM high-water mark: (\d+) of/m.exec(text)?.[1]);

    expect(words).toBeGreaterThan(0);
    expect(highest).toBeLessThanOrEqual(2047);
    expect(ram).toBeLessThanOrEqual(160);
  }, 60_000);
});
