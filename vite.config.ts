/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { tmsasm } from './tools/tmsasm/vite-plugin.js';

export default defineConfig({
  base: '/jet-fighters/',
  // The game ROM is assembly source in this repo, not a binary asset: the plugin
  // assembles `asm/*.asm` on import, so there is exactly one ROM - the one the
  // source describes - and no generated file to go stale. tmsasm claims every
  // `.asm` file; there is one assembler in the tree.
  plugins: [tmsasm()],
  test: {
    environment: 'node',
  },
});
