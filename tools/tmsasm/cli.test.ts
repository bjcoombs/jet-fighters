import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleFile, EXIT, parseArguments, runCli, UsageError, type CliStreams } from './cli.js';
import { OPLA_SLOT_COUNT } from './assembler.js';
import { ROM_SIZE } from './memory.js';

/** Where this suite writes: never the repo, always a temporary directory. */
let workspace: string;

/** The fixture the CLI assembles, written fresh so no test depends on another. */
let sourcePath: string;

const SOURCE = `.EQU RAM_STATE, 3
.OPLA 1, %00000110
.PAGE 15
reset:  CLA
        LDX 0
        TCY RAM_STATE
        BR reset
`;

/** Collected stdout and stderr, and the streams that fill them. */
function capture(): { streams: CliStreams; out: () => string; err: () => string } {
  let out = '';
  let err = '';
  return {
    streams: { out: (text) => (out += text), err: (text) => (err += text) },
    out: () => out,
    err: () => err,
  };
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'tmsasm-cli-'));
  sourcePath = join(workspace, 'demo.asm');
  writeFileSync(sourcePath, SOURCE);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('parseArguments', () => {
  it('takes one source file', () => {
    expect(parseArguments(['game.asm']).source).toBe('game.asm');
  });

  it('accepts --listing with a separate value and with an equals sign', () => {
    expect(parseArguments(['g.asm', '--listing', 'a.lst']).listing).toBe('a.lst');
    expect(parseArguments(['g.asm', '--listing=a.lst']).listing).toBe('a.lst');
  });

  it('accepts the other output flags', () => {
    const options = parseArguments(['g.asm', '--symbols', 's.txt', '-o', 'r.bin', '--opla', 'o.bin']);
    expect(options.symbols).toBe('s.txt');
    expect(options.output).toBe('r.bin');
    expect(options.opla).toBe('o.bin');
  });

  it('takes --quiet and --help', () => {
    expect(parseArguments(['g.asm', '--quiet']).quiet).toBe(true);
    expect(parseArguments(['--help']).help).toBe(true);
  });

  it('rejects a flag with no value', () => {
    expect(() => parseArguments(['g.asm', '--listing'])).toThrow(UsageError);
    expect(() => parseArguments(['g.asm', '--listing', '--quiet'])).toThrow(/needs a file path/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArguments(['g.asm', '--nope'])).toThrow(/unknown option '--nope'/);
  });

  it('rejects no source and more than one source', () => {
    expect(() => parseArguments([])).toThrow(/no source file given/);
    expect(() => parseArguments(['a.asm', 'b.asm'])).toThrow(/expected one source file, got 2/);
  });
});

describe('assembleFile', () => {
  it('resolves an .INCLUDE relative to the file that wrote it', () => {
    writeFileSync(join(workspace, 'main.asm'), '.INCLUDE "part.asm"\nCLA\n');
    writeFileSync(join(workspace, 'part.asm'), 'CLA\n');
    expect(assembleFile(join(workspace, 'main.asm')).words).toHaveLength(2);
  });

  it('reports a missing file as a usage error, not a crash', () => {
    expect(() => assembleFile(join(workspace, 'absent.asm'))).toThrow(UsageError);
  });
});

describe('runCli', () => {
  it('assembles and prints the summary', () => {
    const { streams, out } = capture();
    expect(runCli([sourcePath], streams)).toBe(EXIT.ok);
    expect(out()).toMatch(/^; tmsasm listing for /);
    expect(out()).toMatch(/^; Program words: 4 of 2048$/m);
  });

  it('writes the listing --listing asks for', () => {
    const listingPath = join(workspace, 'demo.lst');
    const { streams } = capture();
    expect(runCli([sourcePath, '--listing', listingPath], streams)).toBe(EXIT.ok);
    const listing = readFileSync(listingPath, 'utf8');
    expect(listing).toMatch(/^; RAM high-water mark: /m);
    expect(listing).toMatch(/^; ADDR \| CH \| PG \| ORD \| OFF \| WORD \| SOURCE$/m);
    expect(listing).toMatch(/^\$3C0 \| 0 \| 15 \| {2}0 \| \$00 \|/m);
  });

  it('writes the ROM image --output asks for, one byte per word', () => {
    const romPath = join(workspace, 'demo.rom');
    const { streams } = capture();
    expect(runCli([sourcePath, '--output', romPath, '--quiet'], streams)).toBe(EXIT.ok);
    const bytes = readFileSync(romPath);
    expect(bytes).toHaveLength(ROM_SIZE);
    expect(bytes[0x3c0]).toBe(0x7f);
  });

  it('writes the O PLA image --opla asks for', () => {
    const oplaPath = join(workspace, 'demo.opla');
    const { streams } = capture();
    expect(runCli([sourcePath, '--opla', oplaPath, '--quiet'], streams)).toBe(EXIT.ok);
    const bytes = readFileSync(oplaPath);
    expect(bytes).toHaveLength(OPLA_SLOT_COUNT);
    expect(bytes[1]).toBe(0x06);
    expect(bytes[0]).toBe(0);
  });

  it('writes the symbol table --symbols asks for', () => {
    const symbolPath = join(workspace, 'demo.sym');
    const { streams } = capture();
    expect(runCli([sourcePath, '--symbols', symbolPath, '--quiet'], streams)).toBe(EXIT.ok);
    expect(readFileSync(symbolPath, 'utf8')).toMatch(/reset +\| LABEL/);
  });

  it('says nothing on stdout with --quiet', () => {
    const { streams, out } = capture();
    expect(runCli([sourcePath, '--quiet'], streams)).toBe(EXIT.ok);
    expect(out()).toBe('');
  });

  it('prints usage for --help', () => {
    const { streams, out } = capture();
    expect(runCli(['--help'], streams)).toBe(EXIT.ok);
    expect(out()).toMatch(/^tmsasm - assembler for the TMS1370 core/);
  });

  it('returns 1 and points at the character when the source is rejected', () => {
    const badPath = join(workspace, 'bad.asm');
    writeFileSync(badPath, 'CLA\n  LDX 9\n');
    const { streams, err } = capture();
    expect(runCli([badPath], streams)).toBe(EXIT.sourceRejected);
    expect(err()).toMatch(/bad\.asm:2:7: LDX RAM file out of range: 9/);
    expect(err()).toContain('  LDX 9');
    expect(err()).toContain('^');
  });

  it('returns 2 for a bad command line', () => {
    const { streams, err } = capture();
    expect(runCli(['--nope'], streams)).toBe(EXIT.usage);
    expect(err()).toMatch(/^tmsasm: unknown option/);
  });

  it('returns 2 for a source file that cannot be read', () => {
    const { streams, err } = capture();
    expect(runCli([join(workspace, 'missing.asm')], streams)).toBe(EXIT.usage);
    expect(err()).toMatch(/^tmsasm: cannot read /);
  });

  it('returns 2 when an artefact cannot be written', () => {
    const { streams, err } = capture();
    expect(runCli([sourcePath, '--listing', join(workspace, 'no', 'such', 'dir.lst')], streams)).toBe(
      EXIT.usage,
    );
    expect(err()).toMatch(/^tmsasm: cannot write /);
  });
});
