// TMS1370 (TMS1100 core) register file.
//
// Widths and reset behaviour follow docs/research/tms1370-architecture.md §1,
// §2, §4 and §7: 8 O pins, 16 R pins, a 6-bit LFSR program counter, a 3-bit X
// register, one level of subroutine return, 2048x8 ROM as 2 chapters x 16 pages
// x 64 words, and 128x4 RAM addressed at X:Y.
//
// Nothing here is copied from MAME. The LFSR table is *generated* from the
// shift rule below; registers.test.ts cross-checks the generated table against
// the 64 states the research document transcribes, and asserts the table is a
// bijection over its state space. A sequential program counter cannot satisfy
// that pair.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the machine advances by cycles driven from the execution engine.

/** Width of a nibble in bits - the accumulator's contribution to the O index. */
const NIBBLE_WIDTH = 4;

/** 4-bit value mask - the accumulator A, the Y register, RAM nibbles. */
export const NIBBLE_MASK = (1 << NIBBLE_WIDTH) - 1;

/**
 * 3-bit value mask for the X register.
 *
 * This is the TMS1100 core's width and the single most load-bearing difference
 * from the 4-bit RAM pointers of the v2 core this replaces: X selects one of
 * eight 16-nibble RAM files (research doc §3).
 */
export const X_MASK = 0x07;

/** Width of the program counter, in bits. */
export const PC_BITS = 6;

/** 6-bit program counter mask - one page is 64 words. */
export const PC_MASK = (1 << PC_BITS) - 1;

/** Number of distinct program-counter states, i.e. words per page. */
export const PC_STATE_COUNT = PC_MASK + 1;

/** Width of the page address and page buffer, in bits. */
export const PAGE_BITS = 4;

/** 4-bit page mask - 16 pages per chapter. */
export const PAGE_MASK = (1 << PAGE_BITS) - 1;

/** 1-bit chapter mask - 2 chapters of 1024 words. */
export const CHAPTER_MASK = 0x01;

/** Total ROM address width: chapter + page + program counter. */
export const ROM_ADDRESS_BITS = 1 + PAGE_BITS + PC_BITS;

/** 2048 eight-bit instruction words. */
export const ROM_WORD_COUNT = 1 << ROM_ADDRESS_BITS;

/**
 * Mask of the subroutine return register SR.
 *
 * SR holds the return *word* only - six bits, one level. The return *page* is
 * held in PB, which doubles as the return page while the call latch is set
 * (research doc §2, §4; TI Dec 1976 §2.2). There is no deeper stack: a CALL
 * taken inside a subroutine overwrites nothing and saves nothing.
 */
export const SR_MASK = PC_MASK;

/** The 40-pin part latches 16 R outputs individually. */
export const R_OUTPUT_COUNT = 16;

/** Mask of the R output latch word. */
export const R_MASK = (1 << R_OUTPUT_COUNT) - 1;

/**
 * Width of the O register index: the status latch supplies a fifth bit above
 * the accumulator (research doc §4). The output PLA decodes 32 index values to
 * 8 O lines; the decode itself is the I/O layer's business, not this file's.
 */
export const O_INDEX_BITS = 5;

/** Mask of the O register index, `statusLatch << 4 | A`. */
export const O_INDEX_MASK = (1 << O_INDEX_BITS) - 1;

/** Reset enters chapter 0 (research doc §7). */
export const RESET_CHAPTER = 0;

/** Reset enters page 15 - 64 words from the end of chapter 0, not address 0. */
export const RESET_PAGE = PAGE_MASK;

/** Reset enters at program-counter state 0. */
export const RESET_PC = 0;

/**
 * Compose a physical ROM address from chapter, page and program counter.
 *
 * `bit: 10 | 9 8 7 6 | 5 4 3 2 1 0`
 * `      CA | P A     | P C`
 */
export function romAddress(chapter: number, page: number, pc: number): number {
  return (
    ((chapter & CHAPTER_MASK) << (PAGE_BITS + PC_BITS)) |
    ((page & PAGE_MASK) << PC_BITS) |
    (pc & PC_MASK)
  );
}

/**
 * The address the first instruction after reset is fetched from.
 *
 * Derived from the reset chapter/page/PC rather than written as a literal, so
 * the 0x3C0 the research document names is a test assertion about this
 * composition and not a second copy of it.
 */
