import { describe, expect, it } from 'vitest';

import {
  decode,
  encode,
  encodeDecoded,
  INSTRUCTIONS,
  Mnemonic,
  OPCODE_COUNT,
  OperandKind,
} from './decoder.js';

describe('TMS1370 decoder', () => {
  it('round-trips encode(decode(op)) == op across the whole opcode space', () => {
    // The one check that the shared table is self-consistent: an emulator
    // decoding from one map and an assembler encoding from another drift, and
    // the failure surfaces much later as inexplicable game behaviour. Every one
    // of the 256 patterns is assigned on this core, so the round-trip has no
    // unassigned region to skip.
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      expect(encode(decode(opcode))).toBe(opcode);
      expect(encodeDecoded(decode(opcode))).toBe(opcode);
    }
  });

  it('decodes every pattern - there is no UNKNOWN instruction on this core', () => {
    const mnemonics = new Set(Object.values(Mnemonic));
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      expect(mnemonics.has(decode(opcode).mnemonic)).toBe(true);
    }
    expect(INSTRUCTIONS).toHaveLength(OPCODE_COUNT);
  });

  it('masks an out-of-range opcode into the space rather than throwing', () => {
    // A runaway program counter is a hardware condition; the decoder's job is to
    // stay total so cpu.ts decides what to do about it.
    expect(decode(0x100).opcode).toBe(0x00);
    expect(decode(-1).opcode).toBe(0xff);
  });

  it('returns frozen instructions, so a consumer cannot mutate the shared row', () => {
    expect(Object.isFrozen(decode(0x27))).toBe(true);
  });

  it('reports the operand value the programmer wrote, not the field', () => {
    expect(decode(0x18)).toMatchObject({
      mnemonic: Mnemonic.LDP,
      operand: OperandKind.PAGE,
      value: 1,
    });
    expect(decode(0x2c)).toMatchObject({ mnemonic: Mnemonic.LDX, value: 1 });
    expect(decode(0x77)).toMatchObject({ mnemonic: Mnemonic.ANAAC, value: 15 });
    expect(decode(0x70)).toMatchObject({ mnemonic: Mnemonic.ANAAC, value: 1 });
    expect(decode(0x7f)).toMatchObject({ mnemonic: Mnemonic.CLA, value: 0 });
    expect(decode(0x32)).toMatchObject({ mnemonic: Mnemonic.SBIT, value: 1 });
    expect(decode(0xaa)).toMatchObject({
      mnemonic: Mnemonic.BR,
      operand: OperandKind.TARGET,
      value: 0x2a,
    });
    expect(decode(0xea)).toMatchObject({ mnemonic: Mnemonic.CALL, value: 0x2a });
  });

  it('decodes 0x00 as MNEA, so an unprogrammed word has no side effect', () => {
    expect(decode(0x00).mnemonic).toBe(Mnemonic.MNEA);
  });
});
