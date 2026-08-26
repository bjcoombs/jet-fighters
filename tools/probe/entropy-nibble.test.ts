// The machine's only randomness is the player's own rhythm - does it work?
//
// Paths in this file are relative to the repository root.
//
// ## What this is guarding
//
// This ROM has no hardware timer and no LFSR. `NIB_TICK` is the single
// free-running counter and it wraps every sixteen sweeps, so the only source of
// variety available is *when the player presses fire*. `if_down` accumulates
// NIB_TICK into `NIB_ENT` on each rising edge.
//
// `jet_enter` is the single consumer, and the last test in this file is what
// keeps it single.
//
// Two properties have to hold together, and they pull in opposite directions:
//
//   - **It must vary with the player.** A source that lands on the same value
//     whatever the player does gives every game the same shape.
//   - **It must be deterministic given the input.** `CLAUDE.md` requires the
//     same drive to produce the same run - that is what makes every other probe
//     in this directory reproducible. "Random" here means unpredictable to a
//     player, never non-deterministic to a test.
//
// ## Why accumulate rather than latch, and why the `+1` is load-bearing
//
// `docs/evidence/timing-analysis.md` records the trap: a bare latch of a
// counter that wraps at sixteen reaches only the values its sampling period
// admits. Tap every four sweeps and a latch sees four values for ever, however
// long the game runs. Summing the previous value in breaks the lock-step, and
// the `+1` keeps a press period of exactly sixteen - which would otherwise
// accumulate the same tick every time - from summing a constant.
//
// The fourth test below is that argument as an experiment: a period sharing a
// factor with sixteen, and a floor a bare latch provably cannot clear.
//
// Node-side test: no DOM, no browser globals.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { SWEEP_INSTRUCTIONS } from '../../src/machine/board/tms1370-cadence.js';
import { Tms1370Machine, assembleGame } from './tms1370-probe.js';

const ASM = assembleGame();
const symbol = (name: string): number => {
  const found = ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
};

const ENT_ADDRESS = symbol('FILE_MISS') * 16 + symbol('NIB_ENT');

/** `runSweeps` needs an escape: the ROM stops sweeping for the whole of a sound. */
const SWEEP_CEILING_CYCLES = Math.round(0.7 * CYCLE_HZ);

const DRIVE_TIMEOUT_MS = 60_000;
vi.setConfig({ testTimeout: DRIVE_TIMEOUT_MS });

/**
 * Press fire every `periodSweeps` sweeps, holding it down for one sweep.
 *
 * **`runSweeps`, not `step(SWEEP_INSTRUCTIONS)`, and the difference is the whole
 * test.** `NIB_TICK` counts sweeps, so "press every four sweeps" only means
 * anything if the presses land on real sweep boundaries. `SWEEP_INSTRUCTIONS` is
 * the *median* sweep, and the actual period varies with what is on the glass -
 * stepping by that constant drifts against the counter and manufactures variety
 * out of the drift alone.
 *
 * A first draft did exactly that, and its negative control caught it: replacing
 * the accumulate with a bare latch left all four assertions green, because the
 * drift was supplying the distinct values the accumulate was supposed to. The
 * test was measuring its own sampling error.
 */
function pressEvery(periodSweeps: number, presses: number, lane = 0): readonly number[] {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane, fire: false });
  const seen: number[] = [];
  for (let press = 0; press < presses; press += 1) {
    for (let sweep = 0; sweep < periodSweeps; sweep += 1) {
      machine.setContacts({ fire: sweep === 0 });
      machine.runSweeps(1, SWEEP_CEILING_CYCLES);
    }
    seen.push(machine.ram[ENT_ADDRESS] as number);
  }
  return seen;
}

/** The nibble as it stands after a run, which is what a consumer would read. */
const finalValue = (values: readonly number[]): number => values[values.length - 1] as number;

