import { describe, it, expect } from 'vitest';
import {
  add,
  and,
  BCD_MAX_DIGIT,
  clearBit,
  complement,
  decimalAdjustAdd,
  decimalAdjustSubtract,
  decrement,
  increment,
  isBcdDigit,
  negate,
  NIBBLE_VALUES,
  or,
  rotateLeft,
  rotateRight,
  setBit,
  subtract,
  testBit,
  xor,
} from './alu.js';
import { NIBBLE_MASK } from './registers.js';

/** Every 4-bit value. */
const NIBBLES = Array.from({ length: NIBBLE_VALUES }, (_unused, value) => value);

describe('alu - add', () => {
  it('adds two nibbles without a carry in', () => {
    expect(add(3, 4)).toEqual({ value: 7, carry: false });
    expect(add(0, 0)).toEqual({ value: 0, carry: false });
  });

  it('carries out of bit 3', () => {
    expect(add(0x0f, 1)).toEqual({ value: 0, carry: true });
    expect(add(0x08, 0x08)).toEqual({ value: 0, carry: true });
    expect(add(0x0f, 0x0f)).toEqual({ value: 0x0e, carry: true });
  });

  it('takes a carry in', () => {
    expect(add(3, 4, true)).toEqual({ value: 8, carry: false });
    expect(add(0x0f, 0, true)).toEqual({ value: 0, carry: true });
  });

  it('stays inside four bits for every input pair', () => {
    for (const a of NIBBLES) {
      for (const b of NIBBLES) {
        for (const carryIn of [false, true]) {
          const { value, carry } = add(a, b, carryIn);
          expect(value).toBe((a + b + (carryIn ? 1 : 0)) & NIBBLE_MASK);
          expect(carry).toBe(a + b + (carryIn ? 1 : 0) > NIBBLE_MASK);
        }
      }
    }
  });
});

describe('alu - subtract', () => {
  it('subtracts with carry as the inverted borrow', () => {
    expect(subtract(5, 3)).toEqual({ value: 2, carry: true });
    expect(subtract(3, 3)).toEqual({ value: 0, carry: true });
  });

  it('clears the carry when the subtraction borrows', () => {
    expect(subtract(3, 5)).toEqual({ value: 0x0e, carry: false });
    expect(subtract(0, 1)).toEqual({ value: 0x0f, carry: false });
  });

  it('consumes an incoming borrow', () => {
    expect(subtract(5, 3, false)).toEqual({ value: 1, carry: true });
    expect(subtract(0, 0, false)).toEqual({ value: 0x0f, carry: false });
  });

  it('agrees with two’s complement arithmetic for every input pair', () => {
    for (const a of NIBBLES) {
      for (const b of NIBBLES) {
        for (const carryIn of [false, true]) {
          const exact = a - b - (carryIn ? 0 : 1);
          const { value, carry } = subtract(a, b, carryIn);
          expect(value).toBe(exact & NIBBLE_MASK);
          expect(carry).toBe(exact >= 0);
        }
      }
    }
  });
});

describe('alu - increment and decrement', () => {
  it('increments, carrying only on the wrap to zero', () => {
    for (const value of NIBBLES) {
      const { value: next, carry } = increment(value);
      expect(next).toBe((value + 1) & NIBBLE_MASK);
      expect(carry).toBe(value === NIBBLE_MASK);
    }
  });

  it('decrements, borrowing only on the wrap to fifteen', () => {
    for (const value of NIBBLES) {
      const { value: next, carry } = decrement(value);
      expect(next).toBe((value - 1) & NIBBLE_MASK);
      expect(carry).toBe(value !== 0);
    }
  });
});

describe('alu - logic', () => {
  it('computes AND, OR and XOR over four bits', () => {
    expect(and(0b1100, 0b1010).value).toBe(0b1000);
    expect(or(0b1100, 0b1010).value).toBe(0b1110);
    expect(xor(0b1100, 0b1010).value).toBe(0b0110);
  });

  it('passes the carry through untouched', () => {
    for (const operation of [and, or, xor]) {
      expect(operation(0b1100, 0b1010, true).carry).toBe(true);
      expect(operation(0b1100, 0b1010, false).carry).toBe(false);
    }
  });

  it('complements and negates within four bits', () => {
    for (const value of NIBBLES) {
      expect(complement(value).value).toBe(~value & NIBBLE_MASK);
      expect(negate(value).value).toBe(-value & NIBBLE_MASK);
    }
    expect(negate(0).value).toBe(0);
    expect(negate(1).value).toBe(0x0f);
    expect(complement(0b1010).value).toBe(0b0101);
  });

  it('leaves the carry alone when complementing or negating', () => {
    expect(complement(5, true).carry).toBe(true);
    expect(negate(5, true).carry).toBe(true);
  });
});

