import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileAsmModule, hmasm, isAsmId } from './vite-plugin.js';
import { Memory, ROM_SIZE } from '../../src/machine/cpu/memory.js';
import { encode } from '../../src/machine/cpu/decoder.js';
import { InstructionType } from '../../src/machine/cpu/instruction.js';

/** The shape the plugin's `load` hook is called with, minus what it never uses. */
interface LoadContext {
  addWatchFile: (id: string) => void;
  error: (payload: { message: string; loc?: { line: number; column: number } }) => never;
}

type LoadHook = (this: LoadContext, id: string) => string | null;

/** A load context that records what was watched and throws on `error`. */
function makeContext(watched: string[] = []): LoadContext {
  return {
    addWatchFile: (id: string) => {
      watched.push(id);
    },
    error: (payload) => {
      throw new Error(payload.message);
    },
  };
}

/** The plugin's `load`, typed as the plain function it is. */
function loadHook(): LoadHook {
  return hmasm().load as unknown as LoadHook;
}

/** Execute a generated module and hand back its exports. */
async function evaluate(code: string): Promise<Record<string, unknown>> {
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'hmasm-plugin-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('isAsmId', () => {
  it('claims .asm files, with or without a Vite query string', () => {
    expect(isAsmId('/repo/asm/example.asm')).toBe(true);
    expect(isAsmId('/repo/asm/example.asm?import')).toBe(true);
    expect(isAsmId('/repo/asm/example.asm?t=1700000000000')).toBe(true);
  });

  it('claims nothing else', () => {
    expect(isAsmId('/repo/src/main.ts')).toBe(false);
    expect(isAsmId('/repo/asm/example.asm.ts')).toBe(false);
    expect(isAsmId('/repo/notes.txt')).toBe(false);
  });
});

describe('compileAsmModule', () => {
  it('generates a module whose ROM the emulator can be built from', async () => {
    const compiled = compileAsmModule('asm/example.asm');
    const module = await evaluate(compiled.code);

    const rom = module.rom as Uint16Array;
    expect(rom).toBeInstanceOf(Uint16Array);
    expect(rom).toHaveLength(ROM_SIZE);
    expect(module.default).toBe(rom);
    expect(() => new Memory(rom)).not.toThrow();
  });

  it('carries the words the assembler emitted, at their addresses', async () => {
    const module = await evaluate(compileAsmModule('asm/example.asm').code);
    const rom = module.rom as Uint16Array;
    const symbols = module.symbols as Record<string, number>;
    // main starts with LPI 6 - the prescaler setup - at the address the symbol
    // table gives for it.
    expect(rom[symbols.main as number]).toBe(encode(InstructionType.LPI, 6));
  });

  it('exports the symbol table and both hardware ceilings', async () => {
    const compiled = compileAsmModule('asm/example.asm');
    const module = await evaluate(compiled.code);

    expect(module.symbols).toMatchObject({ main: 0x020, reset: 0x000 });
    expect(module.highestAddress).toBe(compiled.result.highestAddress);
    expect(module.ramHighWater).toBe(compiled.result.ramHighWater);
    expect(module.source).toBe(resolve('asm/example.asm'));
  });

  it('leaves the listing out, so no build ships a copy of the source text', () => {
    const compiled = compileAsmModule('asm/example.asm');
    expect(compiled.code).not.toContain('listing');
    expect(compiled.code).not.toContain('prescaler ratio');
  });

  it('watches the entry file and every file it includes', () => {
    const directory = mkdtempSync(join(workspace, 'inc-'));
    const included = join(directory, 'tail.asm');
    const entry = join(directory, 'main.asm');
    writeFileSync(included, 'LBI 2\n');
    writeFileSync(entry, 'LAI 1\n.INCLUDE "tail.asm"\n');

    expect(compileAsmModule(entry).watchFiles).toEqual([entry, included]);
  });
});

describe('the plugin load hook', () => {
  it('ignores anything that is not assembly', () => {
    const watched: string[] = [];
    expect(loadHook().call(makeContext(watched), '/repo/src/main.ts')).toBeNull();
    expect(watched).toEqual([]);
  });

  it('assembles an .asm id and registers what it read', () => {
    const watched: string[] = [];
    const code = loadHook().call(makeContext(watched), 'asm/example.asm');
    expect(code).toContain('export const rom = new Uint16Array([');
    expect(watched).toEqual([resolve('asm/example.asm')]);
  });

  it('assembles an id carrying a Vite query string', () => {
    expect(loadHook().call(makeContext(), 'asm/example.asm?import')).toContain(
      'export default rom;',
    );
  });

  it('hands a rejected source to Vite with its line and column', () => {
    const entry = join(workspace, 'broken.asm');
    writeFileSync(entry, 'NOP\n        LAI 16\n');
    const reported: { message: string; loc?: { line: number; column: number } }[] = [];
    const context: LoadContext = {
      addWatchFile: () => {},
      error: (payload) => {
        reported.push(payload);
        throw new Error(payload.message);
      },
    };

    expect(() => loadHook().call(context, entry)).toThrow(/LAI immediate out of range: 16/);
    expect(reported[0]?.loc).toMatchObject({ line: 2, column: 13 });
  });
});

describe('the plugin hot-update hook', () => {
  /** A module graph that records what was invalidated. */
  function stubServer(modules: Map<string, { id: string }>) {
    const invalidated: string[] = [];
    return {
      invalidated,
      server: {
        moduleGraph: {
          getModuleById: (id: string) => modules.get(id),
          invalidateModule: (module: { id: string }) => invalidated.push(module.id),
        },
      },
    };
  }

  it('invalidates the entry module when a file it included changes', () => {
    const directory = mkdtempSync(join(workspace, 'hot-'));
    const included = join(directory, 'tail.asm');
    const entry = join(directory, 'main.asm');
    writeFileSync(included, 'LBI 2\n');
    writeFileSync(entry, 'LAI 1\n.INCLUDE "tail.asm"\n');

    const plugin = hmasm();
    const load = plugin.load as unknown as LoadHook;
    load.call(makeContext(), entry);

    const entryModule = { id: entry };
    const stub = stubServer(new Map([[entry, entryModule]]));
    const handle = plugin.handleHotUpdate as unknown as (
      context: unknown,
    ) => { id: string }[] | undefined;
    const affected = handle({ file: included, modules: [], ...stub });

    expect(stub.invalidated).toEqual([entry]);
    expect(affected).toEqual([entryModule]);
  });

  it('leaves files it knows nothing about to the rest of the pipeline', () => {
    const plugin = hmasm();
    const handle = plugin.handleHotUpdate as unknown as (
      context: unknown,
    ) => { id: string }[] | undefined;
    const stub = stubServer(new Map());
    expect(handle({ file: join(workspace, 'unrelated.ts'), modules: [], ...stub })).toBeUndefined();
    expect(stub.invalidated).toEqual([]);
  });
});
