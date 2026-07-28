import { describe, expect, it } from 'vitest';
import {
  bitReverse,
  decodeInstruction,
  encodeInstruction,
  isaEntryForMnemonic,
  ISA,
  MNEMONICS,
  OperandKind,
  operandArity,
  ramReachOfFile,
  type IsaEntry,
} from './isa.js';
import { WORD_MASK } from './memory.js';

/** The row for a mnemonic, or a failed expectation naming the missing one. */
function entry(mnemonic: string): IsaEntry {
  const found = isaEntryForMnemonic(mnemonic);
  expect(found, `no instruction table row for '${mnemonic}'`).toBeDefined();
  return found as IsaEntry;
}

describe('bitReverse', () => {
  it('reverses within the stated width', () => {
    expect(bitReverse(0b0001, 4)).toBe(0b1000);
    expect(bitReverse(0b0110, 4)).toBe(0b0110);
    expect(bitReverse(0b001, 3)).toBe(0b100);
    expect(bitReverse(0b01, 2)).toBe(0b10);
  });

  it('is an involution', () => {
    for (let value = 0; value < 16; value += 1) {
      expect(bitReverse(bitReverse(value, 4), 4)).toBe(value);
    }
  });
});

describe('the fixed half of the opcode map', () => {
  // docs/research/tms1370-architecture.md section 5, "The shape of the encoding".
  const FIXED: readonly [string, number][] = [
    ['MNEA', 0x00],
    ['ALEM', 0x01],
    ['YNEA', 0x02],
    ['XMA', 0x03],
    ['DYN', 0x04],
    ['IYC', 0x05],
    ['AMAAC', 0x06],
    ['DMAN', 0x07],
    ['TKA', 0x08],
    ['COMX', 0x09],
    ['TDO', 0x0a],
    ['COMC', 0x0b],
    ['RSTR', 0x0c],
    ['SETR', 0x0d],
    ['KNEZ', 0x0e],
    ['RETN', 0x0f],
  ];

  it.each(FIXED)('encodes %s as $%s', (mnemonic, opcode) => {
    expect(encodeInstruction(entry(mnemonic))).toBe(opcode);
  });

  it('has no CLO - the TMS1100 core replaces it with COMC', () => {
    expect(isaEntryForMnemonic('CLO')).toBeUndefined();
  });

  it('has no long jump - BR and CALL are the only transfers', () => {
    expect(isaEntryForMnemonic('JMPL')).toBeUndefined();
    expect(isaEntryForMnemonic('JMP')).toBeUndefined();
  });
});

describe('the register and memory group', () => {
  const GROUP: readonly [string, number][] = [
    ['TAY', 0x20],
    ['TMA', 0x21],
    ['TMY', 0x22],
    ['TYA', 0x23],
    ['TAMDYN', 0x24],
    ['TAMIYC', 0x25],
    ['TAMZA', 0x26],
    ['TAM', 0x27],
    ['SAMAN', 0x3c],
    ['CPAIZ', 0x3d],
    ['IMAC', 0x3e],
    ['MNEZ', 0x3f],
    ['CLA', 0x7f],
  ];

  it.each(GROUP)('encodes %s as $%s', (mnemonic, opcode) => {
    expect(encodeInstruction(entry(mnemonic))).toBe(opcode);
  });
});

describe('bit-reversed operands', () => {
  it('reverses the four-bit LDP page', () => {
    expect(encodeInstruction(entry('LDP'), 0)).toBe(0x10);
    expect(encodeInstruction(entry('LDP'), 1)).toBe(0x18);
    expect(encodeInstruction(entry('LDP'), 15)).toBe(0x1f);
    expect(encodeInstruction(entry('LDP'), 8)).toBe(0x11);
  });

  it('reverses the three-bit LDX file', () => {
    expect(encodeInstruction(entry('LDX'), 0)).toBe(0x28);
    expect(encodeInstruction(entry('LDX'), 1)).toBe(0x2c);
    expect(encodeInstruction(entry('LDX'), 4)).toBe(0x29);
    expect(encodeInstruction(entry('LDX'), 7)).toBe(0x2f);
  });

  it('reverses the two-bit SBIT/RBIT/TBIT1 index', () => {
    expect(encodeInstruction(entry('SBIT'), 1)).toBe(0x32);
    expect(encodeInstruction(entry('RBIT'), 1)).toBe(0x36);
    expect(encodeInstruction(entry('TBIT1'), 1)).toBe(0x3a);
    expect(encodeInstruction(entry('TBIT1'), 2)).toBe(0x39);
  });

  it('reverses the four-bit TCY/YNEC/TCMIY constant', () => {
    expect(encodeInstruction(entry('TCY'), 1)).toBe(0x48);
    expect(encodeInstruction(entry('YNEC'), 1)).toBe(0x58);
    expect(encodeInstruction(entry('TCMIY'), 1)).toBe(0x68);
    expect(encodeInstruction(entry('TCY'), 15)).toBe(0x4f);
  });

  it('leaves the branch target unreversed - it is a raw LFSR state', () => {
    expect(entry('BR').reversed).toBe(false);
    expect(entry('CALL').reversed).toBe(false);
    expect(encodeInstruction(entry('BR'), 0x01)).toBe(0x81);
    expect(encodeInstruction(entry('CALL'), 0x3f)).toBe(0xff);
  });
});

