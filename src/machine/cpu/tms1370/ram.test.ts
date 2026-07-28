import { describe, expect, it } from 'vitest';

import {
  RAM_ADDRESS_BITS,
  RAM_FILE_COUNT,
  RAM_WORDS_PER_FILE,
  RAM_WORD_COUNT,
  Tms1370Ram,
  ramAddress,
} from './ram.js';
import { Tms1370Registers } from './registers.js';

/**
 * A power-on pattern with no zero nibbles anywhere.
 *
 * Every value is 1-15, so "RAM was cleared" and "RAM survived" cannot be
 * confused with each other at any address: a cleared array has 128 zeroes and
 * this one has none.
 */
const NONZERO_POWER_ON = (address: number): number => (address % 15) + 1;

describe('TMS1370 RAM geometry', () => {
  it('is 8 files of 16 words - 128 nibbles, 512 bits', () => {
    expect(RAM_FILE_COUNT).toBe(8);
    expect(RAM_WORDS_PER_FILE).toBe(16);
    expect(RAM_WORD_COUNT).toBe(128);
    expect(RAM_ADDRESS_BITS).toBe(7);
  });

  it('addresses only at X:Y', () => {
    expect(ramAddress(0, 0)).toBe(0);
    expect(ramAddress(0, 15)).toBe(15);
    expect(ramAddress(1, 0)).toBe(16);
    expect(ramAddress(7, 15)).toBe(127);
  });

  it('masks X to three bits and Y to four', () => {
    expect(ramAddress(0x0f, 0x1f)).toBe(ramAddress(0x07, 0x0f));
    expect(ramAddress(0x08, 0x10)).toBe(ramAddress(0x00, 0x00));
  });

  it('reaches all 128 words across the X:Y space and no more', () => {
    const reached = new Set<number>();
    for (let x = 0; x < RAM_FILE_COUNT; x += 1) {
      for (let y = 0; y < RAM_WORDS_PER_FILE; y += 1) {
        reached.add(ramAddress(x, y));
      }
    }
    expect(reached.size).toBe(RAM_WORD_COUNT);
  });
});

describe('TMS1370 RAM access', () => {
  it('stores four bits per word', () => {
    const ram = new Tms1370Ram();
    ram.write(3, 5, 0x1f);
    expect(ram.read(3, 5)).toBe(0x0f);
  });

  it('keeps files independent', () => {
    const ram = new Tms1370Ram();
    ram.powerOn(0);
    ram.write(0, 5, 0x0a);
    expect(ram.read(1, 5)).toBe(0);
    expect(ram.read(0, 6)).toBe(0);
    expect(ram.read(0, 5)).toBe(0x0a);
  });

  it('sets, resets and tests individual bits', () => {
    const ram = new Tms1370Ram();
    ram.powerOn(0);
    for (let bit = 0; bit < 4; bit += 1) {
      ram.writeBit(2, 9, bit, true);
      expect(ram.readBit(2, 9, bit)).toBe(true);
      expect(ram.read(2, 9)).toBe(1 << bit);
      ram.writeBit(2, 9, bit, false);
      expect(ram.readBit(2, 9, bit)).toBe(false);
      expect(ram.read(2, 9)).toBe(0);
    }
  });

  it('installs a power-on pattern', () => {
    const ram = new Tms1370Ram();
    ram.powerOn(NONZERO_POWER_ON);
    for (let address = 0; address < RAM_WORD_COUNT; address += 1) {
      expect(ram.snapshot()[address]).toBe(NONZERO_POWER_ON(address));
    }
  });

  it('hands out copies, not the live array', () => {
    const ram = new Tms1370Ram();
    const before = ram.snapshot();
    ram.write(0, 0, 0x0f);
    expect(before[0]).toBe(0);
  });
});

describe('TMS1370 reset does not clear RAM', () => {
  it('leaves every nibble untouched across a core reset', () => {
    // The TMS1100 core clears no RAM at reset (research doc §7): the ROM's own
    // clear routine does that, and it costs real instruction time before the
    // first display sweep. A reset that helpfully zeroed 128 nibbles would hide
    // a power-on garbage flash the hardware actually exhibits, and no test
    // above the machine layer can see the difference.
    const ram = new Tms1370Ram();
    const registers = new Tms1370Registers();
    ram.powerOn(NONZERO_POWER_ON);
    const before = ram.snapshot();

    registers.reset();
    ram.reset();

    expect(ram.snapshot()).toEqual(before);
    expect(Array.from(ram.snapshot()).filter((nibble) => nibble === 0)).toHaveLength(0);
  });

  it('survives repeated resets', () => {
    const ram = new Tms1370Ram();
    ram.powerOn(NONZERO_POWER_ON);
    const before = ram.snapshot();
    for (let count = 0; count < 4; count += 1) {
      ram.reset();
    }
    expect(ram.snapshot()).toEqual(before);
  });

  it('is cleared only by an explicit power-on, never by reset', () => {
    const ram = new Tms1370Ram();
    ram.powerOn(NONZERO_POWER_ON);
    ram.reset();
    expect(ram.read(0, 0)).not.toBe(0);
    ram.powerOn(0);
    expect(ram.read(0, 0)).toBe(0);
  });
});
