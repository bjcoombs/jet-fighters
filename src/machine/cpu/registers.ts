// HMCS44 (Hitachi HD38800) register file.
//
// Sources: the register set (A, B, X/SPX, Y/SPY, carry, status, 4-level stack)
// is the documented HMCS40-family architecture as summarised in
// docs/prd/jet-fighters-v2.md (R1). Field widths follow the v2.1 specification:
// 4-bit accumulators, 6-bit RAM pointers, 11-bit program counter.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the machine advances by cycles driven from cpu.ts.

/** 4-bit value mask - accumulators A and B, RAM nibbles, most immediates. */
export const NIBBLE_MASK = 0x0f;

/** 6-bit value mask - the RAM pointers X and Y and their shadows SPX/SPY. */
export const POINTER_MASK = 0x3f;

/** 11-bit program counter mask: (2048 + 128) x 10-bit ROM needs 12 bits of
 *  address space in total, but the executable region is the low 2048 words. */
export const PC_MASK = 0x7ff;

/** Number of addresses the program counter cycles through before wrapping. */
export const PC_SIZE = PC_MASK + 1;

/** The HMCS40 family has a fixed four-level subroutine stack (no RAM stack). */
export const STACK_DEPTH = 4;

/** Immutable snapshot of the register file, for tests and debug UIs. */
export interface RegisterSnapshot {
  readonly a: number;
  readonly b: number;
  readonly x: number;
  readonly y: number;
  readonly spx: number;
  readonly spy: number;
  readonly carry: boolean;
  readonly status: number;
  readonly pc: number;
  /** Current stack depth, 0 to STACK_DEPTH. */
  readonly stackPointer: number;
  /** The four stack slots in physical slot order, not push order. */
  readonly stack: readonly number[];
  /** Count of pushes that overwrote a live return address since reset. */
  readonly stackOverflows: number;
  /** Count of pops taken while the stack was empty since reset. */
  readonly stackUnderflows: number;
}

/**
 * The HMCS44 register file.
 *
 * All writes mask to the hardware field width, so callers never have to mask
 * defensively: `regs.a = 0x1f` stores 0x0f, exactly as the 4-bit accumulator
 * would.
 *
 * Stack behaviour (explicit, per the v2.1 specification): the real device has a
 * 2-bit stack pointer driving four fixed registers, so it *wraps* rather than
 * faulting. This model reproduces that:
 *
 * - Overflow: a fifth consecutive push overwrites the oldest return address and
 *   increments `stackOverflows`. The array never grows.
 * - Underflow: popping an empty stack returns the stale contents of the slot the
 *   pointer wrapped onto (0 after `reset()`, since reset clears the slots) and
 *   increments `stackUnderflows`.
 *
 * Neither case throws: on hardware a runaway call chain corrupts return
 * addresses, it does not halt the CPU, and the ROM under test must be able to
 * exhibit that. The counters exist so tests and the future debugger can assert
 * on the condition instead of inferring it.
 */
export class Registers {
  private _a = 0;
  private _b = 0;
  private _x = 0;
  private _y = 0;
  private _spx = 0;
  private _spy = 0;
  private _status = 1;
  private _pc = 0;

  /** ALU carry / borrow flag. */
  carry = false;

  private readonly _stack = new Uint16Array(STACK_DEPTH);
  /** 2-bit write index, exactly as the hardware stack pointer wraps. */
  private _slot = 0;
  private _depth = 0;
  private _overflows = 0;
  private _underflows = 0;

  constructor() {
    this.reset();
  }

  /** 4-bit accumulator A. */
  get a(): number {
    return this._a;
  }
  set a(value: number) {
    this._a = value & NIBBLE_MASK;
  }

  /** 4-bit accumulator B. */
  get b(): number {
    return this._b;
  }
  set b(value: number) {
    this._b = value & NIBBLE_MASK;
  }

  /** 6-bit RAM pointer X (the W:X concatenation of the databook). */
  get x(): number {
    return this._x;
  }
  set x(value: number) {
    this._x = value & POINTER_MASK;
  }

