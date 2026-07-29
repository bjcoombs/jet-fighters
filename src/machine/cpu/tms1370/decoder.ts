// TMS1370 instruction decoder: an 8-bit ROM word in, a frozen `Instruction` out.
//
// This module holds no opcode bit patterns of its own. Every pattern, operand
// shape and operand width comes from `ISA` in isa.ts, which any future assembler
// imports as well - one table, so a decoder/assembler drift cannot happen.
//
// The decoder cannot fail. Every one of the 256 patterns is assigned on this
// core (isa.ts), so unlike the v2 core's decoder there is no UNKNOWN
// instruction and no unassigned region: `decode` is total, and
// `encode(decode(op)) === op` holds across the whole opcode space. That
// round-trip is the property `decoder.test.ts` asserts, and it is the cheapest
// check that the shared table is self-consistent.
//
// Pure logic only: no DOM, no timers, no Web APIs.

import {
  encode,
  decodeOperand,
  isaEntryForOpcode,
  OPCODE_COUNT,
  OPCODE_MASK,
  type Instruction,
} from './isa.js';

export {
  CYCLES_PER_INSTRUCTION,
  Mnemonic,
  OperandKind,
  OPCODE_COUNT,
  OPCODE_MASK,
  encode,
  encodeInstruction,
  type Instruction,
  type IsaEntry,
} from './isa.js';

function buildInstruction(opcode: number): Instruction {
  const row = isaEntryForOpcode(opcode);
  return Object.freeze({
    opcode,
    mnemonic: row.mnemonic,
    operand: row.operand,
    value: decodeOperand(row.operand, opcode - row.base),
  });
}

/**
 * All 256 decoded instructions, built once at import.
 *
 * The engine fetches one word per instruction cycle at up to tens of thousands
 * of instructions a second, so decoding is a table lookup rather than a switch
 * over bit patterns; the instructions are frozen so a consumer cannot mutate the
 * shared row it was handed.
 */
const DECODED: readonly Instruction[] = Object.freeze(
  Array.from({ length: OPCODE_COUNT }, (_unused, opcode) => buildInstruction(opcode)),
);

/** Decode one 8-bit ROM word. Total: every pattern is assigned on this core. */
export function decode(opcode: number): Instruction {
  return DECODED[opcode & OPCODE_MASK] as Instruction;
}

/** Every decoded instruction, in opcode order. */
export const INSTRUCTIONS: readonly Instruction[] = DECODED;

/** Reassemble a decoded instruction into the word it came from. */
export function encodeDecoded(instruction: Instruction): number {
  return encode(instruction);
}
