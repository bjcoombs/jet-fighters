// HMCS44 (Hitachi HD38800) instruction decoder: ten-bit ROM word in, decoded
// `Instruction` out.
//
// Sources and provenance. The instruction set is the documented HMCS40 family
// one (see instruction.ts and docs/prd/jet-fighters-v2.md R1). The *bit
// assignments below are this repo's*, not Hitachi's: Jet Fighter's ROM was
// never dumped, no opcode map appears in our source material, and every word
// this core will ever execute comes from an assembler we also write (PRD R2).
// The encoding therefore has exactly one job - to be fixed, total, and shared
// between the decoder and the assembler - and it is stated as a convention
// rather than dressed up as a measurement.
//
// The map, in three regions:
//
// | opcode        | shape                      | contents                     |
// |---------------|----------------------------|------------------------------|
// | 0x000-0x03F   | six-bit sub-opcode         | operand-less instructions    |
// | 0x040-0x17F   | group << 4 \| operand4     | one 4-bit operand each       |
// | 0x200-0x2BF   | branch region              | BR, CAL, JMPL, CALL          |
//
// Everything outside them, and every operand outside an instruction's valid
// range, decodes to `InstructionType.UNKNOWN`. Decoding never throws: a
// runaway program counter reaching an unassigned word is a hardware condition,
// and cpu.ts decides what to do about it.
//
// Page geometry follows memory.ts: 64 pages of 32 words, so an in-page branch
// offset is five bits wide.
//
// Pure logic only: no DOM, no timers, no Web APIs.

import {
  INSTRUCTION_CATEGORY,
  InstructionType,
  type Instruction,
  isTwoWord,
} from './instruction.js';
import { PC_MASK } from './registers.js';
import { ROM_OFFSET_MASK, WORD_MASK } from './memory.js';
import { R_PORT_COUNT } from './ports.js';

/** Number of distinct ten-bit opcodes. */
export const OPCODE_COUNT = WORD_MASK + 1;

/** Bits of a RAM nibble a bit-addressing instruction can name: 0-3. */
export const RAM_BIT_COUNT = 4;

/**
 * Cost of one ROM word, in machine cycles.
 *
 * The HMCS40 family fetches and executes one word per instruction cycle, so
 * every instruction in the table costs its word count. Individual databook
 * figures for the full mnemonic set are not in our source material; if one
 * turns out to differ, it changes here and the CPU needs no edit.
 */
export const CYCLES_PER_WORD = 1;

/** One row of the opcode map. */
export interface OpcodeSpec {
  readonly type: InstructionType;
  /** Bits the pattern fixes. */
  readonly mask: number;
  /** Value those bits must take. */
  readonly match: number;
  /** Bits carrying the operand; 0 for the operand-less instructions. */
  readonly operandMask: number;
  /** Operand values at or above this decode as UNKNOWN. Absent means no limit. */
  readonly operandLimit?: number;
  /** ROM words occupied. */
  readonly words: number;
}

/** An operand-less instruction at one exact opcode. */
function fixed(type: InstructionType, opcode: number): OpcodeSpec {
  return { type, mask: WORD_MASK, match: opcode, operandMask: 0, words: 1 };
}

/** An instruction occupying a group of sixteen, low nibble as its operand. */
function group(type: InstructionType, groupIndex: number, operandLimit?: number): OpcodeSpec {
  return {
    type,
    mask: 0x3f0,
    match: groupIndex << 4,
    operandMask: 0x00f,
    operandLimit,
    words: 1,
  };
}

/**
 * The opcode map.
 *
 * Order is irrelevant to correctness - the patterns are disjoint, and
 * `decoder.test.ts` asserts that they are - but it is kept in opcode order so
 * the table reads as the map it is.
 */
