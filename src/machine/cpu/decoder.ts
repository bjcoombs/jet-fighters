// HMCS44 (Hitachi HD38800) instruction decoder: ten-bit ROM word in, decoded
// `Instruction` out.
//
// This module holds no opcode bit patterns of its own. Every pattern, operand
// shape, word count and cycle cost comes from `ISA` in isa.ts, which the
// assembler (PRD R2) imports as well - one table, so a decoder/assembler drift
// cannot happen. See isa.ts for the encoding's provenance and for the map of
// which opcodes carry no instruction and why.
//
// The decoder's own job is small and stated here: turn an opcode into a frozen
// `Instruction`, cache all 1024 of them, and never throw. Unassigned patterns
// and operands naming hardware the device does not have both come back as
// `InstructionType.UNKNOWN`: a runaway program counter reaching an unassigned
// word is a hardware condition, and cpu.ts decides what to do about it.
//
// Pure logic only: no DOM, no timers, no Web APIs.

import {
  INSTRUCTION_CATEGORY,
  InstructionType,
  type Instruction,
  isTwoWord,
} from './instruction.js';
import {
  CYCLES_PER_WORD,
  encodeInstruction,
  encodeLongInstruction,
  ISA,
  isaEntryForOpcode,
  OPCODE_COUNT,
  type IsaEntry,
} from './isa.js';
import { PC_MASK } from './registers.js';
import { WORD_MASK } from './memory.js';

export {
  CYCLES_PER_WORD,
  OPCODE_COUNT,
  RAM_BIT_COUNT,
  PATTERN_TABLE_COUNT,
  OperandKind,
} from './isa.js';

/**
 * One row of the opcode map.
 *
 * Kept as a name because the decoder's callers and tests speak in terms of the
 * opcode map; it is `IsaEntry` from isa.ts, not a second description of it.
 */
export type OpcodeSpec = IsaEntry;

/** The opcode map: `ISA`, under the name the decoder's callers use. */
export const OPCODE_TABLE: readonly OpcodeSpec[] = ISA;

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
  const spec = isaEntryForOpcode(opcode);
  if (!spec) {
    return unknownInstruction(opcode);
  }
  const operands: number[] = [];
  if (spec.operandMask !== 0) {
    const operand = opcode & spec.operandMask;
    if (operand >= spec.operandLimit) {
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
    category: spec.category,
    operands: Object.freeze(operands),
    cycles: spec.cycles,
    words: spec.words,
  });
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
  return encodeInstruction(type, operand);
}

/**
 * Build the two words of a long jump or call to an 11-bit program address.
 *
 * @throws RangeError if `type` is not two-word or `address` is outside the
 *   2048-word program region.
 */
export function encodeLong(type: InstructionType, address: number): [number, number] {
  return encodeLongInstruction(type, address);
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