describe('the AnAAC family', () => {
  // docs/research/tms1370-architecture.md section 5, the addend table.
  const ADDENDS: readonly number[] = [1, 9, 5, 13, 3, 11, 7, 15, 2, 10, 6, 14, 4, 12, 8];

  it.each(ADDENDS.map((addend, low) => [0x70 + low, addend] as const))(
    'decodes $%s as adding %i',
    (opcode, addend) => {
      expect(decodeInstruction(opcode).entry.mnemonic).toBe(`A${addend}AAC`);
    },
  );

  it('covers every non-zero addend exactly once', () => {
    const covered = ISA.filter((row) => /^A\d+AAC$/.test(row.mnemonic)).map((row) =>
      Number.parseInt(row.mnemonic.slice(1), 10),
    );
    expect([...covered].sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it('accepts IAC and DAN as TI names them', () => {
    expect(encodeInstruction(entry('IAC'))).toBe(0x70);
    expect(encodeInstruction(entry('DAN'))).toBe(0x77);
    expect(entry('IAC').mnemonic).toBe('A1AAC');
    expect(entry('DAN').mnemonic).toBe('A15AAC');
  });

  it('accepts the AnACC spelling MAME prints', () => {
    expect(entry('A9ACC').mnemonic).toBe('A9AAC');
  });

  it('has no A0AAC - $7F is CLA', () => {
    expect(isaEntryForMnemonic('A0AAC')).toBeUndefined();
    expect(decodeInstruction(0x7f).entry.mnemonic).toBe('CLA');
  });
});

describe('the opcode space', () => {
  it('decodes every one of the 256 words', () => {
    for (let word = 0; word <= WORD_MASK; word += 1) {
      expect(() => decodeInstruction(word)).not.toThrow();
    }
  });

  it('round-trips encode(decode(word)) === word across the whole space', () => {
    for (let word = 0; word <= WORD_MASK; word += 1) {
      const decoded = decodeInstruction(word);
      expect(encodeInstruction(decoded.entry, decoded.operand), `word $${word.toString(16)}`).toBe(
        word,
      );
    }
  });

  it('assigns every word exactly one instruction', () => {
    const seen = new Set<number>();
    for (const row of ISA) {
      for (let value = 0; value < (row.operandKind === OperandKind.NONE ? 1 : row.operandLimit); value += 1) {
        const word = encodeInstruction(row, value);
        expect(seen.has(word), `two instructions encode to $${word.toString(16)}`).toBe(false);
        seen.add(word);
      }
    }
    expect(seen.size).toBe(WORD_MASK + 1);
  });

  it('rejects a word that is not eight bits', () => {
    expect(() => decodeInstruction(256)).toThrow(/eight-bit/);
    expect(() => decodeInstruction(-1)).toThrow(/eight-bit/);
  });
});

describe('operand ranges', () => {
  it('bounds LDP by the 16 pages of a chapter', () => {
    expect(entry('LDP').operandLimit).toBe(16);
    expect(() => encodeInstruction(entry('LDP'), 16)).toThrow(/outside 0\.\.15/);
  });

  it('bounds LDX by the 8 RAM files the core implements', () => {
    expect(entry('LDX').operandLimit).toBe(8);
    expect(() => encodeInstruction(entry('LDX'), 8)).toThrow(/outside 0\.\.7/);
  });

  it('bounds the bit index by the 4 bits of a nibble', () => {
    expect(() => encodeInstruction(entry('SBIT'), 4)).toThrow(/outside 0\.\.3/);
  });

  it('rejects an operand on an instruction that takes none', () => {
    expect(() => encodeInstruction(entry('RETN'), 1)).toThrow(/takes no operand/);
  });
});

describe('the table as a whole', () => {
  it('gives every instruction an arity of 0 or 1 - no instruction has two operands', () => {
    for (const row of ISA) {
      expect(operandArity(row)).toBeLessThanOrEqual(1);
    }
  });

  it('names every mnemonic once', () => {
    const names = ISA.map((row) => row.mnemonic);
    expect(new Set(names).size).toBe(names.length);
  });

  it('resolves mnemonics case-insensitively', () => {
    expect(isaEntryForMnemonic('retn')).toBe(entry('RETN'));
    expect(isaEntryForMnemonic('TcY')).toBe(entry('TCY'));
  });

  it('lists every accepted spelling for the did-you-mean hint', () => {
    expect(MNEMONICS).toContain('RETN');
    expect(MNEMONICS).toContain('IAC');
    expect(MNEMONICS).toContain('TBIT');
  });
});

describe('ramReachOfFile', () => {
  it('reaches sixteen nibbles per file', () => {
    expect(ramReachOfFile(0)).toBe(16);
    expect(ramReachOfFile(7)).toBe(128);
  });
});
