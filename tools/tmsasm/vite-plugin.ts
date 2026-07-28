// TMS1000-family assembler (PRD R2), the build integration: `import rom from
// '../asm/jetfighter.asm'`.
//
// Paths in this header are relative to the repository root.
//
// The game's ROM is source in this repo, not a binary asset - it is written in
// assembly and assembled by tools/tmsasm. This plugin makes that fact invisible
// to the application: an `.asm` file is a module that exports a `Uint8Array`,
// and the dev server reassembles it the moment the assembly changes, the same
// way it would recompile a TypeScript file.
//
// ## Why a module rather than a build step
//
// The alternative is a script that writes `src/rom.generated.ts` and a rule that
// says to run it. Generated files in the tree go stale, get edited by hand and
// get committed with the wrong contents; and a stale ROM is the worst kind of
// stale, because the emulator will happily run it and the bug looks like a CPU
// bug. Assembling on import means there is exactly one ROM - the one the source
// describes - and no way to be looking at another.
//
// ## Living beside tools/hmasm during the rebuild
//
// This plugin claims the same `.asm` extension `tools/hmasm/vite-plugin.ts`
// does, so exactly one of the two may be registered in `vite.config.ts` at a
// time and the config picks which assembler the application is built with. It
// takes an explicit `include` predicate for that reason: during the rebuild both
// assemblers exist, and "which one assembles this file" is a decision the config
// should state rather than a race between two plugins over load order.
//
// ## What the module exports
//
// `default` and `rom` are the same `Uint8Array`: `ROM_SIZE` eight-bit words.
// `opla` is the 32-slot O output PLA the ROM image carries alongside the program
// - it is mask-programmed data rather than executed words, so it is a separate
// export rather than an appendix to the ROM. `symbols` carries the label and
// constant values, which the debug UI needs to name an address; `highestAddress`
// and `ramHighWater` carry the two hardware ceilings so a running build can
// assert on them.
//
// The listing is deliberately *not* exported. It is several times the size of
// the ROM, it is a diagnostic for a person rather than data for a program, and
// bundling it would put a copy of the source text into the shipped application.
// `--listing` on the CLI is the way to get one.
//
// ## Watching
//
// Every file the assembly read - the entry and each `.INCLUDE` beneath it - is
// registered with `addWatchFile`, so editing an included file reassembles the
// module that included it rather than leaving the dev server serving the ROM
// that was current when the page loaded.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { HmrContext, ModuleNode, Plugin } from 'vite';
import { assemble, AsmError, type AssemblyResult } from './assembler.js';
import { oplaImage, romImage } from './output.js';

/** The extension this plugin claims. */
export const ASM_EXTENSION = '.asm';

/** Vite appends `?import`, `?t=...` and friends; the file name is what matters. */
function stripQuery(id: string): string {
  const query = id.indexOf('?');
  return query < 0 ? id : id.slice(0, query);
}

/** An id names an assembly source when it ends `.asm`, query string aside. */
export function isAsmId(id: string): boolean {
  return stripQuery(id).endsWith(ASM_EXTENSION);
}

/** A compiled `.asm` module, and every file that went into it. */
export interface CompiledAsmModule {
  /** The JavaScript module source. */
  readonly code: string;
  /** The entry and every `.INCLUDE` under it, for `addWatchFile`. */
  readonly watchFiles: readonly string[];
  /** The assembly itself, so a caller can assert on it without re-parsing. */
  readonly result: AssemblyResult;
}

/** Render a value as a JavaScript literal the generated module can carry. */
function literal(value: string | number): string {
  return JSON.stringify(value);
}

/**
 * Assemble one file and generate the module that stands for it.
 *
 * @throws AsmError when the source is rejected - the plugin turns it into a
 *   Vite error with the file, line and column already filled in.
 */
export function compileAsmModule(path: string): CompiledAsmModule {
  const entry = resolve(path);
  const watchFiles = new Set<string>([entry]);

  const result = assemble(readFileSync(entry, 'utf8'), entry, {
    readInclude: (included, fromFile) => {
      const resolved = resolve(dirname(fromFile), included);
      watchFiles.add(resolved);
      return { file: resolved, source: readFileSync(resolved, 'utf8') };
    },
  });

  const image = romImage(result);
  const opla = oplaImage(result);
  const symbols = result.symbols
    .map((symbol) => `  ${literal(symbol.name)}: ${symbol.value},`)
    .join('\n');

  const code = [
    `// Assembled from ${entry} by tools/tmsasm/vite-plugin.ts. Not a file on disk.`,
    `export const rom = new Uint8Array([${image.join(',')}]);`,
    `export const opla = new Uint8Array([${opla.join(',')}]);`,
    `export const symbols = Object.freeze({\n${symbols}\n});`,
    `export const highestAddress = ${result.highestAddress};`,
    `export const ramHighWater = ${result.ramHighWater};`,
    `export const resetVectorPresent = ${result.resetVectorPresent};`,
    `export const source = ${literal(entry)};`,
    'export default rom;',
    '',
  ].join('\n');

  return { code, watchFiles: [...watchFiles], result };
}

/** How a caller narrows which `.asm` files this plugin claims. */
export interface TmsasmOptions {
  /**
   * Decide whether this plugin assembles a given file.
   *
   * Defaults to every `.asm` file. Supply one while `tools/hmasm/` still exists
   * and both plugins are registered, so the two do not both claim the same
   * source and the config says which assembler owns which file.
   */
  readonly include?: (id: string) => boolean;
}

/**
 * Assemble `.asm` files into importable ROM modules.
 *
 * ```ts
 * import { defineConfig } from 'vite';
 * import { tmsasm } from './tools/tmsasm/vite-plugin.js';
 *
 * export default defineConfig({ plugins: [tmsasm()] });
 * ```
 */
export function tmsasm(options: TmsasmOptions = {}): Plugin {
  const claims = options.include ?? isAsmId;
  /** Which entry modules each watched file feeds, for hot updates. */
  const dependents = new Map<string, Set<string>>();

  return {
    name: 'tmsasm',

    load(id) {
      if (!isAsmId(id) || !claims(stripQuery(id))) {
        return null;
      }
      try {
        const compiled = compileAsmModule(stripQuery(id));
        for (const file of compiled.watchFiles) {
          this.addWatchFile(file);
          const feeds = dependents.get(file) ?? new Set<string>();
          feeds.add(id);
          dependents.set(file, feeds);
        }
        return compiled.code;
      } catch (error) {
        if (error instanceof AsmError) {
          // Hand Vite the position it already has, so the overlay points at the
          // line rather than printing a string with a colon in it.
          this.error({
            message: error.message,
            id: error.position.file,
            loc: {
              file: error.position.file,
              line: error.position.line,
              column: error.position.column,
            },
          });
        }
        throw error;
      }
    },

    handleHotUpdate(context: HmrContext): ModuleNode[] | void {
      const feeds = dependents.get(resolve(context.file));
      if (!feeds) {
        return undefined;
      }
      // An `.INCLUDE` is not an import as far as the module graph is concerned,
      // so editing one has to invalidate the entry module explicitly. Editing
      // the entry itself is already in `context.modules`; adding it twice is
      // harmless and keeps the branch from having two shapes.
      const affected: ModuleNode[] = [];
      for (const entry of feeds) {
        const module = context.server.moduleGraph.getModuleById(entry);
        if (module) {
          context.server.moduleGraph.invalidateModule(module);
          affected.push(module);
        }
      }
      return [...context.modules, ...affected];
    },
  };
}

export default tmsasm;
