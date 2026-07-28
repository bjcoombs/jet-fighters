// The assembly source and the TypeScript rules describe one table, and this is
// what holds them to it. Paths in this file are relative to the repository root.
//
// `asm/opla.inc.asm` is what the machine runs: the assembler emits it into the
// O PLA image the Vite plugin hands the board. `src/machine/board/o-pla.ts` is
// what the tests and the board reason about, and it generates its 32 masks from
// the layout rules rather than listing them. Two statements of one table is a
// drift risk, so the equality is asserted here rather than trusted - a mask
// edited in one place and not the other is a test failure and not a surprise
// three tasks later.
//
// Node-side test: no DOM, no browser globals.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, OPLA_SLOT_COUNT } from './assembler.js';
import { formatListing, LISTING_KEYS, oplaImage } from './output.js';
import {
  DIGIT_BLANK_INDEX,
  O_PLA_DARK_INDEX,
  O_PLA_TABLE,
  RESERVED_INDEX,
  formatPlateMask,
} from '../../src/machine/board/o-pla.js';

const TABLE_SOURCE = fileURLToPath(new URL('../../asm/opla.inc.asm', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/demo.asm', import.meta.url));

const readInclude = (included: string, fromFile: string) => {
  const resolved = resolve(dirname(fromFile), included);
  return { file: resolved, source: readFileSync(resolved, 'utf8') };
};

/**
 * Assemble the table on its own.
 *
 * It is an include with no code in it, which assembles to a program of zero
 * words and a full O PLA image - exactly the shape that proves the directive
 * carries the table rather than the surrounding program carrying it.
 */
const standalone = assemble(readFileSync(TABLE_SOURCE, 'utf8'), TABLE_SOURCE, { readInclude });

/** And assembled the way the machine gets it: included by a program. */
const included = assemble(readFileSync(FIXTURE, 'utf8'), FIXTURE, { readInclude });

describe('asm/opla.inc.asm assembles to the table src/machine/board/o-pla.ts describes', () => {
  it('slot for slot', () => {
    expect([...oplaImage(standalone)]).toEqual([...O_PLA_TABLE]);
  });

  it('and does so identically when a program includes it', () => {
    expect([...oplaImage(included)]).toEqual([...O_PLA_TABLE]);
  });

  it('with slot 0 all plates dark', () => {
    expect(standalone.opla[O_PLA_DARK_INDEX]).toBe(0);
  });

  it('into an image of exactly 32 slots', () => {
    expect(oplaImage(standalone)).toHaveLength(OPLA_SLOT_COUNT);
  });
});

describe('the source declares what the design says it declares', () => {
  it('declares 31 of the 32 slots, leaving one as headroom', () => {
    expect(standalone.oplaEntries).toHaveLength(OPLA_SLOT_COUNT - 1);
    const declared = new Set(standalone.oplaEntries.map((entry) => entry.index));
    expect(declared.has(RESERVED_INDEX)).toBe(false);
  });

  it('leaves the undeclared slot assembled to 0, as the contract permits', () => {
    expect(standalone.opla[RESERVED_INDEX]).toBe(0);
  });

  it('declares the blank digit rather than letting it fall out of the gap', () => {
    // A dark slot that is *declared* is a design decision; a dark slot that is
    // merely undeclared is an absence. The tens column depends on this one.
    const declared = new Set(standalone.oplaEntries.map((entry) => entry.index));
    expect(declared.has(DIGIT_BLANK_INDEX)).toBe(true);
    expect(standalone.opla[DIGIT_BLANK_INDEX]).toBe(0);
  });

  it('names each slot in the listing the same way the design document does', () => {
    const listing = formatListing(included);
    const slots = new RegExp(`^; ${LISTING_KEYS.oplaSlots}: (.*)$`, 'm').exec(listing);
    expect(slots).not.toBeNull();
    expect((slots as RegExpExecArray)[1]).toBe(`${OPLA_SLOT_COUNT - 1} of ${OPLA_SLOT_COUNT}`);
  });
});

describe('a mask edited in one place and not the other is caught', () => {
  it('by the slot-for-slot equality above, which this case proves is armed', () => {
    // The negative of the first assertion, made visible: mutate the assembled
    // image the way a stray edit to asm/opla.inc.asm would, and the comparison
    // must reject it. Without this, "expect(a).toEqual(b)" over two things
    // generated from the same intent reads as a tautology.
    const mutated = [...oplaImage(standalone)];
    const victim = mutated.findIndex((mask, index) => index !== O_PLA_DARK_INDEX && mask !== 0);
    expect(victim).toBeGreaterThan(0);
    mutated[victim] = ((mutated[victim] as number) ^ 0x01) & 0xff;
    expect(mutated, `flipping a plate in ${formatPlateMask(victim)} went unnoticed`).not.toEqual([
      ...O_PLA_TABLE,
    ]);
  });
});
