// `three` is the site's one runtime dependency, and it is confined to this page.
//
// The machine, the input layer and the driver are dependency-free
// by rule (CLAUDE.md, "Architecture rules"); a WebGL library reaching into any of
// them would be a change to what the emulation is, not to how it is shown. This
// test reads the import graph and says so.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..');

/** The only directory under src/ that may import `three`. */
const ALLOWED = 'viewer3d/';

const IMPORT = /\bfrom\s+['"](three(?:\/[^'"]*)?)['"]|\bimport\s*\(\s*['"](three(?:\/[^'"]*)?)['"]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

describe('the three.js boundary', () => {
  it('is crossed by nothing outside src/viewer3d/', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel.startsWith(ALLOWED)) continue;
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const hits = [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
      if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('is used by the page, so the rule guards something', () => {
    const source = readFileSync(join(SRC, 'viewer3d/scene.ts'), 'utf8');
    expect(source).toMatch(/from 'three'/);
  });
});
