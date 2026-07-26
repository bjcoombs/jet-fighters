import { describe, it, expect } from 'vitest';
import {
  CYCLES_PER_WORD,
  decode,
  encode,
  encodeLong,
  longAddress,
  OPCODE_COUNT,
  OPCODE_TABLE,
  RAM_BIT_COUNT,
} from './decoder.js';
import {
  formatInstruction,
  INSTRUCTION_CATEGORY,
  InstructionCategory,
  InstructionType,
  isTwoWord,
  isUnknown,
} from './instruction.js';
import { PC_MASK } from './registers.js';
import { R_PORT_COUNT } from './ports.js';

/** Every one-word instruction in the map, with a legal operand for each. */
function oneWordTypes(): InstructionType[] {
  return OPCODE_TABLE.filter((spec) => spec.words === 1).map((spec) => spec.type);
}

describe('decode - operand-less instructions', () => {
  it('decodes NOP at opcode 0', () => {
    const instruction = decode(0x000);
    expect(instruction.type).toBe(InstructionType.NOP);
    expect(instruction.category).toBe(InstructionCategory.CONTROL);
    expect(instruction.operands).toEqual([]);
    expect(instruction.words).toBe(1);
    expect(instruction.cycles).toBe(CYCLES_PER_WORD);
  });

  it('decodes one instruction per category', () => {
    expect(decode(encode(InstructionType.AM)).category).toBe(InstructionCategory.ALU);
    expect(decode(encode(InstructionType.LAM)).category).toBe(InstructionCategory.LOAD);
    expect(decode(encode(InstructionType.LMAIY)).category).toBe(InstructionCategory.STORE);
    expect(decode(encode(InstructionType.RTN)).category).toBe(InstructionCategory.BRANCH);
    expect(decode(encode(InstructionType.SED, 3)).category).toBe(InstructionCategory.PORT);
    expect(decode(0x3ff).category).toBe(InstructionCategory.UNKNOWN);
  });

  it('carries no operands for an operand-less instruction', () => {
    for (const type of [InstructionType.SEC, InstructionType.XSP, InstructionType.RTNI]) {
      expect(decode(encode(type)).operands).toEqual([]);
    }
  });

  it('reports the category recorded in INSTRUCTION_CATEGORY for every opcode', () => {
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      const instruction = decode(opcode);
      expect(instruction.category).toBe(INSTRUCTION_CATEGORY[instruction.type]);
    }
  });
});

describe('decode - operand extraction', () => {
  it('takes the low nibble of a group instruction as its immediate', () => {
    for (let immediate = 0; immediate <= 0x0f; immediate += 1) {
      const instruction = decode(0x040 | immediate);
      expect(instruction.type).toBe(InstructionType.LAI);
      expect(instruction.operands).toEqual([immediate]);
    }
  });

  it('keeps neighbouring groups distinct', () => {
    expect(decode(0x04f).type).toBe(InstructionType.LAI);
    expect(decode(0x050).type).toBe(InstructionType.LBI);
    expect(decode(0x04f).operands).toEqual([0x0f]);
    expect(decode(0x050).operands).toEqual([0x00]);
  });

  it('decodes a D pin selector across all sixteen pins', () => {
    for (let pin = 0; pin < 16; pin += 1) {
      expect(decode(encode(InstructionType.SED, pin)).operands).toEqual([pin]);
      expect(decode(encode(InstructionType.RED, pin)).operands).toEqual([pin]);
      expect(decode(encode(InstructionType.TD, pin)).operands).toEqual([pin]);
    }
  });

  it('decodes an R port selector across the five implemented ports', () => {
    for (let port = 0; port < R_PORT_COUNT; port += 1) {
      expect(decode(encode(InstructionType.LRA, port)).operands).toEqual([port]);
    }
  });

  it('decodes a RAM bit selector across all four bits of a nibble', () => {
    for (let bit = 0; bit < RAM_BIT_COUNT; bit += 1) {
      expect(decode(encode(InstructionType.SEM, bit)).operands).toEqual([bit]);
    }
  });

  it('takes the low five bits of a branch as its in-page offset', () => {
    for (const offset of [0, 1, 17, 31]) {
      expect(decode(0x200 | offset).type).toBe(InstructionType.BR);
      expect(decode(0x200 | offset).operands).toEqual([offset]);
      expect(decode(0x220 | offset).type).toBe(InstructionType.CAL);
      expect(decode(0x220 | offset).operands).toEqual([offset]);
    }
  });
});

