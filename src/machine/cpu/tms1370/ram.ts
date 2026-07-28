// TMS1370 (TMS1100 core) data RAM: 128 four-bit words.
//
// Source: docs/research/tms1370-architecture.md §3 - 512 bits organised as 8
// files of 16 words, addressed only at X:Y, with X selecting the file and Y the
// word. There is no other addressing mode on this core.
//
// This file exists in the register-file task because reset semantics span the
// two: the core's reset does *not* clear RAM (research doc §7), and that is an
// assertion about an object, not about an absence. The execution engine may
// re-home it; nothing here depends on where it lives.

import { NIBBLE_MASK, X_MASK } from './registers.js';

/** Words per RAM file - Y is 4 bits. */
export const RAM_WORDS_PER_FILE = NIBBLE_MASK + 1;

/** RAM files - X is 3 bits. */
export const RAM_FILE_COUNT = X_MASK + 1;

/** 128 four-bit words, 512 bits. */
export const RAM_WORD_COUNT = RAM_FILE_COUNT * RAM_WORDS_PER_FILE;

/** Address width of the RAM, in bits. */
export const RAM_ADDRESS_BITS = 7;

/** 7-bit RAM address mask. */
export const RAM_ADDRESS_MASK = RAM_WORD_COUNT - 1;

/** Bits in a RAM nibble, i.e. the range of the SBIT/RBIT/TBIT index. */
export const RAM_BITS_PER_WORD = 4;

/** Compose the only RAM address this core can form: `X:Y`. */
export function ramAddress(x: number, y: number): number {
  return (((x & X_MASK) << RAM_BITS_PER_WORD) | (y & NIBBLE_MASK)) & RAM_ADDRESS_MASK;
}

/**
 * The 128x4 data RAM.
 *
 * Power-up contents are not established by any source read for this project
 * (research doc §3, "What this does not settle" §3): the safe assumption on a
 * mask-ROM MCU is that they are arbitrary, and that the program clears what it
 * needs. This class models that literally - {@link powerOn} installs a pattern,
 * and {@link reset} is a no-op.
 */
export class Tms1370Ram {
  private readonly cells = new Uint8Array(RAM_WORD_COUNT);

  /** Read the nibble at `X:Y`. */
  read(x: number, y: number): number {
    return this.cells[ramAddress(x, y)] as number;
  }

  /** Write the nibble at `X:Y`. */
  write(x: number, y: number, value: number): void {
    this.cells[ramAddress(x, y)] = value & NIBBLE_MASK;
  }

  /** Read one bit of the nibble at `X:Y`. */
  readBit(x: number, y: number, bit: number): boolean {
    return ((this.read(x, y) >> (bit & 0x03)) & 1) === 1;
  }

  /** Set or reset one bit of the nibble at `X:Y` (the SBIT/RBIT operations). */
  writeBit(x: number, y: number, bit: number, on: boolean): void {
    const mask = 1 << (bit & 0x03);
    const current = this.read(x, y);
    this.write(x, y, on ? current | mask : current & ~mask);
  }

  /**
   * INIT reset: deliberately does nothing.
   *
   * The TMS1100 core clears no RAM on reset (research doc §7). This method
   * exists so that the core's reset path can call it uniformly and so that the
   * "RAM survives reset" property is a test against a real object rather than
   * an argument from a missing call site. Do not make it clear the array: the
   * ROM's own clear routine costs real instruction time before the first
   * display sweep, and hiding that cost hides a power-on garbage flash the
   * hardware actually exhibits.
   */
  reset(): void {
    // Intentionally empty. See the doc comment.
  }

  /**
   * Install a power-on pattern.
   *
   * Power-up contents are unestablished, so this is the seam where a caller
   * chooses a model - all zeroes, a fixed pattern, or noise - instead of the
   * choice being buried in a constructor.
   */
  powerOn(fill: number | ((address: number) => number) = 0): void {
    for (let address = 0; address < RAM_WORD_COUNT; address += 1) {
      const value = typeof fill === 'function' ? fill(address) : fill;
      this.cells[address] = value & NIBBLE_MASK;
    }
  }

  /** Copy of the whole array, for tests and debug tooling. */
  snapshot(): Uint8Array {
    return Uint8Array.from(this.cells);
  }
}