export const RESET_ROM_ADDRESS = romAddress(RESET_CHAPTER, RESET_PAGE, RESET_PC);

/**
 * Advance the 6-bit LFSR program counter by one word.
 *
 * The program counter is a linear-feedback shift register, not a counter
 * (research doc §2). Feedback is the XNOR of the top two bits, shifted in at
 * the bottom. That recurrence on its own has a fixed point at all-ones and a
 * cycle one state short of the full space, so the two seam states are forced:
 * all-ones shifts a 0 in, and the state below it shifts a 1 in. The result
 * visits all 64 states of a page exactly once before repeating.
 */
export function stepProgramCounter(pc: number): number {
  const state = pc & PC_MASK;
  const top = (state >> (PC_BITS - 1)) & 1;
  const next = (state >> (PC_BITS - 2)) & 1;
  let feedback = top === next ? 1 : 0;

  if (state === PC_MASK >> 1) {
    feedback = 1;
  } else if (state === PC_MASK) {
    feedback = 0;
  }

  return ((state << 1) | feedback) & PC_MASK;
}

function buildLfsrSequence(): number[] {
  const sequence: number[] = [];
  let pc = RESET_PC;
  for (let i = 0; i < PC_STATE_COUNT; i += 1) {
    sequence.push(pc);
    pc = stepProgramCounter(pc);
  }
  return sequence;
}

function buildLfsrOrdinals(sequence: readonly number[]): number[] {
  const ordinals = new Array<number>(PC_STATE_COUNT).fill(-1);
  sequence.forEach((state, ordinal) => {
    ordinals[state] = ordinal;
  });
  // The inverse only exists if the forward walk is a bijection. Failing here at
  // import time is the point: a program counter that revisits a state cannot
  // address a page, and every consumer of these tables would silently mis-place
  // code rather than fault.
  const missing = ordinals.indexOf(-1);
  if (missing !== -1) {
    throw new Error(
      `TMS1370 program-counter LFSR is not a bijection: state 0x${missing
        .toString(16)
        .padStart(2, '0')} is never reached`,
    );
  }
  return ordinals;
}

/**
 * The 64 LFSR states in execution order.
 *
 * `LFSR_SEQUENCE[n]` is the *physical* word offset within a page holding the
 * n-th instruction of that page. The assembler places code at these offsets and
 * a disassembler walks them; a branch operand is a state, not an ordinal
 * (research doc §2).
 */
export const LFSR_SEQUENCE: readonly number[] = Object.freeze(buildLfsrSequence());

/**
 * The inverse of {@link LFSR_SEQUENCE}: `LFSR_ORDINALS[state]` is the position
 * of that physical offset in execution order.
 */
export const LFSR_ORDINALS: readonly number[] = Object.freeze(buildLfsrOrdinals(LFSR_SEQUENCE));

/** Physical word offset of the n-th instruction of a page. */
export function pcForOrdinal(ordinal: number): number {
  return LFSR_SEQUENCE[ordinal & PC_MASK] as number;
}

/** Position in execution order of a physical word offset. */
export function ordinalForPc(pc: number): number {
  return LFSR_ORDINALS[pc & PC_MASK] as number;
}

/** Immutable snapshot of the register file, for tests and debug UIs. */
export interface Tms1370RegisterSnapshot {
  /** 4-bit accumulator. */
  readonly a: number;
  /** 3-bit RAM file address. */
  readonly x: number;
  /** 4-bit RAM word address, ALU operand, and R-output index. */
  readonly y: number;
  /** 1-bit condition flag. */
  readonly status: number;
  /** 1-bit latched status, the fifth bit of the O register index. */
  readonly statusLatch: number;
  /** 1-bit call latch: set while inside a subroutine. */
  readonly callLatch: number;
  /** 4-bit current page. */
  readonly pa: number;
  /** 4-bit page buffer; also the return page while `callLatch` is set. */
  readonly pb: number;
  /** 1-bit current chapter. */
  readonly ca: number;
  /** 1-bit chapter buffer. */
  readonly cb: number;
  /** 6-bit LFSR program counter. */
  readonly pc: number;
  /** 6-bit subroutine return word - one level only. */
  readonly sr: number;
  /** 1-bit chapter subroutine latch, saved and restored with SR. */
  readonly cs: number;
  /** The 16 R output latches as a bit field, R0 in bit 0. */
  readonly r: number;
  /** Physical ROM address currently addressed: `CA:PA:PC`. */
  readonly romAddress: number;
}