describe('decode - unassigned patterns', () => {
  it('returns UNKNOWN rather than throwing for an unassigned opcode', () => {
    for (const opcode of [0x1b0, 0x1ff, 0x240, 0x27f, 0x282, 0x2c0, 0x300, 0x3ff]) {
      expect(() => decode(opcode)).not.toThrow();
      expect(isUnknown(decode(opcode))).toBe(true);
    }
  });

  it('still costs a word and a cycle so the program counter can move on', () => {
    const instruction = decode(0x3ff);
    expect(instruction.words).toBe(1);
    expect(instruction.cycles).toBe(CYCLES_PER_WORD);
    expect(instruction.operands).toEqual([]);
  });

  it('rejects an R port selector naming a port the device does not implement', () => {
    for (let port = R_PORT_COUNT; port <= 0x0f; port += 1) {
      expect(decode(0x140 | port).type).toBe(InstructionType.UNKNOWN);
      expect(decode(0x100 | port).type).toBe(InstructionType.UNKNOWN);
    }
    expect(decode(0x140 | (R_PORT_COUNT - 1)).type).toBe(InstructionType.LAR);
  });

  it('rejects a RAM bit selector above bit 3', () => {
    for (let bit = RAM_BIT_COUNT; bit <= 0x0f; bit += 1) {
      expect(decode(0x110 | bit).type).toBe(InstructionType.UNKNOWN);
      expect(decode(0x130 | bit).type).toBe(InstructionType.UNKNOWN);
    }
    expect(decode(0x110 | (RAM_BIT_COUNT - 1)).type).toBe(InstructionType.SEM);
  });

  it('decodes every one of the 1024 opcodes without throwing', () => {
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      expect(() => decode(opcode)).not.toThrow();
    }
  });

  it('leaves a substantial unassigned region - the map is not exhaustive', () => {
    let unknown = 0;
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      if (isUnknown(decode(opcode))) {
        unknown += 1;
      }
    }
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeLessThan(OPCODE_COUNT);
  });
});

describe('decode - opcode masking and identity', () => {
  it('masks the opcode to ten bits, as Memory.readRom does', () => {
    expect(decode(0x400).type).toBe(InstructionType.NOP);
    expect(decode(0xc40).type).toBe(InstructionType.LAI);
    expect(decode(0xfff).type).toBe(decode(0x3ff).type);
  });

  it('records the ten-bit opcode it decoded', () => {
    expect(decode(0x123).opcode).toBe(0x123);
    expect(decode(0x523).opcode).toBe(0x123);
  });

  it('hands out a frozen, shared instance per opcode', () => {
    expect(decode(0x040)).toBe(decode(0x040));
    expect(Object.isFrozen(decode(0x040))).toBe(true);
  });
});

describe('decode - two-word instructions', () => {
  it('flags JMPL and CALL as two words costing two cycles', () => {
    for (const type of [InstructionType.JMPL, InstructionType.CALL]) {
      const [first] = encodeLong(type, 0x123);
      const instruction = decode(first);
      expect(instruction.type).toBe(type);
      expect(isTwoWord(instruction)).toBe(true);
      expect(instruction.words).toBe(2);
      expect(instruction.cycles).toBe(2 * CYCLES_PER_WORD);
    }
  });

  it('flags every other instruction as one word', () => {
    for (const type of oneWordTypes()) {
      expect(isTwoWord(decode(encode(type)))).toBe(false);
    }
  });

  it('carries bit 10 of the target in the first word', () => {
    expect(decode(encodeLong(InstructionType.JMPL, 0x3ff)[0]).operands).toEqual([0]);
    expect(decode(encodeLong(InstructionType.JMPL, 0x400)[0]).operands).toEqual([1]);
  });

  it('recombines both words into an 11-bit target address', () => {
    for (const address of [0, 1, 0x3ff, 0x400, 0x555, PC_MASK]) {
      const [first, second] = encodeLong(InstructionType.CALL, address);
      expect(longAddress(decode(first), second)).toBe(address);
    }
  });

  it('refuses to recombine a one-word instruction', () => {
    expect(() => longAddress(decode(encode(InstructionType.NOP)), 0)).toThrow(RangeError);
  });

  it('masks a second word wider than ten bits', () => {
    const [first] = encodeLong(InstructionType.JMPL, 0);
    expect(longAddress(decode(first), 0xfff)).toBe(0x3ff);
  });
});

