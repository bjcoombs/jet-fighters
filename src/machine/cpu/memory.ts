// HMCS44 (Hitachi HD38800) memory: (2048 + 128) x 10-bit mask ROM and
// 160 x 4-bit RAM.
//
// Sources: the memory sizes and the split between the 2048-word program region
// and the 128-word pattern/bank region are the documented HD38800 configuration
// summarised in docs/prd/jet-fighters-v2.md (R1). Page geometry (64 pages of 32
// words) follows the v2.1 specification this module is built to.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the machine advances by cycles driven from cpu.ts.

import { NIBBLE_MASK } from './registers.js';

/** 10-bit ROM word mask - HMCS40 opcodes are ten bits wide. */
export const WORD_MASK = 0x3ff;

/** Executable program region: 64 pages x 32 words. */
export const ROM_PROGRAM_SIZE = 2048;

/**
 * Pattern / bank region above the program region.
 *
 * The HD38800 carries 128 extra ten-bit words beyond the 2048-word program
 * space, used for pattern tables read by the table-lookup instructions rather
 * than for execution. Exactly how the family's table instructions address it is
 * not settled by the material we have, so this model only guarantees that the
 * words are readable at their linear addresses; it invents no banking rule.
 */
export const ROM_PATTERN_SIZE = 128;

/** Total addressable ROM words: 2048 program + 128 pattern. */
export const ROM_SIZE = ROM_PROGRAM_SIZE + ROM_PATTERN_SIZE;

/** Words per ROM page - the branch-in-page unit. */
export const ROM_PAGE_SIZE = 32;

/** 5-bit offset within a ROM page. */
export const ROM_OFFSET_MASK = ROM_PAGE_SIZE - 1;

/** Pages covering the program region (2048 / 32). */
export const ROM_PAGE_COUNT = ROM_PROGRAM_SIZE / ROM_PAGE_SIZE;

/** 6-bit page number. */
export const ROM_PAGE_MASK = ROM_PAGE_COUNT - 1;

/** 160 x 4-bit data RAM: 10 files of 16 nibbles. */
export const RAM_SIZE = 160;

/** Nibbles per RAM file - the Y pointer indexes within one file. */
export const RAM_FILE_SIZE = 16;

/** Implemented RAM files: 160 / 16. X selects one of these. */
export const RAM_FILE_COUNT = RAM_SIZE / RAM_FILE_SIZE;

/**
 * Fill pattern standing in for undefined PMOS RAM contents at power-on.
 *
 * The real device's RAM comes up in an undefined state: the cells settle
 * arbitrarily when the 6 V supply arrives, and the game program is expected to
 * clear what it uses. That is genuinely unknown data, not zeroes, so this model
 * refuses to pretend otherwise: it fills with 0b1010, a deterministic value that
 * is *not* zero. A ROM routine that reads a nibble it never wrote therefore sees
 * junk here and would see junk on hardware, and a test that assumes an implicit
 * zero fails loudly instead of passing by luck.
 *
 * The specific value carries no hardware meaning - only "not zero, and stable
 * enough to test against" does.
 */
export const RAM_POWER_ON_FILL = 0x0a;

/** Immutable snapshot of memory state, for tests and debug UIs. */
export interface MemorySnapshot {
  /** All 160 RAM nibbles in address order. */
  readonly ram: readonly number[];
  /** False between power-on and the first `clearRam()`. */
  readonly ramCleared: boolean;
}

/**
 * The HMCS44 memory model.
 *
 * ROM is supplied at construction and is read-only for the life of the object,
 * exactly as a mask ROM is. RAM is mutable, masked to 4 bits on write, and
 * bounds-checked: the device implements 160 nibbles and nothing sensible is
 * documented about addresses beyond them, so this model raises a `RangeError`
 * rather than aliasing them onto real storage and inventing behaviour the
 * hardware may not have.
 *
 * Power semantics follow the real unit, which has no reset button: the power
 * switch cuts the battery, so `powerOff()` invalidates RAM back to the
 * undefined fill and `powerOn()` re-applies it. See PRD R4.
 */
export class Memory {
  private readonly _rom: Uint16Array;
  private readonly _ram = new Uint8Array(RAM_SIZE);
  private _ramCleared = false;

  /**
   * @param rom Exactly `ROM_SIZE` ten-bit words. Values are masked to 10 bits
   *   on read, so an image carrying wider values still behaves like the mask
   *   ROM would; the size, however, must match.
   */
  constructor(rom: ArrayLike<number>) {
    if (rom.length !== ROM_SIZE) {
      throw new RangeError(
        `ROM image must be exactly ${ROM_SIZE} words ` +
          `(${ROM_PROGRAM_SIZE} program + ${ROM_PATTERN_SIZE} pattern), got ${rom.length}`,
      );
    }
    this._rom = Uint16Array.from(rom);
    this.powerOn();
  }

