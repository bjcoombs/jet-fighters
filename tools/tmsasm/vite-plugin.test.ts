import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AsmError, OPLA_SLOT_COUNT } from './assembler.js';
import { ROM_SIZE } from './memory.js';
import { ASM_EXTENSION, compileAsmModule, isAsmId, tmsasm } from './vite-plugin.js';

let workspace: string;
let entryPath: string;

const SOURCE = `.OPLA 1, %00000110
.PAGE 15
reset:  CLA
        LDX 0
        BR reset
`;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'tmsasm-plugin-'));
  entryPath = join(workspace, 'entry.asm');
  writeFileSync(entryPath, SOURCE);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('isAsmId', () => {
  it('claims .asm, query string aside', () => {
    expect(isAsmId(`/a/b/game${ASM_EXTENSION}`)).toBe(true);
    expect(isAsmId(`/a/b/game${ASM_EXTENSION}?import&t=1`)).toBe(true);
  });

  it('claims nothing else', () => {
    expect(isAsmId('/a/b/game.ts')).toBe(false);
    expect(isAsmId('/a/b/asm')).toBe(false);
  });
});

describe('compileAsmModule', () => {
  it('exports the ROM as a Uint8Array of the ROM size', () => {
    const { code } = compileAsmModule(entryPath);
    expect(code).toContain('export const rom = new Uint8Array([');
    const values = (/new Uint8Array\(\[(.*?)\]\)/.exec(code)?.[1] ?? '').split(',');
    expect(values).toHaveLength(ROM_SIZE);
  });

  it('exports the O PLA beside the ROM rather than appended to it', () => {
    const { code } = compileAsmModule(entryPath);
    const opla = /export const opla = new Uint8Array\(\[(.*?)\]\)/.exec(code)?.[1] ?? '';
    expect(opla.split(',')).toHaveLength(OPLA_SLOT_COUNT);
    expect(opla.split(',')[1]).toBe('6');
  });

  it('exports the symbols, the ceilings and the reset flag', () => {
    const { code } = compileAsmModule(entryPath);
    expect(code).toContain('"reset": 960');
    expect(code).toContain('export const highestAddress =');
    expect(code).toContain('export const ramHighWater = 16;');
    expect(code).toContain('export const resetVectorPresent = true;');
  });

  it('does not export the listing - it would ship the source text', () => {
    expect(compileAsmModule(entryPath).code).not.toContain('ADDR | CH | PG');
  });

  it('reports every file the assembly read, for the watcher', () => {
    const mainPath = join(workspace, 'main.asm');
    const partPath = join(workspace, 'part.asm');
    writeFileSync(mainPath, '.INCLUDE "part.asm"\nCLA\n');
    writeFileSync(partPath, 'CLA\n');
    const { watchFiles } = compileAsmModule(mainPath);
    expect(watchFiles.map((file) => resolve(file))).toEqual(
      expect.arrayContaining([resolve(mainPath), resolve(partPath)]),
    );
  });

  it('raises an AsmError with a position when the source is rejected', () => {
    const badPath = join(workspace, 'bad.asm');
    writeFileSync(badPath, 'LDX 9\n');
    expect(() => compileAsmModule(badPath)).toThrow(AsmError);
  });
});

describe('the plugin', () => {
  it('is named tmsasm', () => {
    expect(tmsasm().name).toBe('tmsasm');
  });

  it('declines an id that is not an .asm file', () => {
    const plugin = tmsasm();
    const load = plugin.load as (this: unknown, id: string) => unknown;
    expect(load.call({ addWatchFile: () => {} }, '/a/b/main.ts')).toBeNull();
  });

  it('declines an .asm file its include predicate does not claim', () => {
    // The rebuild leaves two assemblers in the tree at once. Which one owns a
    // given source is a decision the Vite config states, not a race over which
    // plugin's `load` runs first.
    const plugin = tmsasm({ include: (id) => !id.endsWith('entry.asm') });
    const load = plugin.load as (this: unknown, id: string) => unknown;
    expect(load.call({ addWatchFile: () => {} }, entryPath)).toBeNull();
  });

  it('loads an .asm file it does claim, and registers it with the watcher', () => {
    const plugin = tmsasm();
    const watched: string[] = [];
    const load = plugin.load as (this: unknown, id: string) => string | null;
    const code = load.call({ addWatchFile: (file: string) => watched.push(file) }, entryPath);
    expect(code).toContain('export default rom;');
    expect(watched).toContain(resolve(entryPath));
  });

  it('turns an AsmError into a Vite error carrying the source position', () => {
    const badPath = join(workspace, 'bad2.asm');
    writeFileSync(badPath, '  LDX 9\n');
    const plugin = tmsasm();
    const load = plugin.load as (this: unknown, id: string) => unknown;
    let reported: { loc?: { line: number; column: number } } | undefined;
    expect(() =>
      load.call(
        {
          addWatchFile: () => {},
          error: (details: { loc?: { line: number; column: number } }) => {
            reported = details;
            throw new Error('vite error');
          },
        },
        badPath,
      ),
    ).toThrow();
    expect(reported?.loc).toMatchObject({ line: 1, column: 7 });
  });

  it('invalidates the entry module when an included file changes', () => {
    const mainPath = join(workspace, 'hot.asm');
    const partPath = join(workspace, 'hotpart.asm');
    writeFileSync(mainPath, '.INCLUDE "hotpart.asm"\nCLA\n');
    writeFileSync(partPath, 'CLA\n');

    const plugin = tmsasm();
    const load = plugin.load as (this: unknown, id: string) => unknown;
    load.call({ addWatchFile: () => {} }, mainPath);

    const module = { id: mainPath };
    const invalidated: unknown[] = [];
    const handleHotUpdate = plugin.handleHotUpdate as (context: unknown) => unknown[];
    const affected = handleHotUpdate({
      file: partPath,
      modules: [],
      server: {
        moduleGraph: {
          getModuleById: (id: string) => (id === mainPath ? module : undefined),
          invalidateModule: (node: unknown) => invalidated.push(node),
        },
      },
    });
    expect(invalidated).toContain(module);
    expect(affected).toContain(module);
  });

  it('leaves a file it never loaded alone on a hot update', () => {
    const handleHotUpdate = tmsasm().handleHotUpdate as (context: unknown) => unknown;
    expect(handleHotUpdate({ file: join(workspace, 'unknown.asm') })).toBeUndefined();
  });
});
