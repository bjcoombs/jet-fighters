import { describe, it, expect } from 'vitest';
import { PC_SIZE, Registers, STACK_DEPTH } from './registers.js';

describe('Registers - field widths', () => {
  it('masks accumulators A and B to 4 bits', () => {
    const regs = new Registers();
    regs.a = 0x1f;
    regs.b = 0xff;
    expect(regs.a).toBe(0x0f);
    expect(regs.b).toBe(0x0f);
  });

  it('keeps in-range accumulator values untouched', () => {
    const regs = new Registers();
    for (let value = 0; value <= 0x0f; value += 1) {
      regs.a = value;
      expect(regs.a).toBe(value);
    }
  });

  it('masks the RAM pointers and their shadows to 6 bits', () => {
    const regs = new Registers();
    regs.x = 0xff;
    regs.y = 0x40;
    regs.spx = 0x3f;
    regs.spy = 0x7e;
    expect(regs.x).toBe(0x3f);
    expect(regs.y).toBe(0x00);
    expect(regs.spx).toBe(0x3f);
    expect(regs.spy).toBe(0x3e);
  });

  it('masks the status flag to 1 bit', () => {
    const regs = new Registers();
    regs.status = 0x0e;
    expect(regs.status).toBe(0);
    regs.status = 0x0f;
    expect(regs.status).toBe(1);
  });

  it('masks the program counter to 11 bits', () => {
    const regs = new Registers();
    regs.pc = 0xfff;
    expect(regs.pc).toBe(0x7ff);
  });

  it('wraps the program counter at 2048', () => {
    const regs = new Registers();
    regs.pc = PC_SIZE - 1;
    expect(regs.pc).toBe(2047);
    regs.incrementPc();
    expect(regs.pc).toBe(0);
  });

  it('increments the program counter word by word', () => {
    const regs = new Registers();
    regs.pc = 0x100;
    regs.incrementPc();
    regs.incrementPc();
    expect(regs.pc).toBe(0x102);
  });
});

describe('Registers - call stack', () => {
  it('pushes and pops across all four levels in LIFO order', () => {
    const regs = new Registers();
    const addresses = [0x010, 0x123, 0x400, 0x7ff];

    addresses.forEach((address, index) => {
      regs.push(address);
      expect(regs.stackPointer).toBe(index + 1);
    });
    expect(regs.stackPointer).toBe(STACK_DEPTH);

    for (let i = addresses.length - 1; i >= 0; i -= 1) {
      expect(regs.pop()).toBe(addresses[i]);
      expect(regs.stackPointer).toBe(i);
    }
  });

  it('masks pushed addresses to 11 bits', () => {
    const regs = new Registers();
    regs.push(0xfff);
    expect(regs.pop()).toBe(0x7ff);
  });

  it('wraps on overflow, overwriting the oldest entry rather than growing', () => {
    const regs = new Registers();
    for (const address of [1, 2, 3, 4]) {
      regs.push(address);
    }
    regs.push(5);

    expect(regs.stackPointer).toBe(STACK_DEPTH);
    expect(regs.stackOverflows).toBe(1);
    expect(regs.snapshot().stack).toHaveLength(STACK_DEPTH);
    // 5 landed in the slot that held 1; 2, 3 and 4 are still intact beneath it.
    expect(regs.pop()).toBe(5);
    expect(regs.pop()).toBe(4);
    expect(regs.pop()).toBe(3);
    expect(regs.pop()).toBe(2);
  });

  it('counts underflow and returns the stale slot instead of throwing', () => {
    const regs = new Registers();
    expect(regs.pop()).toBe(0);
    expect(regs.stackUnderflows).toBe(1);
    expect(regs.stackPointer).toBe(0);
  });

  it('recovers to normal LIFO behaviour after an underflow', () => {
    const regs = new Registers();
    regs.pop();
    regs.push(0x321);
    expect(regs.pop()).toBe(0x321);
    expect(regs.stackPointer).toBe(0);
  });
});

describe('Registers - swapXY', () => {
  it('exchanges X/Y with SPX/SPY', () => {
    const regs = new Registers();
    regs.x = 0x0a;
    regs.y = 0x05;
    regs.spx = 0x30;
    regs.spy = 0x21;

    regs.swapXY();

    expect(regs.x).toBe(0x30);
    expect(regs.y).toBe(0x21);
    expect(regs.spx).toBe(0x0a);
    expect(regs.spy).toBe(0x05);
  });

  it('is its own inverse', () => {
    const regs = new Registers();
    regs.x = 0x11;
    regs.y = 0x22 & 0x3f;
    regs.spx = 0x33;
    regs.spy = 0x04;
    const before = regs.snapshot();

    regs.swapXY();
    regs.swapXY();

    const after = regs.snapshot();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.spx).toBe(before.spx);
    expect(after.spy).toBe(before.spy);
  });
});

describe('Registers - reset', () => {
  it('clears every field, the stack, and the fault counters', () => {
    const regs = new Registers();
    regs.a = 0x0f;
    regs.b = 0x0c;
    regs.x = 0x3f;
    regs.y = 0x3f;
    regs.spx = 0x11;
    regs.spy = 0x22 & 0x3f;
    regs.carry = true;
    regs.status = 0;
    regs.pc = 0x123;
    regs.push(0x400);
    regs.pop();
    regs.pop();

    regs.reset();

    const state = regs.snapshot();
    expect(state).toMatchObject({
      a: 0,
      b: 0,
      x: 0,
      y: 0,
      spx: 0,
      spy: 0,
      carry: false,
      pc: 0,
      stackPointer: 0,
      stackOverflows: 0,
      stackUnderflows: 0,
    });
    expect(state.stack).toEqual([0, 0, 0, 0]);
  });

  it('leaves the status flag set so the first conditional branch is taken', () => {
    const regs = new Registers();
    regs.status = 0;
    regs.reset();
    expect(regs.status).toBe(1);
  });
});

describe('Registers - snapshot', () => {
  it('is a copy, not a live view of the register file', () => {
    const regs = new Registers();
    regs.a = 3;
    const snapshot = regs.snapshot();
    regs.a = 7;
    expect(snapshot.a).toBe(3);
  });
});
