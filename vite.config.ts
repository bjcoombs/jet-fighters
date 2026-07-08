/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/jet-fighters/',
  test: {
    environment: 'node',
  },
});
