import { describe, expect, it } from 'vitest';

import {
  encodeInstruction,
  decodeOperand,
  encodeOperand,
  isaEntryForOpcode,
  isOperandInRange,
  ISA,
  ISA_BY_MNEMONIC,
  MAX_ADDEND,
  MIN_ADDEND,
  Mnemonic,
  OPCODE_COUNT,
  OperandKind,
  operandBits,
  operandRange,
  reverseBits,
} from './isa.js';
import { NIBBLE_MASK, PAGE_MASK, PC_MASK, X_MASK } from './registers.js';

describe('TMS1370 opcode map', () => {
  it('assigns every one of the 256 eight-bit patterns', () => {
    // Unlike the v2 core this replaces, the TMS1100 map has no unassigned
    // region: research doc section 5 accounts for all 256 words
    // between the fixed half and the microinstruction-defined half.
    const total = ISA.reduce((sum, row) => sum + row.opcodeCount, 0);
    expect(total).toBe(OPCODE_COUNT);
  });

  it('covers the space without gaps or overlaps', () => {
    const seen = new Set<number>();
    for (const row of ISA) {
      for (let offset = 0; offset < row.opcodeCount; offset += 1) {
        const opcode = row.base + offset;
        expect(seen.has(opcode)).toBe(false);
        seen.add(opcode);
      }
    }
    expect(seen.size).toBe(OPCODE_COUNT);
  });

  it('places the fixed half where the research document transcribes it', () => {
    const fixed: ReadonlyArray<readonly [number, Mnemonic]> = [
      [0x00, Mnemonic.MNEA],
      [0x01, Mnemonic.ALEM],
      [0x02, Mnemonic.YNEA],
      [0x03, Mnemonic.XMA],
      [0x04, Mnemonic.DYN],
      [0x05, Mnemonic.IYC],
      [0x06, Mnemonic.AMAAC],
      [0x07, Mnemonic.DMAN],
      [0x08, Mnemonic.TKA],
      [0x09, Mnemonic.COMX],
      [0x0a, Mnemonic.TDO],
      [0x0b, Mnemonic.COMC],
      [0x0c, Mnemonic.RSTR],
      [0x0d, Mnemonic.SETR],
      [0x0e, Mnemonic.KNEZ],
      [0x0f, Mnemonic.RETN],
    ];
    for (const [opcode, mnemonic] of fixed) {
      expect(isaEntryForOpcode(opcode).mnemonic).toBe(mnemonic);
    }
  });

  it('has no CLO: 0x0B is COMC on this core', () => {
    // The TMS1000's clear-O instruction is replaced by COMC on the TMS1100 core
    // (research doc section 5). Clearing the O register means TDO with A = 0 and
    // the status latch clear - there is no instruction that does it directly.
    expect(isaEntryForOpcode(0x0b).mnemonic).toBe(Mnemonic.COMC);
    expect(ISA.some((row) => String(row.mnemonic) === 'CLO')).toBe(false);
  });

  it('gives BR the 0x80-0xBF quarter and CALL the 0xC0-0xFF quarter', () => {
    for (let opcode = 0x80; opcode <= 0xbf; opcode += 1) {
      expect(isaEntryForOpcode(opcode).mnemonic).toBe(Mnemonic.BR);
    }
    for (let opcode = 0xc0; opcode <= 0xff; opcode += 1) {
      expect(isaEntryForOpcode(opcode).mnemonic).toBe(Mnemonic.CALL);
    }
  });

  it('reserves 0x7F for CLA rather than an A16AAC that cannot exist', () => {
    expect(isaEntryForOpcode(0x7f).mnemonic).toBe(Mnemonic.CLA);
    expect(isaEntryForOpcode(0x7e).mnemonic).toBe(Mnemonic.ANAAC);
  });
});

