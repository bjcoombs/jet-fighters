import { describe, expect, it } from 'vitest';

import {
  ROM_ADDRESS_MASK,
  ROM_CHAPTER_COUNT,
  ROM_FILL_WORD,
  ROM_PAGES_PER_CHAPTER,
  ROM_WORD_MASK,
  ROM_WORDS_PER_PAGE,
  romAddressParts,
  Tms1370Rom,
} from './memory.js';
import {
  RESET_CHAPTER,
  RESET_PAGE,
  RESET_PC,
  RESET_ROM_ADDRESS,
  ROM_WORD_COUNT,
  romAddress,
} from './registers.js';

describe('TMS1370 program ROM', () => {
  it('is 2048 words of 8 bits, as 2 chapters x 16 pages x 64 words', () => {
    expect(ROM_WORD_COUNT).toBe(2048);
    expect(ROM_CHAPTER_COUNT * ROM_PAGES_PER_CHAPTER * ROM_WORDS_PER_PAGE).toBe(ROM_WORD_COUNT);
    expect(ROM_WORD_MASK).toBe(0xff);
    expect(new Tms1370Rom().snapshot()).toHaveLength(ROM_WORD_COUNT);
  });

  it('reads back an image loaded at address 0', () => {
    const rom = new Tms1370Rom([0x12, 0x34, 0x56]);
    expect(rom.read(0)).toBe(0x12);
    expect(rom.read(1)).toBe(0x34);
    expect(rom.read(2)).toBe(0x56);
    expect(rom.read(3)).toBe(ROM_FILL_WORD);
  });

  it('addresses a word as CA:PA:PC, through the register file composition', () => {
    const rom = new Tms1370Rom();
    rom.writeAt(RESET_CHAPTER, RESET_PAGE, RESET_PC, 0xa5);
    expect(rom.read(RESET_ROM_ADDRESS)).toBe(0xa5);
    expect(rom.readAt(RESET_CHAPTER, RESET_PAGE, RESET_PC)).toBe(0xa5);
    // Page 15 of chapter 0 is 64 words from the end of the chapter, not
    // address 0 - the reset entry point the research document names.
    expect(RESET_ROM_ADDRESS).toBe(0x3c0);
  });

  it('decomposes an address back into chapter, page and program counter', () => {
    for (const [chapter, page, pc] of [
      [0, 0, 0],
      [0, 15, 0],
      [1, 0, 63],
      [1, 15, 63],
      [1, 9, 42],
    ] as const) {
      expect(romAddressParts(romAddress(chapter, page, pc))).toEqual({ chapter, page, pc });
    }
  });

  it('masks a word to 8 bits and an address into the space', () => {
    const rom = new Tms1370Rom();
    rom.writeAt(1, 15, 63, 0x1ff);
    expect(rom.read(ROM_WORD_COUNT - 1)).toBe(0xff);
    expect(rom.read(ROM_WORD_COUNT)).toBe(rom.read(0));
    expect(ROM_ADDRESS_MASK).toBe(ROM_WORD_COUNT - 1);
  });

  it('rejects an image that overflows 2048 words rather than truncating it', () => {
    // 2048 words is a hardware ceiling. A program that does not fit is a build
    // error, not something to negotiate at run time.
    const rom = new Tms1370Rom();
    expect(() => rom.load(new Uint8Array(ROM_WORD_COUNT + 1))).toThrow(/overflows 2048 words/);
    expect(() => rom.load(new Uint8Array(2), ROM_WORD_COUNT - 1)).toThrow(/overflows/);
    expect(() => rom.load(new Uint8Array(ROM_WORD_COUNT))).not.toThrow();
  });

  it('clears back to the fill word', () => {
    const rom = new Tms1370Rom([0x11, 0x22]);
    rom.clear();
    expect(rom.snapshot().every((word) => word === ROM_FILL_WORD)).toBe(true);
  });
});