describe('encode', () => {
  it('round-trips every one-word instruction through decode', () => {
    for (const type of oneWordTypes()) {
      expect(decode(encode(type)).type).toBe(type);
    }
  });

  it('round-trips every legal operand of every group instruction', () => {
    for (const spec of OPCODE_TABLE) {
      if (spec.words !== 1 || spec.operandMask === 0) {
        continue;
      }
      const limit = spec.operandLimit ?? spec.operandMask + 1;
      for (let operand = 0; operand < limit; operand += 1) {
        const instruction = decode(encode(spec.type, operand));
        expect(instruction.type).toBe(spec.type);
        expect(instruction.operands).toEqual([operand]);
      }
    }
  });

  it('rejects an operand outside the instruction range', () => {
    expect(() => encode(InstructionType.SEM, RAM_BIT_COUNT)).toThrow(RangeError);
    expect(() => encode(InstructionType.LAR, R_PORT_COUNT)).toThrow(RangeError);
    expect(() => encode(InstructionType.LAI, 16)).toThrow(RangeError);
    expect(() => encode(InstructionType.LAI, -1)).toThrow(RangeError);
    expect(() => encode(InstructionType.BR, 32)).toThrow(RangeError);
  });

  it('rejects an operand on an instruction that takes none', () => {
    expect(() => encode(InstructionType.NOP, 1)).toThrow(RangeError);
  });

  it('rejects an unencodable instruction type', () => {
    expect(() => encode(InstructionType.UNKNOWN)).toThrow(RangeError);
  });

  it('routes two-word instructions to encodeLong and back', () => {
    expect(() => encode(InstructionType.JMPL)).toThrow(/encodeLong/);
    expect(() => encodeLong(InstructionType.NOP, 0)).toThrow(/encode\(\)/);
  });

  it('rejects a long target outside the program region', () => {
    expect(() => encodeLong(InstructionType.JMPL, PC_MASK + 1)).toThrow(RangeError);
    expect(() => encodeLong(InstructionType.JMPL, -1)).toThrow(RangeError);
  });
});

describe('OPCODE_TABLE - shape of the map', () => {
  it('assigns each opcode to at most one instruction', () => {
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      const matches = OPCODE_TABLE.filter((spec) => (opcode & spec.mask) === spec.match);
      expect(matches.length).toBeLessThanOrEqual(1);
    }
  });

  it('encodes each instruction type exactly once', () => {
    const types = OPCODE_TABLE.map((spec) => spec.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('never encodes UNKNOWN', () => {
    expect(OPCODE_TABLE.some((spec) => spec.type === InstructionType.UNKNOWN)).toBe(false);
  });

  it('reports each entry’s own cycle cost', () => {
    for (const spec of OPCODE_TABLE) {
      const opcode = spec.words === 1 ? encode(spec.type) : encodeLong(spec.type, 0)[0];
      expect(decode(opcode).cycles).toBe(spec.cycles);
    }
  });

  it('costs one cycle per word everywhere but the pattern read', () => {
    for (const spec of OPCODE_TABLE) {
      if (spec.type === InstructionType.P) {
        // The one documented exception: a second ROM access after its own fetch.
        expect(spec.cycles).toBe(2 * CYCLES_PER_WORD);
        continue;
      }
      expect(spec.cycles).toBe(spec.words * CYCLES_PER_WORD);
    }
  });

  it('keeps the match value clear of the operand bits', () => {
    for (const spec of OPCODE_TABLE) {
      expect(spec.match & spec.operandMask).toBe(0);
    }
  });
});

describe('formatInstruction', () => {
  it('prints an operand-less instruction as its mnemonic', () => {
    expect(formatInstruction(decode(encode(InstructionType.NOP)))).toBe('NOP');
  });

  it('prints operands after the mnemonic', () => {
    expect(formatInstruction(decode(encode(InstructionType.LAI, 5)))).toBe('LAI 5');
    expect(formatInstruction(decode(0x200 | 12))).toBe('BR 12');
  });

  it('prints an unassigned pattern as UNKNOWN', () => {
    expect(formatInstruction(decode(0x3ff))).toBe('UNKNOWN');
  });
});