/**
 * The TMS1370 register file.
 *
 * All writes mask to the hardware field width, so callers never have to mask
 * defensively: `regs.x = 0x0f` stores 0x07, exactly as the 3-bit X register
 * would.
 *
 * Reset is the INIT pin, and it is deliberately narrow (research doc §7): it
 * enters chapter 0 page 15 PC 0, clears the R latches, writes the O register
 * with index 0, clears status and the call latch - and touches no RAM. The
 * 128-nibble RAM is a separate object for exactly that reason; see
 * `ram.ts`, whose `reset()` is a no-op by construction.
 */
export class Tms1370Registers {
  private _a = 0;
  private _x = 0;
  private _y = 0;
  private _status = 0;
  private _statusLatch = 0;
  private _callLatch = 0;
  private _pa = RESET_PAGE;
  private _pb = RESET_PAGE;
  private _ca = RESET_CHAPTER;
  private _cb = RESET_CHAPTER;
  private _pc = RESET_PC;
  private _sr = 0;
  private _cs = 0;
  private _r = 0;

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

  /** 3-bit RAM file address X. */
  get x(): number {
    return this._x;
  }
  set x(value: number) {
    this._x = value & X_MASK;
  }

  /** 4-bit RAM word address Y. */
  get y(): number {
    return this._y;
  }
  set y(value: number) {
    this._y = value & NIBBLE_MASK;
  }

  /**
   * 1-bit condition flag.
   *
   * Driven to 1 at the start of every instruction and cleared only by the
   * instruction itself; a branch or call is taken when it is 1. The execution
   * engine owns that per-instruction reset - this file only holds the bit.
   */
  get status(): number {
    return this._status;
  }
  set status(value: number) {
    this._status = value & 1;
  }

  /** 1-bit status latch SL, loaded by the STSL microinstruction. */
  get statusLatch(): number {
    return this._statusLatch;
  }
  set statusLatch(value: number) {
    this._statusLatch = value & 1;
  }

  /** 1-bit call latch CL: set by a taken CALL, cleared by RETN. */
  get callLatch(): number {
    return this._callLatch;
  }
  set callLatch(value: number) {
    this._callLatch = value & 1;
  }

  /** True while executing inside a subroutine. */
  get inSubroutine(): boolean {
    return this._callLatch === 1;
  }

  /** 4-bit page address PA. */
  get pa(): number {
    return this._pa;
  }
  set pa(value: number) {
    this._pa = value & PAGE_MASK;
  }

  /**
   * 4-bit page buffer PB.
   *
   * Loaded by LDP, and transferred into PA on a branch or call taken outside a
   * subroutine. While the call latch is set it holds the *return* page instead
   * - see {@link returnPage}. The two roles are the same four bits of silicon,
   * which is why LDP inside a subroutine destroys the return page.
   */
  get pb(): number {
    return this._pb;
  }
  set pb(value: number) {
    this._pb = value & PAGE_MASK;
  }

  /**
   * The page a RETN will return to, or `null` when not inside a subroutine.
   *
   * There is no separate register: this reads PB.
   */
  get returnPage(): number | null {
    return this._callLatch === 1 ? this._pb : null;
  }

  /** 1-bit chapter address CA. */
  get ca(): number {
    return this._ca;
  }
  set ca(value: number) {
    this._ca = value & CHAPTER_MASK;
  }

  /** 1-bit chapter buffer CB, complemented by COMC. */
  get cb(): number {
    return this._cb;
  }
  set cb(value: number) {
    this._cb = value & CHAPTER_MASK;
  }

  /** 6-bit LFSR program counter. */
  get pc(): number {
    return this._pc;
  }
  set pc(value: number) {
    this._pc = value & PC_MASK;
  }

  /** 6-bit subroutine return word SR - one level, no stack. */
  get sr(): number {
    return this._sr;
  }
  set sr(value: number) {
    this._sr = value & SR_MASK;
  }

