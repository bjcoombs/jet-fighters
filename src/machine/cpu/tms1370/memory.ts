// TMS1370 program memory: 2048 eight-bit instruction words.
//
// Source: docs/research/tms1370-architecture.md §2 - 2048 words of 8 bits,
// organised as 2 chapters x 16 pages x 64 words, with the physical address
// composed `CA:PA:PC` (S1 `tms1k_base.cpp:620`, S3 §3.1/§3.2). Both facts are
// stated by MAME *and* by TI, which makes them the safest claims in the research
// document.
//
// The address composition itself is not restated here: `romAddress()` in
// registers.ts is the one place it lives, and this module calls it. The RAM half
// of the memory model is likewise not restated - `Tms1370Ram` in ram.ts is the
// only data RAM, and the execution engine composes the two.
//
// One instruction is one word. There are no multi-word instructions on this core
// (S3 §2.8), so a ROM image is a flat byte array and the program counter's LFSR
// order is what makes it non-obvious - not any variable-length encoding.
//
// Pure state only: no DOM, no timers, no Web APIs.

import {
  CHAPTER_MASK,
  PAGE_BITS,
  PAGE_MASK,
  PC_BITS,
  PC_MASK,
  PC_STATE_COUNT,
  ROM_WORD_COUNT,
  romAddress,
} from './registers.js';

/** 8-bit instruction words. */
export const ROM_WORD_BITS = 8;

/** Mask of one ROM word. */
export const ROM_WORD_MASK = (1 << ROM_WORD_BITS) - 1;

/** Words in one page: the program counter's whole state space. */
export const ROM_WORDS_PER_PAGE = PC_STATE_COUNT;

/** Pages in one chapter. */
export const ROM_PAGES_PER_CHAPTER = PAGE_MASK + 1;

/** Chapters in the address space. */
export const ROM_CHAPTER_COUNT = CHAPTER_MASK + 1;

/** 11-bit ROM address mask. */
export const ROM_ADDRESS_MASK = ROM_WORD_COUNT - 1;

/**
 * The word an unprogrammed mask position reads as.
 *
 * A mask ROM has no erased state the way a EPROM does - every bit is fixed at
 * fabrication - so this is a modelling choice for the words our own image does
 * not fill, not a claim about silicon. Zero decodes to `MNEA`, a status-only
 * instruction with no side effect, which makes a runaway program counter walk
 * quietly rather than write outputs. Nothing in the research document settles
 * what the real MP2110 holds in unused words.
 */
export const ROM_FILL_WORD = 0x00;

/**
 * The 2048x8 program ROM.
 *
 * Read-only to the running machine by construction: {@link load} is how an image
 * gets in, and there is no per-word write. A TMS1100-family part cannot write
 * its own program memory, and modelling that as an absent method rather than as
 * a guard means no instruction can be added later that would.
 */
export class Tms1370Rom {
  private readonly words = new Uint8Array(ROM_WORD_COUNT).fill(ROM_FILL_WORD);

  constructor(image?: ArrayLike<number>) {
    if (image !== undefined) {
      this.load(image);
    }
  }

  /**
   * Install a program image, starting at physical address 0.
   *
   * Throws on an over-long image rather than truncating: a program that does not
   * fit is a build error, and 2048 words is a hardware ceiling that cannot be
   * negotiated at run time.
   */
  load(image: ArrayLike<number>, startAddress = 0): void {
    const start = startAddress & ROM_ADDRESS_MASK;
    if (start + image.length > ROM_WORD_COUNT) {
      throw new Error(
        `TMS1370 ROM image of ${image.length} words at 0x${start.toString(16)} ` +
          `overflows ${ROM_WORD_COUNT} words`,
      );
    }
    for (let offset = 0; offset < image.length; offset += 1) {
      this.words[start + offset] = (image[offset] as number) & ROM_WORD_MASK;
    }
  }

  /** Read the word at a physical 11-bit address. */
  read(address: number): number {
    return this.words[address & ROM_ADDRESS_MASK] as number;
  }

  /** Read the word the machine addresses as `CA:PA:PC`. */
  readAt(chapter: number, page: number, pc: number): number {
    return this.read(romAddress(chapter, page, pc));
  }

  /** Write one word of the image, by physical address. Image authoring only. */
  writeAt(chapter: number, page: number, pc: number, word: number): void {
    this.words[romAddress(chapter, page, pc)] = word & ROM_WORD_MASK;
  }

  /** Restore every word to {@link ROM_FILL_WORD}. Image authoring only. */
  clear(): void {
    this.words.fill(ROM_FILL_WORD);
  }

  /** Copy of the whole image, for tests and debug tooling. */
  snapshot(): Uint8Array {
    return Uint8Array.from(this.words);
  }
}

/**
 * Split a physical ROM address back into chapter, page and program counter.
 *
 * The inverse of `romAddress()`, used by listings and debug tooling. Kept here
 * rather than in registers.ts because nothing the running machine does needs it:
 * the machine composes addresses, it never decomposes them.
 */
export function romAddressParts(address: number): {
  chapter: number;
  page: number;
  pc: number;
} {
  const masked = address & ROM_ADDRESS_MASK;
  return {
    chapter: (masked >> (PAGE_BITS + PC_BITS)) & CHAPTER_MASK,
    page: (masked >> PC_BITS) & PAGE_MASK,
    pc: masked & PC_MASK,
  };
}
