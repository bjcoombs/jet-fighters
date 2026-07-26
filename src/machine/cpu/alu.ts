// HMCS44 (Hitachi HD38800) arithmetic and logic unit: the 4-bit operations the
// instruction set is built from.
//
// Pure functions over numbers. Nothing here reads or writes a register: an
// operation takes its operands and its incoming carry and returns the result
// with the outgoing one, so cpu.ts decides what lands where and the semantics
// can be tested exhaustively - every input combination of a 4-bit ALU is a few
// hundred cases.
//
// Sources and the carry convention. The register set and the mnemonics are the
// documented HMCS40 family ones (docs/prd/jet-fighters-v2.md R1). The exact flag
// effects are not settled by our source material, so isa.ts states the rules
// this core implements and this module is their implementation. The one that
// matters most for the game program: **carry is the inverted borrow**. SEC
// before a subtraction means "no borrow in"; carry 1 after one means "no borrow
// out", i.e. the minuend was the larger. The PRD's BCD score arithmetic (R3)
// chains through DAA and DAS on that convention, so changing it changes the
// score.
//
// Pure logic only: no DOM, no timers, no Web APIs.

import { NIBBLE_MASK } from './registers.js';

/** Values a 4-bit operand can take: 0-15. */
export const NIBBLE_VALUES = NIBBLE_MASK + 1;

/** Highest decimal digit a BCD nibble may hold. */
export const BCD_MAX_DIGIT = 9;

/**
 * The correction a decimal adjust applies.
 *
 * A 4-bit binary add carries at 16 and a decimal one at 10, so an addition that
 * produced a non-decimal nibble is 6 short of where BCD wants it. DAS applies
 * the same 6 in the other direction, which on a 4-bit wrap is +10.
 */
export const BCD_CORRECTION = 6;

/** Result of an ALU operation: a 4-bit value and the flag it leaves behind. */
export interface AluResult {
  /** The 4-bit result. */
  readonly value: number;
  /**
   * Carry out.
   *
   * For additions, true when the result left four bits. For subtractions, true
   * when *no* borrow was needed - the inverted-borrow convention above. For the
   * rotates, the bit shifted out. For operations with no carry effect, the carry
   * that was passed in, so a caller can assign it back unconditionally.
   */
  readonly carry: boolean;
}

function result(value: number, carry: boolean): AluResult {
  return { value: value & NIBBLE_MASK, carry };
}

/** A + B + carry-in, over four bits. */
export function add(a: number, b: number, carryIn = false): AluResult {
  const sum = (a & NIBBLE_MASK) + (b & NIBBLE_MASK) + (carryIn ? 1 : 0);
  return result(sum, sum > NIBBLE_MASK);
}

/**
 * A - B - borrow, over four bits, with carry as the inverted borrow.
 *
 * Computed as `a + ~b + carryIn` exactly as the hardware adder would: carry in
 * 1 means "no borrow in", and the carry out is 1 when the subtraction did not
 * need to borrow.
 */
export function subtract(a: number, b: number, carryIn = true): AluResult {
  const difference = (a & NIBBLE_MASK) + (~b & NIBBLE_MASK) + (carryIn ? 1 : 0);
  return result(difference, difference > NIBBLE_MASK);
}

/** A + 1, over four bits. Carry out is set when the value wrapped to 0. */
export function increment(value: number): AluResult {
  return add(value, 1);
}

/**
 * A - 1, over four bits.
 *
 * Carry out follows the subtraction convention: false when the decrement
 * borrowed, which is exactly when the value wrapped from 0 to 15.
 */
export function decrement(value: number): AluResult {
  return subtract(value, 1);
}

/** A & B. No carry effect: the incoming carry passes through. */
export function and(a: number, b: number, carryIn = false): AluResult {
  return result(a & b, carryIn);
}

/** A | B. No carry effect. */
export function or(a: number, b: number, carryIn = false): AluResult {
  return result(a | b, carryIn);
}

/** A ^ B. No carry effect. */
export function xor(a: number, b: number, carryIn = false): AluResult {
  return result(a ^ b, carryIn);
}

/** ~A over four bits. No carry effect - see isa.ts on COMB and NEGA. */
export function complement(value: number, carryIn = false): AluResult {
  return result(~value, carryIn);
}

/** 0 - A over four bits (two's complement). No carry effect. */
export function negate(value: number, carryIn = false): AluResult {
  return result(NIBBLE_VALUES - (value & NIBBLE_MASK), carryIn);
}

/** Rotate right through carry: bit 0 becomes the carry, the carry becomes bit 3. */
export function rotateRight(value: number, carryIn: boolean): AluResult {
  const nibble = value & NIBBLE_MASK;
  return result((nibble >>> 1) | (carryIn ? 0x08 : 0), (nibble & 0x01) !== 0);
}

/** Rotate left through carry: bit 3 becomes the carry, the carry becomes bit 0. */
export function rotateLeft(value: number, carryIn: boolean): AluResult {
  const nibble = value & NIBBLE_MASK;
  return result((nibble << 1) | (carryIn ? 0x01 : 0), (nibble & 0x08) !== 0);
}

/**
 * Decimal adjust after an addition.
 *
 * A binary nibble add produces a BCD digit unchanged when it stayed below 10 and
 * did not carry; otherwise it is 6 short. Adjusting sets the carry, so the next
 * digit up the score chain receives the decimal carry rather than the binary
 * one.
 */
export function decimalAdjustAdd(value: number, carryIn: boolean): AluResult {
  const nibble = value & NIBBLE_MASK;
  if (!carryIn && nibble <= BCD_MAX_DIGIT) {
    return result(nibble, false);
  }
  return result(nibble + BCD_CORRECTION, true);
}

/**
 * Decimal adjust after a subtraction.
 *
 * Carry 0 means the subtraction borrowed, and a borrow at 16 rather than at 10
 * leaves the digit 6 high; adding 10 over four bits is the same correction. The
 * carry is left as it is - it is the borrow the next digit up must consume.
 */
export function decimalAdjustSubtract(value: number, carryIn: boolean): AluResult {
  const nibble = value & NIBBLE_MASK;
  if (carryIn) {
    return result(nibble, true);
  }
  return result(nibble + (NIBBLE_VALUES - BCD_CORRECTION), false);
}

/** True when `value` is a valid BCD digit. Used by the tests, not by execution. */
export function isBcdDigit(value: number): boolean {
  return (value & NIBBLE_MASK) <= BCD_MAX_DIGIT;
}

/** Bit `index` of a nibble, as 0 or 1. */
export function testBit(value: number, index: number): number {
  return (value >>> index) & 1;
}

/** `value` with bit `index` set. */
export function setBit(value: number, index: number): number {
  return (value | (1 << index)) & NIBBLE_MASK;
}

/** `value` with bit `index` cleared. */
export function clearBit(value: number, index: number): number {
  return value & ~(1 << index) & NIBBLE_MASK;
}
