// Nothing owns a clock except src/app/driver.ts.
//
// The board advances only when stepped, the renderer draws only when told the
// elapsed time, the speaker plays only what it is pumped. That is what lets the
// probe suite and the spectral tests drive the real machine headlessly, and it
// holds only as long as no module below the driver reaches for a timer. This
// test reads the tree and says so, so a stray `setTimeout` in a device fails
// here rather than in a probe that has started to drift.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..');

/** The one module allowed to schedule frames and read wall-clock time. */
const CLOCK_OWNER = 'app/driver.ts';

/**
 * Modules that may call `requestAnimationFrame` for a *render* loop of their
 * own but never to step the board. Empty until the 3D page lands.
 */
const RENDER_LOOPS: readonly string[] = [];

const CLOCK_CALLS = /\b(requestAnimationFrame|setTimeout|setInterval|performance\.now|Date\.now)\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$|\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments so a rule quoted in prose does not trip the rule. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the clock', () => {
  it('is owned by the driver and nothing else under src/', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel === CLOCK_OWNER) continue;
      const calls = [...code(readFileSync(file, 'utf8')).matchAll(CLOCK_CALLS)].map((m) => m[1]);
      if (calls.length === 0) continue;
      const renderOnly = RENDER_LOOPS.some((p) => rel.startsWith(p));
      if (renderOnly && calls.every((c) => c === 'requestAnimationFrame')) continue;
      offenders.push(`${rel}: ${[...new Set(calls)].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('is actually used by the driver', () => {
    const source = code(readFileSync(join(SRC, CLOCK_OWNER), 'utf8'));
    expect(source).toMatch(/requestAnimationFrame\(/);
  });
});