  /** Total ROM words, program plus pattern region. */
  get romSize(): number {
    return ROM_SIZE;
  }

  /** Total RAM nibbles. */
  get ramSize(): number {
    return RAM_SIZE;
  }

  /** False between power-on and the first `clearRam()` - RAM still holds junk. */
  get ramCleared(): boolean {
    return this._ramCleared;
  }

  /**
   * Read a ten-bit ROM word.
   *
   * @throws RangeError if `address` is outside 0..ROM_SIZE-1. The program
   *   counter is 11 bits and cannot reach the pattern region on its own, so an
   *   out-of-range read here is a bug in the caller, not a hardware condition.
   */
  readRom(address: number): number {
    if (!Number.isInteger(address) || address < 0 || address >= ROM_SIZE) {
      throw new RangeError(`ROM address out of range: ${address} (expected 0..${ROM_SIZE - 1})`);
    }
    return (this._rom[address] ?? 0) & WORD_MASK;
  }

  /**
   * Read a RAM nibble.
   *
   * @throws RangeError if `address` is outside 0..RAM_SIZE-1.
   */
  readRam(address: number): number {
    this.assertRamAddress(address);
    return (this._ram[address] ?? 0) & NIBBLE_MASK;
  }

  /**
   * Write a RAM nibble. The value is masked to 4 bits, so callers never have to
   * mask defensively.
   *
   * @throws RangeError if `address` is outside 0..RAM_SIZE-1.
   */
  writeRam(address: number, value: number): void {
    this.assertRamAddress(address);
    this._ram[address] = value & NIBBLE_MASK;
  }

  /**
   * Apply the undefined-RAM fill pattern. Called by the constructor and by the
   * board when the power switch is thrown on.
   */
  powerOn(): void {
    this._ram.fill(RAM_POWER_ON_FILL);
    this._ramCleared = false;
  }

  /**
   * Cut the supply: RAM contents die. On the real unit this is the only reset
   * path there is - the switch disconnects the battery (PRD R4).
   */
  powerOff(): void {
    this.powerOn();
  }

  /**
   * Zero every nibble, modelling the ROM's own power-on clear loop. Distinct
   * from `powerOn()`, which restores the undefined pattern.
   */
  clearRam(): void {
    this._ram.fill(0);
    this._ramCleared = true;
  }

  /**
   * Combine the RAM pointers into a linear RAM address.
   *
   * X selects one of the 10 implemented 16-nibble files and Y the nibble within
   * it, so the address is `(x << 4) | y`. Both pointers are 6 bits wide in the
   * register file, but only their low 4 bits participate in addressing.
   *
   * X values 10..15 select files the HD38800 does not implement. What the real
   * device returns there is not documented in the material we have, so the
   * address is returned as computed (160..255) and the subsequent `readRam` /
   * `writeRam` raises - the unimplemented case is surfaced, not guessed at.
   */
  getEffectiveRamAddress(x: number, y: number): number {
    return ((x & NIBBLE_MASK) << 4) | (y & NIBBLE_MASK);
  }

  /** True when `address` names one of the 160 implemented nibbles. */
  isImplementedRamAddress(address: number): boolean {
    return Number.isInteger(address) && address >= 0 && address < RAM_SIZE;
  }

  /** Immutable snapshot for tests and future debug tooling. */
  snapshot(): MemorySnapshot {
    return {
      ram: Array.from(this._ram),
      ramCleared: this._ramCleared,
    };
  }

  private assertRamAddress(address: number): void {
    if (!this.isImplementedRamAddress(address)) {
      throw new RangeError(`RAM address out of range: ${address} (expected 0..${RAM_SIZE - 1})`);
    }
  }
}

/**
 * Compose a ROM address from a 6-bit page and a 5-bit in-page offset.
 *
 * Instruction fetch is linear across the program region, but branch targets are
 * page-relative: a BR immediate supplies an offset and inherits the current
 * page, so reaching another page needs a long call or jump.
 */
export function romAddress(page: number, offset: number): number {
  return ((page & ROM_PAGE_MASK) << 5) | (offset & ROM_OFFSET_MASK);
}

/** The 6-bit page a program-region address falls in. */
export function romPage(address: number): number {
  return (address >>> 5) & ROM_PAGE_MASK;
}

/** The 5-bit offset of a program-region address within its page. */
export function romOffset(address: number): number {
  return address & ROM_OFFSET_MASK;
}

/**
 * True when stepping from `from` to `to` leaves the current ROM page.
 *
 * Used by instruction fetch: the word after the last word of a page belongs to
 * the next page, which matters for page-relative branch targets and for the
 * assembler's overflow checks (PRD R2).
 */
export function crossesPageBoundary(from: number, to: number): boolean {
  return romPage(from) !== romPage(to);
}