describe('TMS1370 operand encoding', () => {
  it('reverses the bits, which is its own inverse at a fixed width', () => {
    expect(reverseBits(0b0001, 4)).toBe(0b1000);
    expect(reverseBits(0b1000, 4)).toBe(0b0001);
    expect(reverseBits(0b110, 3)).toBe(0b011);
    expect(reverseBits(0b01, 2)).toBe(0b10);
    for (let value = 0; value <= NIBBLE_MASK; value += 1) {
      expect(reverseBits(reverseBits(value, 4), 4)).toBe(value);
    }
  });

  it('leaves the branch target unreversed - it is an LFSR state, not a constant', () => {
    expect(operandBits(OperandKind.TARGET)).toBe(6);
    for (let target = 0; target <= PC_MASK; target += 1) {
      expect(encodeOperand(OperandKind.TARGET, target)).toBe(target);
      expect(decodeOperand(OperandKind.TARGET, target)).toBe(target);
    }
    expect(encodeInstruction(Mnemonic.BR, 0x2a)).toBe(0x80 | 0x2a);
    expect(encodeInstruction(Mnemonic.CALL, 0x2a)).toBe(0xc0 | 0x2a);
  });

  it('round-trips every operand value of every kind', () => {
    for (const kind of Object.values(OperandKind)) {
      const [min, max] = operandRange(kind);
      for (let value = min; value <= max; value += 1) {
        expect(decodeOperand(kind, encodeOperand(kind, value))).toBe(value);
      }
    }
  });

  it('offsets the AnAAC family by one - there is no A0AAC', () => {
    expect(MIN_ADDEND).toBe(1);
    expect(MAX_ADDEND).toBe(NIBBLE_MASK);
    // Research doc section 5's table: 0x70 adds 1 (TI's IAC), 0x77 adds 15
    // (TI's DAN), 0x78 adds 2.
    expect(decodeOperand(OperandKind.ADDEND, 0x70 - 0x70)).toBe(1);
    expect(decodeOperand(OperandKind.ADDEND, 0x77 - 0x70)).toBe(15);
    expect(decodeOperand(OperandKind.ADDEND, 0x78 - 0x70)).toBe(2);
    expect(decodeOperand(OperandKind.ADDEND, 0x7e - 0x70)).toBe(8);
    expect(encodeInstruction(Mnemonic.ANAAC, 1)).toBe(0x70);
    expect(encodeInstruction(Mnemonic.ANAAC, 15)).toBe(0x77);
  });

  it('bit-reverses LDP, LDX, TCY, YNEC, TCMIY and the bit index', () => {
    expect(encodeInstruction(Mnemonic.LDP, 1)).toBe(0x10 | 0b1000);
    expect(encodeInstruction(Mnemonic.LDX, 1)).toBe(0x28 | 0b100);
    expect(encodeInstruction(Mnemonic.TCY, 1)).toBe(0x40 | 0b1000);
    expect(encodeInstruction(Mnemonic.YNEC, 1)).toBe(0x50 | 0b1000);
    expect(encodeInstruction(Mnemonic.TCMIY, 1)).toBe(0x60 | 0b1000);
    expect(encodeInstruction(Mnemonic.SBIT, 1)).toBe(0x30 | 0b10);
    expect(encodeInstruction(Mnemonic.RBIT, 1)).toBe(0x34 | 0b10);
    expect(encodeInstruction(Mnemonic.TBIT, 1)).toBe(0x38 | 0b10);
  });

  it('ranges each operand to the register it loads', () => {
    expect(operandRange(OperandKind.PAGE)).toEqual([0, PAGE_MASK]);
    expect(operandRange(OperandKind.FILE)).toEqual([0, X_MASK]);
    expect(operandRange(OperandKind.CONSTANT)).toEqual([0, NIBBLE_MASK]);
    expect(operandRange(OperandKind.TARGET)).toEqual([0, PC_MASK]);
    expect(isOperandInRange(OperandKind.FILE, 8)).toBe(false);
    expect(isOperandInRange(OperandKind.ADDEND, 0)).toBe(false);
    expect(isOperandInRange(OperandKind.ADDEND, 16)).toBe(false);
  });

  it('refuses to encode an out-of-range operand rather than masking it', () => {
    // LDX 8 on a 3-bit X register is a bug. Silently storing LDX 0 is the class
    // of failure the assembler exists to make impossible, so it throws here too.
    expect(() => encodeInstruction(Mnemonic.LDX, 8)).toThrow(/outside 0\.\.7/);
    expect(() => encodeInstruction(Mnemonic.ANAAC, 0)).toThrow(/outside 1\.\.15/);
    expect(() => encodeInstruction(Mnemonic.TCY, 16)).toThrow(/outside 0\.\.15/);
    expect(() => encodeInstruction(Mnemonic.LDP, -1)).toThrow(/outside 0\.\.15/);
  });

  it('indexes every mnemonic exactly once', () => {
    expect(ISA_BY_MNEMONIC.size).toBe(ISA.length);
    for (const mnemonic of Object.values(Mnemonic)) {
      expect(ISA_BY_MNEMONIC.get(mnemonic)?.mnemonic).toBe(mnemonic);
    }
  });
});