describe('the entropy nibble is stirred by the player and by nothing else', () => {
  it('lands on a different value when the fire timing differs', () => {
    // Same lever, same everything else - only the press rhythm differs.
    const slow = finalValue(pressEvery(7, 40));
    const fast = finalValue(pressEvery(5, 40));
    const slower = finalValue(pressEvery(11, 40));
    const distinct = new Set([slow, fast, slower]);
    expect(
      distinct.size,
      `three press rhythms all left the nibble at the same value (${slow}), ` +
        'so it is not being stirred by the player at all',
    ).toBeGreaterThan(1);
  });

  it('is deterministic: the same input twice leaves the same value', () => {
    // The other half, and the one that keeps every other probe in this
    // directory reproducible. Unpredictable to a player, never to a test.
    const first = pressEvery(7, 40);
    const second = pressEvery(7, 40);
    expect(second).toEqual(first);
  });

  it('beats a bare latch on a period sharing a factor with sixteen', () => {
    // The measured trap: NIB_TICK wraps at sixteen, so a LATCH sampled every
    // four sweeps can only ever hold four values - it reads the same four ticks
    // for ever however long the game runs. Accumulating breaks the lock-step.
    const values = pressEvery(4, 64);
    const distinct = new Set(values);
    expect(
      distinct.size,
      `pressing every 4 sweeps reached only ${distinct.size} distinct values ` +
        `(${[...distinct].sort((a, b) => a - b).join(',')}); a bare latch scores 4 or fewer, ` +
        'so this is the latch behaviour the accumulate-and-add-one exists to avoid',
    ).toBeGreaterThan(8);
  });

  it('reaches most of the nibble across a mixture of rhythms', () => {
    // Non-vacuity for the whole idea: a source that technically varies but only
    // over three of sixteen values would satisfy the tests above while giving a
    // consumer almost no room. Pooled across rhythms, as a player produces.
    const pooled = new Set<number>();
    for (const period of [3, 4, 5, 6, 7, 9, 11, 13, 16]) {
      for (const value of pressEvery(period, 24)) pooled.add(value);
    }
    expect(
      pooled.size,
      `the nibble reached only ${pooled.size} of its 16 values across nine rhythms`,
    ).toBeGreaterThan(11);
  });

  it('has exactly one writer and one reader, so no second consumer can creep in', () => {
    // **v2's defect was one nibble read by four things, and the harm was in the
    // sharing.** Parking the lever made two lanes permanently safe, because a
    // source that steered the jets also steered the rockets - see
    // `docs/evidence/open-questions.md` section 3d. So the guard is a counting
    // guard: two sites in the whole program, the write in `if_down` and the read
    // in `jet_enter`, and a third fails this whatever it is for.
    //
    // The one that would do the damage is the rocket's lane. PRD lines 285-291
    // require it to be independent of the player's press pattern and `NIB_ROTOR`
    // is a plain round robin; contract criterion V7 in `launcher-lives.test.ts`
    // is the behavioural test that catches it, and this is the structural one.
    //
    // Word-boundary matched: `NIB_ENTRY_LO`/`NIB_ENTRY_HI` are unrelated nibbles
    // that a bare substring grep for NIB_ENT also matches, which would make this
    // assertion read as six sites the moment anyone trusted it.
    const rom = readFileSync(resolve(import.meta.dirname, '..', '..', 'asm/jetfighter.asm'), 'utf8');
    const lines = rom.split('\n');
    const sites = lines
      .map((line, index) => ({ line, index }))
      // Drop the `.EQU` that declares it and any comment-only line: what is
      // being counted is instructions that name the nibble.
      .filter(({ line }) => /\bNIB_ENT\b/.test(line) && !/^\s*[;.]/.test(line));
    expect(
      sites.map(({ line }) => line.trim()),
      'expected exactly two NIB_ENT sites: the write in if_down and the read in jet_enter',
    ).toHaveLength(2);
    for (const site of sites) {
      expect(site.line, 'a site should be the TCY that addresses the nibble').toMatch(
        /TCY\s+NIB_ENT/,
      );
    }
    // ...and they must be the two routines named, not any two. The label a site
    // belongs to is the nearest one above it.
    const routineOf = (index: number): string => {
      for (let scan = index; scan >= 0; scan -= 1) {
        const label = /^([a-z_][a-z0-9_]*):/.exec(lines[scan] as string);
        if (label !== null) return label[1] as string;
      }
      return '(no label)';
    };
    expect(sites.map(({ index }) => routineOf(index)).sort()).toEqual(['if_down', 'jet_enter']);
  });
});

/** Sanity: the sweep constant this file steps by is the one the module exports. */
it('steps by whole sweeps of the length the cadence module records', () => {
  expect(SWEEP_INSTRUCTIONS).toBeGreaterThan(0);
  expect(Math.round(CYCLE_HZ / SWEEP_INSTRUCTIONS)).toBeGreaterThan(50);
});
