/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { hmasm } from './tools/hmasm/vite-plugin.js';
import { tmsasm } from './tools/tmsasm/vite-plugin.js';

/**
 * The one assembly source `tools/hmasm` still owns, relative to the repo root.
 *
 * The v3 rebuild replaces the HMCS44 toolchain with a TMS1370 one, and for the
 * length of the rebuild both assemblers are in the tree. They claim the same
 * `.asm` extension, so which one owns a given file is stated here rather than
 * decided by whichever plugin's `load` hook happens to run first.
 *
 * `asm/jetfighter.asm` is still HMCS44 source. When it is rewritten for the
 * TMS1370 this exclusion comes out; when `tools/hmasm/` is removed the `hmasm()`
 * plugin goes with it and tmsasm claims every `.asm` file unconditionally.
 */
const HMASM_SOURCE_SUFFIX = 'asm/jetfighter.asm';

export default defineConfig({
  base: '/jet-fighters/',
  // The game ROM is assembly source in this repo, not a binary asset: the plugin
  // assembles `asm/*.asm` on import, so there is exactly one ROM - the one the
  // source describes - and no generated file to go stale.
  //
  // tmsasm is listed first and declines the file hmasm still owns; hmasm then
  // picks it up. Ordering plus an explicit predicate, rather than either alone,
  // so neither plugin can silently claim a source the other was meant to
  // assemble.
  plugins: [tmsasm({ include: (id) => !id.endsWith(HMASM_SOURCE_SUFFIX) }), hmasm()],
  test: {
    environment: 'node',
  },
});