export const OPCODE_TABLE: readonly OpcodeSpec[] = [
  // --- 0x000-0x03F: operand-less ------------------------------------------
  fixed(InstructionType.NOP, 0x000),
  fixed(InstructionType.SBY, 0x001),
  fixed(InstructionType.STOP, 0x002),
  fixed(InstructionType.RTN, 0x003),
  fixed(InstructionType.RTNI, 0x004),
  fixed(InstructionType.SEC, 0x005),
  fixed(InstructionType.REC, 0x006),
  fixed(InstructionType.TC, 0x007),
  fixed(InstructionType.AM, 0x008),
  fixed(InstructionType.AMC, 0x009),
  fixed(InstructionType.SMC, 0x00a),
  fixed(InstructionType.DAA, 0x00b),
  fixed(InstructionType.DAS, 0x00c),
  fixed(InstructionType.NEGA, 0x00d),
  fixed(InstructionType.COMB, 0x00e),
  fixed(InstructionType.ROTR, 0x00f),
  fixed(InstructionType.ROTL, 0x010),
  fixed(InstructionType.IB, 0x011),
  fixed(InstructionType.DB, 0x012),
  fixed(InstructionType.IY, 0x013),
  fixed(InstructionType.DY, 0x014),
  fixed(InstructionType.AYY, 0x015),
  fixed(InstructionType.SYY, 0x016),
  fixed(InstructionType.XSP, 0x017),
  fixed(InstructionType.LAB, 0x018),
  fixed(InstructionType.LBA, 0x019),
  fixed(InstructionType.LAY, 0x01a),
  fixed(InstructionType.LASPX, 0x01b),
  fixed(InstructionType.LASPY, 0x01c),
  fixed(InstructionType.LAM, 0x01d),
  fixed(InstructionType.LBM, 0x01e),
  fixed(InstructionType.XMA, 0x01f),
  fixed(InstructionType.XMB, 0x020),
  fixed(InstructionType.LMAIY, 0x021),
  fixed(InstructionType.LMADY, 0x022),
  fixed(InstructionType.LXA, 0x023),
  fixed(InstructionType.LYA, 0x024),
  fixed(InstructionType.ALEM, 0x025),
  fixed(InstructionType.BLEM, 0x026),
  fixed(InstructionType.ANEM, 0x027),
  fixed(InstructionType.YNEA, 0x028),
  // 0x029-0x03F unassigned.

  // --- 0x040-0x17F: one 4-bit operand each --------------------------------
  group(InstructionType.LAI, 0x04),
  group(InstructionType.LBI, 0x05),
  group(InstructionType.LXI, 0x06),
  group(InstructionType.LYI, 0x07),
  group(InstructionType.AI, 0x08),
  group(InstructionType.ALEI, 0x09),
  group(InstructionType.YNEI, 0x0a),
  group(InstructionType.MNEI, 0x0b),
  group(InstructionType.LMIIY, 0x0c),
  group(InstructionType.SED, 0x0d),
  group(InstructionType.RED, 0x0e),
  group(InstructionType.TD, 0x0f),
  group(InstructionType.XAMR, 0x10, R_PORT_COUNT),
  group(InstructionType.SEM, 0x11, RAM_BIT_COUNT),
  group(InstructionType.REM, 0x12, RAM_BIT_COUNT),
  group(InstructionType.TM, 0x13, RAM_BIT_COUNT),
  group(InstructionType.LAR, 0x14, R_PORT_COUNT),
  group(InstructionType.LBR, 0x15, R_PORT_COUNT),
  group(InstructionType.LRA, 0x16, R_PORT_COUNT),
  group(InstructionType.LRB, 0x17, R_PORT_COUNT),
  // 0x180-0x1FF unassigned.

  // --- 0x200-0x2BF: control transfer --------------------------------------
  // BR and CAL carry a five-bit in-page offset, matching memory.ts's 32-word
  // pages. CAL's page is always 0, so the ROM has 32 subroutine entry points -
  // the same "subroutine page" constraint the family imposes, at our page size.
  { type: InstructionType.BR, mask: 0x3e0, match: 0x200, operandMask: ROM_OFFSET_MASK, words: 1 },
  { type: InstructionType.CAL, mask: 0x3e0, match: 0x220, operandMask: ROM_OFFSET_MASK, words: 1 },
  // JMPL and CALL are two words: the first carries bit 10 of the target, the
  // second the low ten bits. Together that is the full 11-bit program counter.
  { type: InstructionType.JMPL, mask: 0x3fe, match: 0x280, operandMask: 0x001, words: 2 },
  { type: InstructionType.CALL, mask: 0x3fe, match: 0x2a0, operandMask: 0x001, words: 2 },
  // 0x2C0-0x3FF unassigned.
];

/** The instruction every unassigned bit pattern decodes to. */
function unknownInstruction(opcode: number): Instruction {
  return Object.freeze({
    opcode,
    type: InstructionType.UNKNOWN,
    category: INSTRUCTION_CATEGORY[InstructionType.UNKNOWN],
    operands: Object.freeze([]),
    // One word, one cycle: an illegal opcode must let the program counter move
    // on. What the real device does with an unassigned pattern is undocumented,
    // so this is a stated choice, not a measured cost.
    cycles: CYCLES_PER_WORD,
    words: 1,
  });
}