describe('alu - rotates', () => {
  it('rotates right through the carry', () => {
    expect(rotateRight(0b0001, false)).toEqual({ value: 0b0000, carry: true });
    expect(rotateRight(0b0000, true)).toEqual({ value: 0b1000, carry: false });
    expect(rotateRight(0b1011, true)).toEqual({ value: 0b1101, carry: true });
  });

  it('rotates left through the carry', () => {
    expect(rotateLeft(0b1000, false)).toEqual({ value: 0b0000, carry: true });
    expect(rotateLeft(0b0000, true)).toEqual({ value: 0b0001, carry: false });
    expect(rotateLeft(0b1101, true)).toEqual({ value: 0b1011, carry: true });
  });

  it('returns to the start after five rotations of the five-bit ring', () => {
    for (const start of NIBBLES) {
      let value = start;
      let carry = true;
      for (let step = 0; step < 5; step += 1) {
        ({ value, carry } = rotateLeft(value, carry));
      }
      expect(value).toBe(start);
      expect(carry).toBe(true);
    }
  });

  it('undoes a left rotation with a right one', () => {
    for (const start of NIBBLES) {
      for (const carryIn of [false, true]) {
        const left = rotateLeft(start, carryIn);
        expect(rotateRight(left.value, left.carry)).toEqual({ value: start, carry: carryIn });
      }
    }
  });
});

describe('alu - BCD adjust', () => {
  it('leaves a decimal digit alone after an addition that did not carry', () => {
    for (let digit = 0; digit <= BCD_MAX_DIGIT; digit += 1) {
      expect(decimalAdjustAdd(digit, false)).toEqual({ value: digit, carry: false });
    }
  });

  it('corrects a non-decimal nibble and raises the decimal carry', () => {
    expect(decimalAdjustAdd(0x0a, false)).toEqual({ value: 0, carry: true });
    expect(decimalAdjustAdd(0x0f, false)).toEqual({ value: 5, carry: true });
    expect(decimalAdjustAdd(1, true)).toEqual({ value: 7, carry: true });
  });

  it('produces the decimal sum of every pair of digits', () => {
    for (let left = 0; left <= BCD_MAX_DIGIT; left += 1) {
      for (let right = 0; right <= BCD_MAX_DIGIT; right += 1) {
        for (const carryIn of [false, true]) {
          const binary = add(left, right, carryIn);
          const decimal = decimalAdjustAdd(binary.value, binary.carry);
          const exact = left + right + (carryIn ? 1 : 0);

          expect(decimal.value).toBe(exact % 10);
          expect(decimal.carry).toBe(exact >= 10);
          expect(isBcdDigit(decimal.value)).toBe(true);
        }
      }
    }
  });

  it('leaves a digit alone after a subtraction that did not borrow', () => {
    for (let digit = 0; digit <= BCD_MAX_DIGIT; digit += 1) {
      expect(decimalAdjustSubtract(digit, true)).toEqual({ value: digit, carry: true });
    }
  });

  it('produces the decimal difference of every pair of digits', () => {
    for (let left = 0; left <= BCD_MAX_DIGIT; left += 1) {
      for (let right = 0; right <= BCD_MAX_DIGIT; right += 1) {
        for (const carryIn of [false, true]) {
          const binary = subtract(left, right, carryIn);
          const decimal = decimalAdjustSubtract(binary.value, binary.carry);
          const exact = left - right - (carryIn ? 0 : 1);

          expect(decimal.value).toBe(((exact % 10) + 10) % 10);
          expect(decimal.carry).toBe(exact >= 0);
          expect(isBcdDigit(decimal.value)).toBe(true);
        }
      }
    }
  });

  it('carries a three-digit BCD score across its digits', () => {
    // 199 + 1 = 200, the PRD’s score cap arithmetic, least significant first.
    const score = [9, 9, 1];
    const addend = [1, 0, 0];
    let carry = false;
    const total = score.map((digit, index) => {
      const binary = add(digit, addend[index] ?? 0, carry);
      const decimal = decimalAdjustAdd(binary.value, binary.carry);
      carry = decimal.carry;
      return decimal.value;
    });

    expect(total).toEqual([0, 0, 2]);
    expect(carry).toBe(false);
  });
});

describe('alu - bit operations', () => {
  it('reads, sets and clears each bit of a nibble', () => {
    for (let bit = 0; bit < 4; bit += 1) {
      expect(testBit(1 << bit, bit)).toBe(1);
      expect(testBit(~(1 << bit), bit)).toBe(0);
      expect(setBit(0, bit)).toBe(1 << bit);
      expect(clearBit(NIBBLE_MASK, bit)).toBe(NIBBLE_MASK & ~(1 << bit));
    }
  });

  it('leaves the other bits untouched', () => {
    expect(setBit(0b0101, 1)).toBe(0b0111);
    expect(clearBit(0b0101, 0)).toBe(0b0100);
    expect(setBit(0b0101, 0)).toBe(0b0101);
  });
});
