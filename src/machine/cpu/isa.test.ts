import { describe, it, expect } from 'vitest';
import {
  CYCLES_PER_WORD,
  encodeInstruction,
  encodeLongInstruction,
  FLAG_RULES,
  ISA,
  isaEntryFor,
  isaEntryForOpcode,
  OPCODE_COUNT,
  OperandKind,
  PATTERN_TABLE_COUNT,
  RAM_BIT_COUNT,
  UNASSIGNED_REGIONS,
} from './isa.js';
import { decode } from './decoder.js';
import {
  INSTRUCTION_CATEGORY,
  InstructionType,
  isUnknown,
} from './instruction.js';
import { R_PORT_COUNT } from './ports.js';

/** Every instruction the architecture defines - the enum less its non-instruction. */
function everyType(): InstructionType[] {
  return Object.values(InstructionType).filter((type) => type !== InstructionType.UNKNOWN);
}

describe('ISA - completeness', () => {
  it('encodes every mnemonic the architecture defines', () => {
    for (const type of everyType()) {
      expect(() => isaEntryFor(type)).not.toThrow();
    }
  });

  it('defines no encoding for the non-instruction', () => {
    expect(() => isaEntryFor(InstructionType.UNKNOWN)).toThrow(RangeError);
    expect(ISA.some((entry) => entry.type === InstructionType.UNKNOWN)).toBe(false);
  });

  it('holds one entry per instruction, and 91 of them', () => {
    expect(ISA).toHaveLength(everyType().length);
    expect(ISA).toHaveLength(91);
    expect(new Set(ISA.map((entry) => entry.type)).size).toBe(ISA.length);
  });

  it('names each entry after its mnemonic and classifies it once', () => {
    for (const entry of ISA) {
      expect(entry.mnemonic).toBe(entry.type);
      expect(entry.category).toBe(INSTRUCTION_CATEGORY[entry.type]);
    }
  });

  it('freezes the table so a consumer cannot reshape the architecture', () => {
    expect(Object.isFrozen(ISA)).toBe(true);
    for (const entry of ISA) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe('ISA - the encoding is well formed', () => {
  it('assigns each opcode to at most one instruction', () => {
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      const matches = ISA.filter((entry) => (opcode & entry.mask) === entry.match);
      expect(matches.length).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every match value clear of its own operand bits', () => {
    for (const entry of ISA) {
      expect(entry.match & entry.operandMask).toBe(0);
      expect(entry.match & ~entry.mask & 0x3ff).toBe(0);
    }
  });

  it('gives every operand field a kind and a limit that fits it', () => {
    for (const entry of ISA) {
      if (entry.operandMask === 0) {
        expect(entry.operandKind).toBe(OperandKind.NONE);
        expect(entry.operandLimit).toBe(1);
        continue;
      }
      expect(entry.operandKind).not.toBe(OperandKind.NONE);
      expect(entry.operandLimit).toBeGreaterThan(0);
      expect(entry.operandLimit).toBeLessThanOrEqual(entry.operandMask + 1);
    }
  });

  it('limits a selector to the hardware that exists', () => {
    expect(isaEntryFor(InstructionType.LAR).operandLimit).toBe(R_PORT_COUNT);
    expect(isaEntryFor(InstructionType.SEM).operandLimit).toBe(RAM_BIT_COUNT);
    expect(isaEntryFor(InstructionType.P).operandLimit).toBe(PATTERN_TABLE_COUNT);
    expect(isaEntryFor(InstructionType.SED).operandLimit).toBe(16);
  });

  it('documents every entry', () => {
    for (const entry of ISA) {
      expect(entry.summary.length).toBeGreaterThan(0);
    }
  });
});

describe('ISA - cycle costs', () => {
  it('charges one cycle per word, with the pattern read as the stated exception', () => {
    for (const entry of ISA) {
      const expected =
        entry.type === InstructionType.P
          ? 2 * CYCLES_PER_WORD
          : entry.words * CYCLES_PER_WORD;
      expect(entry.cycles).toBe(expected);
    }
  });

  it('states why the exception costs what it does', () => {
    expect(isaEntryFor(InstructionType.P).notes).toMatch(/second memory access/);
  });

  it('makes the two-word instructions the only two-word ones', () => {
    const twoWord = ISA.filter((entry) => entry.words === 2).map((entry) => entry.type);
    expect(twoWord).toEqual([InstructionType.JMPL, InstructionType.CALL]);
  });
});

describe('ISA - coverage of the opcode space', () => {
  it('leaves exactly the regions UNASSIGNED_REGIONS names unassigned', () => {
    for (const region of UNASSIGNED_REGIONS) {
      for (let opcode = region.first; opcode <= region.last; opcode += 1) {
        expect(isaEntryForOpcode(opcode)).toBeUndefined();
      }
      expect(region.reason.length).toBeGreaterThan(0);
    }
  });

  it('covers every opcode outside those regions with an instruction', () => {
    const unassigned = new Set<number>();
    for (const region of UNASSIGNED_REGIONS) {
      for (let opcode = region.first; opcode <= region.last; opcode += 1) {
        unassigned.add(opcode);
      }
    }
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      if (unassigned.has(opcode)) {
        continue;
      }
      expect(isaEntryForOpcode(opcode)).toBeDefined();
    }
  });

  it('accounts for all 1024 patterns: 401 valid, 623 not', () => {
    let valid = 0;
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      if (!isUnknown(decode(opcode))) {
        valid += 1;
      }
    }
    expect(valid).toBe(401);
    expect(OPCODE_COUNT - valid).toBe(623);
  });

  it('fills the operand-less region completely', () => {
    for (let opcode = 0x000; opcode <= 0x03f; opcode += 1) {
      expect(isUnknown(decode(opcode))).toBe(false);
      expect(decode(opcode).operands).toEqual([]);
    }
  });

  it('counts the dead patterns as selectors naming absent hardware, not gaps', () => {
    let dead = 0;
    for (let opcode = 0; opcode < OPCODE_COUNT; opcode += 1) {
      if (isaEntryForOpcode(opcode) !== undefined && isUnknown(decode(opcode))) {
        dead += 1;
      }
    }
    // 5 R-port groups x 11 + 3 RAM-bit groups x 12 + 8 pattern tables.
    expect(dead).toBe(5 * (16 - R_PORT_COUNT) + 3 * (16 - RAM_BIT_COUNT) + (16 - PATTERN_TABLE_COUNT));
    expect(dead).toBe(99);
  });
});

describe('ISA - encoding round-trips', () => {
  it('round-trips every legal operand of every one-word instruction', () => {
    for (const entry of ISA) {
      if (entry.words !== 1) {
        continue;
      }
      for (let operand = 0; operand < entry.operandLimit; operand += 1) {
        const opcode = encodeInstruction(entry.type, operand);
        const instruction = decode(opcode);
        expect(instruction.type).toBe(entry.type);
        expect(instruction.operands).toEqual(entry.operandMask === 0 ? [] : [operand]);
      }
    }
  });

  it('finds the same entry by type and by opcode', () => {
    for (const entry of ISA) {
      const opcode =
        entry.words === 1
          ? encodeInstruction(entry.type)
          : encodeLongInstruction(entry.type, 0)[0];
      expect(isaEntryForOpcode(opcode)).toBe(entry);
    }
  });

  it('rejects an operand naming hardware the device does not have', () => {
    expect(() => encodeInstruction(InstructionType.LAR, R_PORT_COUNT)).toThrow(RangeError);
    expect(() => encodeInstruction(InstructionType.SEM, RAM_BIT_COUNT)).toThrow(RangeError);
    expect(() => encodeInstruction(InstructionType.P, PATTERN_TABLE_COUNT)).toThrow(RangeError);
  });
});

describe('FLAG_RULES', () => {
  it('lists only instructions the architecture encodes', () => {
    for (const type of [...FLAG_RULES.carryWriters, ...FLAG_RULES.statusConsumers]) {
      expect(() => isaEntryFor(type)).not.toThrow();
    }
  });

  it('names every branch as a status consumer', () => {
    for (const type of [
      InstructionType.BR,
      InstructionType.CAL,
      InstructionType.JMPL,
      InstructionType.CALL,
      InstructionType.TBR,
    ]) {
      expect(FLAG_RULES.statusConsumers).toContain(type);
    }
  });
});
