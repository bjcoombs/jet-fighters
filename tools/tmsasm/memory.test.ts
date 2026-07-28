import { describe, expect, it } from 'vitest';
import {
  LFSR_SEQUENCE,
  lfsrOffset,
  lfsrOrdinal,
  PC_MASK,
  RAM_SIZE,
  RESET_ADDRESS,
  RESET_CHAPTER,
  RESET_ORDINAL,
  RESET_PAGE,
  ROM_CHAPTER_COUNT,
  ROM_PAGE_COUNT,
  ROM_PAGE_SIZE,
  ROM_SIZE,
  romAddress,
  romAddressForOrdinal,
  romChapter,
  romOffset,
  romPage,
  WORD_MASK,
} from './memory.js';

/**
 * The physical execution order, copied verbatim from
 * `docs/research/tms1370-architecture.md` section 2, "The program counter is an
 * LFSR, not a counter", which cites MAME `tms1k_base.cpp:324-337`.
 *
 * The point of holding it here as data is that the ground truth is *external*.
 * A test that regenerated the sequence with the same rule the implementation
 * uses would pass for a rule that produces 62 states as readily as for one that
 * produces 64, and the two are hard to tell apart by eye.
 */
const LFSR_REFERENCE_SEQUENCE: readonly number[] = Object.freeze(
  (
    '00 01 03 07 0F 1F 3F 3E 3D 3B 37 2F 1E 3C 39 33 27 0E 1D 3A 35 2B 16 2C ' +
    '18 30 21 02 05 0B 17 2E 1C 38 31 23 06 0D 1B 36 2D 1A 34 29 12 24 08 11 ' +
    '22 04 09 13 26 0C 19 32 25 0A 15 2A 14 28 10 20'
  )
    .split(' ')
    .map((digits) => Number.parseInt(digits, 16)),
);

describe('the LFSR program counter sequence', () => {
  it('matches the table recorded in docs/research/tms1370-architecture.md', () => {
    expect([...LFSR_SEQUENCE]).toEqual([...LFSR_REFERENCE_SEQUENCE]);
  });

  it('is 64 states long, one per word of a page', () => {
    expect(LFSR_SEQUENCE).toHaveLength(ROM_PAGE_SIZE);
    expect(ROM_PAGE_SIZE).toBe(64);
  });

  it('is a bijection over the 64 physical offsets of a page', () => {
    expect(new Set(LFSR_SEQUENCE).size).toBe(ROM_PAGE_SIZE);
    expect([...LFSR_SEQUENCE].sort((left, right) => left - right)).toEqual(
      Array.from({ length: ROM_PAGE_SIZE }, (_unused, index) => index),
    );
  });

  it('starts at offset 0, so reset enters the first word of its page', () => {
    expect(LFSR_SEQUENCE[0]).toBe(0);
  });

  it('does not lay code down in ordinal order', () => {
    // The whole reason this assembler is not a rename of tools/hmasm.
    const differing = LFSR_SEQUENCE.filter((offset, ordinal) => offset !== ordinal);
    expect(differing.length).toBeGreaterThan(ROM_PAGE_SIZE / 2);
  });

  it('inverts: ordinal -> offset -> ordinal is the identity', () => {
    for (let ordinal = 0; ordinal < ROM_PAGE_SIZE; ordinal += 1) {
      expect(lfsrOrdinal(lfsrOffset(ordinal))).toBe(ordinal);
    }
  });

  it('rejects an ordinal past the end of a page rather than wrapping', () => {
    expect(() => lfsrOffset(ROM_PAGE_SIZE)).toThrow(/outside 0\.\.63/);
    expect(() => lfsrOrdinal(ROM_PAGE_SIZE)).toThrow(/outside 0\.\.63/);
  });
});

describe('ROM geometry', () => {
  it('is 2 chapters of 16 pages of 64 words', () => {
    expect(ROM_CHAPTER_COUNT).toBe(2);
    expect(ROM_PAGE_COUNT).toBe(16);
    expect(ROM_PAGE_SIZE).toBe(64);
    expect(ROM_SIZE).toBe(2048);
  });

  it('holds eight-bit words', () => {
    expect(WORD_MASK).toBe(0xff);
  });

  it('splits an address into chapter, page and offset', () => {
    const address = romAddress(1, 15, 0x3f);
    expect(address).toBe(ROM_SIZE - 1);
    expect(romChapter(address)).toBe(1);
    expect(romPage(address)).toBe(15);
    expect(romOffset(address)).toBe(0x3f);
  });

  it('round-trips every address through its three fields', () => {
    for (let address = 0; address < ROM_SIZE; address += 1) {
      expect(romAddress(romChapter(address), romPage(address), romOffset(address))).toBe(
        address,
      );
    }
  });

  it('places the n-th instruction of a page at the n-th LFSR state', () => {
    expect(romAddressForOrdinal(0, 0, 0)).toBe(0x000);
    expect(romAddressForOrdinal(0, 0, 1)).toBe(0x001);
    expect(romAddressForOrdinal(0, 0, 2)).toBe(0x003);
    expect(romAddressForOrdinal(0, 0, 63)).toBe(0x020);
    expect(romAddressForOrdinal(1, 3, 5)).toBe(romAddress(1, 3, 0x1f));
  });
});

describe('the reset entry point', () => {
  it('is chapter 0, page 15, PC 0', () => {
    expect(RESET_CHAPTER).toBe(0);
    expect(RESET_PAGE).toBe(15);
    expect(RESET_ORDINAL).toBe(0);
    expect(RESET_ADDRESS).toBe(romAddress(0, 15, 0));
    expect(RESET_ADDRESS).toBe(0x3c0);
  });
});

describe('RAM geometry', () => {
  it('is 8 files of 16 nibbles', () => {
    expect(RAM_SIZE).toBe(128);
  });
});

describe('the program counter mask', () => {
  it('is six bits, so a branch operand is a raw LFSR state', () => {
    expect(PC_MASK).toBe(0x3f);
  });
});
