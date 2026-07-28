import { describe, expect, it } from 'vitest';

import {
  DARK_OUTPUT_PLA,
  O_LINE_COUNT,
  O_LINE_MASK,
  O_PLA_ENTRY_COUNT,
  O_RESET_INDEX,
  Tms1370OutputPla,
} from './opla.js';
import { O_MASK, O_PIN_COUNT, O_PLA_INDEX_COUNT } from './ports.js';
import { O_INDEX_BITS, O_INDEX_MASK } from './registers.js';

describe('TMS1370 output PLA', () => {
  it('has one slot per value of the 5-bit index', () => {
    expect(O_INDEX_BITS).toBe(5);
    expect(O_PLA_ENTRY_COUNT).toBe(1 << O_INDEX_BITS);
    expect(O_PLA_ENTRY_COUNT).toBe(32);
    expect(O_LINE_COUNT).toBe(8);
    expect(O_LINE_MASK).toBe(0xff);
  });

  it('agrees with the port file, which states the same ceiling from the pin budget', () => {
    // Two modules reach 32 by different routes - this one from the index width,
    // ports.ts from the O port's own PLA description. They must not drift.
    expect(O_PLA_ENTRY_COUNT).toBe(O_PLA_INDEX_COUNT);
    expect(O_LINE_COUNT).toBe(O_PIN_COUNT);
    expect(O_LINE_MASK).toBe(O_MASK);
  });

  it('leaves undeclared slots dark rather than undefined', () => {
    const pla = new Tms1370OutputPla([0x81, 0x42]);
    expect(pla.decode(0)).toBe(0x81);
    expect(pla.decode(1)).toBe(0x42);
    for (let index = 2; index < O_PLA_ENTRY_COUNT; index += 1) {
      expect(pla.decode(index)).toBe(0);
    }
    expect(pla.entries).toHaveLength(O_PLA_ENTRY_COUNT);
  });

  it('drives nothing at all when no table is supplied', () => {
    for (let index = 0; index < O_PLA_ENTRY_COUNT; index += 1) {
      expect(DARK_OUTPUT_PLA.decode(index)).toBe(0);
    }
  });

  it('rejects a 33rd entry rather than dropping it', () => {
    // A caller with 33 masks has a table the hardware cannot address. Dropping
    // the last one silently is how an output vocabulary grows a member nothing
    // can reach.
    const tooMany = Array.from({ length: O_PLA_ENTRY_COUNT + 1 }, (_unused, i) => i);
    expect(() => new Tms1370OutputPla(tooMany)).toThrow(/at most 32 entries/);
    expect(() => new Tms1370OutputPla(tooMany.slice(0, O_PLA_ENTRY_COUNT))).not.toThrow();
  });

  it('masks the index into the table, so there is no slot outside it', () => {
    const entries = Array.from({ length: O_PLA_ENTRY_COUNT }, (_unused, i) => (i * 7) & O_LINE_MASK);
    const pla = new Tms1370OutputPla(entries);
    expect(pla.decode(O_PLA_ENTRY_COUNT)).toBe(pla.decode(0));
    expect(pla.decode(-1)).toBe(pla.decode(O_INDEX_MASK));
    expect(pla.decode(0xffff)).toBe(pla.decode(O_INDEX_MASK));
  });

  it('masks a stored entry to eight lines - there is no ninth O pin', () => {
    const pla = new Tms1370OutputPla([0x1ff]);
    expect(pla.decode(0)).toBe(0xff);
  });

  it('states its whole output vocabulary without running anything', () => {
    // The set of masks the machine can ever put on the O pins is a property of
    // the table, computable statically. That is what makes contract V4's
    // "cannot express a plate mask absent from the table" an assertion about
    // the machine rather than about the program.
    const pla = new Tms1370OutputPla([0x00, 0x0f, 0xf0, 0x0f]);
    expect(pla.vocabulary).toEqual(new Set([0x00, 0x0f, 0xf0]));
  });

  it('writes darkness at reset, because index 0 is how O gets cleared', () => {
    // There is no CLO on this core: clearing the O register means TDO with A = 0
    // and the status latch clear, i.e. index 0. Reset writes the same slot, so a
    // build cannot have one meaning at power-on and another in the ROM.
    expect(O_RESET_INDEX).toBe(0);
    expect(DARK_OUTPUT_PLA.decode(O_RESET_INDEX)).toBe(0);
  });
});