/** Decode one opcode from scratch. Called once per opcode to fill the cache. */
function decodeUncached(opcode: number): Instruction {
  for (const spec of OPCODE_TABLE) {
    if ((opcode & spec.mask) !== spec.match) {
      continue;
    }
    const operands: number[] = [];
    if (spec.operandMask !== 0) {
      const operand = opcode & spec.operandMask;
      if (spec.operandLimit !== undefined && operand >= spec.operandLimit) {
        // A selector naming hardware that does not exist - R port 7, RAM bit 9.
        // The pattern is in the map but this encoding of it is not a valid
        // instruction, so it is illegal rather than silently clamped.
        return unknownInstruction(opcode);
      }
      operands.push(operand);
    }
    return Object.freeze({
      opcode,
      type: spec.type,
      category: INSTRUCTION_CATEGORY[spec.type],
      operands: Object.freeze(operands),
      cycles: spec.words * CYCLES_PER_WORD,
      words: spec.words,
    });
  }
  return unknownInstruction(opcode);
}

/**
 * Every opcode, decoded once at module load.
 *
 * 1024 frozen objects is a few tens of kilobytes and removes decoding from the
 * hot path entirely - the core runs at ~400k instructions of emulated time per
 * emulated second and decodes the same handful of words millions of times.
 */
const DECODED: readonly Instruction[] = Array.from({ length: OPCODE_COUNT }, (_unused, opcode) =>
  decodeUncached(opcode),
);

/**
 * Decode a ten-bit ROM word.
 *
 * Bits above the low ten are masked off, matching `Memory.readRom()`. The
 * returned object is shared and frozen: callers must not hold it expecting it
 * to describe a particular fetch, only a particular opcode.
 *
 * Never throws. Unassigned patterns come back as `InstructionType.UNKNOWN`.
 */
export function decode(opcode: number): Instruction {
  return DECODED[opcode & WORD_MASK];
}

/**
 * Build the opcode for an instruction, the inverse of `decode()`.
 *
 * Exists so tests and the assembler (R2) name instructions instead of magic
 * numbers, and so the encoding has one definition rather than two.
 *
 * @throws RangeError for `UNKNOWN`, for a two-word instruction (use
 *   `encodeLong()`), or for an operand outside the instruction's range.
 */
export function encode(type: InstructionType, operand = 0): number {
  const spec = specFor(type);
  if (spec.words !== 1) {
    throw new RangeError(`${type} is a two-word instruction - use encodeLong()`);
  }
  if (spec.operandMask === 0) {
    if (operand !== 0) {
      throw new RangeError(`${type} takes no operand, got ${operand}`);
    }
    return spec.match;
  }
  const limit = spec.operandLimit ?? spec.operandMask + 1;
  if (!Number.isInteger(operand) || operand < 0 || operand >= limit) {
    throw new RangeError(`${type} operand out of range: ${operand} (expected 0..${limit - 1})`);
  }
  return spec.match | operand;
}

/**
 * Build the two words of a long jump or call to an 11-bit program address.
 *
 * @throws RangeError if `type` is not two-word or `address` is outside the
 *   2048-word program region.
 */
export function encodeLong(type: InstructionType, address: number): [number, number] {
  const spec = specFor(type);
  if (spec.words !== 2) {
    throw new RangeError(`${type} is a one-word instruction - use encode()`);
  }
  if (!Number.isInteger(address) || address < 0 || address > PC_MASK) {
    throw new RangeError(`${type} target out of range: ${address} (expected 0..${PC_MASK})`);
  }
  return [spec.match | ((address >>> 10) & 0x001), address & WORD_MASK];
}

/**
 * Combine a two-word instruction's first word with the second word fetched
 * after it, giving the 11-bit target address.
 *
 * @throws RangeError if `instruction` is not two-word - reaching here with a
 *   one-word instruction means the fetch loop is out of step, which is worth
 *   failing loudly for rather than returning a plausible address.
 */
export function longAddress(instruction: Instruction, secondWord: number): number {
  if (!isTwoWord(instruction)) {
    throw new RangeError(`${instruction.type} is not a two-word instruction`);
  }
  const high = instruction.operands[0] ?? 0;
  return ((high << 10) | (secondWord & WORD_MASK)) & PC_MASK;
}

function specFor(type: InstructionType): OpcodeSpec {
  const spec = OPCODE_TABLE.find((candidate) => candidate.type === type);
  if (!spec) {
    throw new RangeError(`${type} has no encoding`);
  }
  return spec;
}