  /** 6-bit RAM pointer Y. */
  get y(): number {
    return this._y;
  }
  set y(value: number) {
    this._y = value & POINTER_MASK;
  }

  /** 6-bit shadow of X, exchanged by `swapXY()`. */
  get spx(): number {
    return this._spx;
  }
  set spx(value: number) {
    this._spx = value & POINTER_MASK;
  }

  /** 6-bit shadow of Y, exchanged by `swapXY()`. */
  get spy(): number {
    return this._spy;
  }
  set spy(value: number) {
    this._spy = value & POINTER_MASK;
  }

  /**
   * 1-bit status flag ST.
   *
   * On the HMCS40 family ST gates conditional branches: BR/CAL execute only
   * when ST is 1, and ST returns to 1 once the branch decision has been taken.
   * See decoder.ts / cpu.ts for the execution side of that rule.
   */
  get status(): number {
    return this._status;
  }
  set status(value: number) {
    this._status = value & 1;
  }

  /** 11-bit program counter. */
  get pc(): number {
    return this._pc;
  }
  set pc(value: number) {
    this._pc = value & PC_MASK;
  }

  /** Current stack depth, 0 to STACK_DEPTH (saturates at STACK_DEPTH). */
  get stackPointer(): number {
    return this._depth;
  }

  /** Pushes that overwrote a live return address since reset. */
  get stackOverflows(): number {
    return this._overflows;
  }

  /** Pops taken while the stack was empty since reset. */
  get stackUnderflows(): number {
    return this._underflows;
  }

  /**
   * Power-on / reset state.
   *
   * Registers clear, PC goes to 0, and the stack slots clear. ST resets to 1 so
   * the first conditional branch after reset is taken - the databook's
   * documented power-on value for the status flag.
   */
  reset(): void {
    this._a = 0;
    this._b = 0;
    this._x = 0;
    this._y = 0;
    this._spx = 0;
    this._spy = 0;
    this.carry = false;
    this._status = 1;
    this._pc = 0;
    this._stack.fill(0);
    this._slot = 0;
    this._depth = 0;
    this._overflows = 0;
    this._underflows = 0;
  }

  /** Advance the program counter by one word, wrapping at 2048. */
  incrementPc(): void {
    this._pc = (this._pc + 1) & PC_MASK;
  }

  /** Push an 11-bit return address, wrapping over the oldest entry when full. */
  push(address: number): void {
    if (this._depth === STACK_DEPTH) {
      this._overflows += 1;
    } else {
      this._depth += 1;
    }
    this._stack[this._slot] = address & PC_MASK;
    this._slot = (this._slot + 1) % STACK_DEPTH;
  }

  /**
   * Pop an 11-bit return address.
   *
   * Popping an empty stack is not an error: the pointer wraps and the stale slot
   * contents are returned (0 after reset). `stackUnderflows` records it.
   */
  pop(): number {
    if (this._depth === 0) {
      this._underflows += 1;
    } else {
      this._depth -= 1;
    }
    this._slot = (this._slot + STACK_DEPTH - 1) % STACK_DEPTH;
    return this._stack[this._slot] ?? 0;
  }

  /** Exchange X with SPX and Y with SPY (the databook's XSP operation). */
  swapXY(): void {
    const x = this._x;
    const y = this._y;
    this._x = this._spx;
    this._y = this._spy;
    this._spx = x;
    this._spy = y;
  }

  /** Immutable snapshot for tests, `CPUState`, and future debug tooling. */
  snapshot(): RegisterSnapshot {
    return {
      a: this._a,
      b: this._b,
      x: this._x,
      y: this._y,
      spx: this._spx,
      spy: this._spy,
      carry: this.carry,
      status: this._status,
      pc: this._pc,
      stackPointer: this._depth,
      stack: Array.from(this._stack),
      stackOverflows: this._overflows,
      stackUnderflows: this._underflows,
    };
  }
}
