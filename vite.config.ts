/// <reference types="vitest/config" />
import { resolve } from 'node:path';

import { defineConfig } from 'vite';
import { tmsasm } from './tools/tmsasm/vite-plugin.js';

export default defineConfig({
  base: '/jet-fighters/',
  // The game ROM is assembly source in this repo, not a binary asset: the plugin
  // assembles `asm/*.asm` on import, so there is exactly one ROM - the one the
  // source describes - and no generated file to go stale. tmsasm claims every
  // `.asm` file; there is one assembler in the tree.
  plugins: [tmsasm()],
  build: {
    // The viewer's bundle is three.js, which is 600 kB minified and used whole; the
    // warning would only ever say so.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // Two pages: the flat case and the 3D model. Each has its own entry and its
      // own bundle; `three` is reachable only from the second.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, '3d.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