  /** 1-bit chapter subroutine latch CS. */
  get cs(): number {
    return this._cs;
  }
  set cs(value: number) {
    this._cs = value & CHAPTER_MASK;
  }

  /** The 16 R output latches as a bit field, R0 in bit 0. */
  get r(): number {
    return this._r;
  }
  set r(value: number) {
    this._r = value & R_MASK;
  }

  /** The 5-bit O register index, `statusLatch << 4 | A`. */
  get oIndex(): number {
    return ((this._statusLatch << NIBBLE_WIDTH) | this._a) & O_INDEX_MASK;
  }

  /** Physical ROM address currently addressed: `CA:PA:PC`. */
  get romAddress(): number {
    return romAddress(this._ca, this._pa, this._pc);
  }

  /** State of one R output latch. */
  getR(index: number): boolean {
    if (index < 0 || index >= R_OUTPUT_COUNT) {
      return false;
    }
    return ((this._r >> index) & 1) === 1;
  }

  /** Set or reset one R output latch. Out-of-range indices are ignored. */
  setR(index: number, on: boolean): void {
    if (index < 0 || index >= R_OUTPUT_COUNT) {
      return;
    }
    if (on) {
      this._r = (this._r | (1 << index)) & R_MASK;
    } else {
      this._r = this._r & ~(1 << index) & R_MASK;
    }
  }

  /**
   * Power-on / INIT reset.
   *
   * Chapter 0, page 15, PC 0 - physical address {@link RESET_ROM_ADDRESS}. R
   * outputs clear, status 0, status latch 0 (so the O register is written with
   * index 0), call latch clear. RAM is *not* touched: the register file holds
   * none, and the RAM object's own reset is a documented no-op.
   */
  reset(): void {
    this._a = 0;
    this._x = 0;
    this._y = 0;
    this._status = 0;
    this._statusLatch = 0;
    this._callLatch = 0;
    this._pa = RESET_PAGE;
    this._pb = RESET_PAGE;
    this._ca = RESET_CHAPTER;
    this._cb = RESET_CHAPTER;
    this._pc = RESET_PC;
    this._sr = 0;
    this._cs = 0;
    this._r = 0;
  }

  /** Advance the program counter one word along the LFSR sequence. */
  stepPc(): void {
    this._pc = stepProgramCounter(this._pc);
  }

  /**
   * Save the one level of subroutine return state: the return word into SR, the
   * chapter into CS, and set the call latch.
   *
   * Returns `false` and changes nothing when the call latch is already set - a
   * CALL taken inside a subroutine saves no return address (research doc §2).
   * That is the one-level stack expressed as a capability: there is no second
   * slot to write, so nesting silently loses the outer return address rather
   * than overflowing.
   *
   * The return *page* is not stored here. The caller sets PB to the page being
   * left, which is where RETN reads it from.
   */
  saveReturnState(returnPc: number): boolean {
    if (this._callLatch === 1) {
      return false;
    }
    this._sr = returnPc & SR_MASK;
    this._cs = this._ca;
    this._callLatch = 1;
    return true;
  }

  /**
   * Restore PC from SR and CA from CS, and clear the call latch.
   *
   * Returns `false` and changes nothing when the call latch is clear - RETN
   * outside a subroutine restores no program counter (research doc §2). The
   * `PA = PB` transfer RETN also performs happens either way and belongs to the
   * execution engine, not here.
   */
  restoreReturnState(): boolean {
    if (this._callLatch === 0) {
      return false;
    }
    this._pc = this._sr & PC_MASK;
    this._ca = this._cs & CHAPTER_MASK;
    this._callLatch = 0;
    return true;
  }

  /** Immutable snapshot for tests and future debug tooling. */
  snapshot(): Tms1370RegisterSnapshot {
    return {
      a: this._a,
      x: this._x,
      y: this._y,
      status: this._status,
      statusLatch: this._statusLatch,
      callLatch: this._callLatch,
      pa: this._pa,
      pb: this._pb,
      ca: this._ca,
      cb: this._cb,
      pc: this._pc,
      sr: this._sr,
      cs: this._cs,
      r: this._r,
      romAddress: this.romAddress,
    };
  }
}
