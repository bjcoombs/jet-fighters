import { describe, it, expect } from 'vitest';
import {
  crossesPageBoundary,
  Memory,
  RAM_FILE_COUNT,
  RAM_FILE_SIZE,
  RAM_POWER_ON_FILL,
  RAM_SIZE,
  ROM_PAGE_COUNT,
  ROM_PAGE_SIZE,
  ROM_PROGRAM_SIZE,
  ROM_SIZE,
  romAddress,
  romOffset,
  romPage,
} from './memory.js';

/** A ROM image whose every word encodes its own address, masked to 10 bits. */
function identityRom(): Uint16Array {
  const rom = new Uint16Array(ROM_SIZE);
  for (let address = 0; address < ROM_SIZE; address += 1) {
    rom[address] = address & 0x3ff;
  }
  return rom;
}

describe('Memory - ROM', () => {
  it('reads the first, last program and last pattern words', () => {
    const rom = identityRom();
    rom[0] = 0x123;
    rom[ROM_PROGRAM_SIZE - 1] = 0x2ab;
    rom[ROM_SIZE - 1] = 0x3ff;
    const memory = new Memory(rom);

    expect(memory.readRom(0)).toBe(0x123);
    expect(memory.readRom(2047)).toBe(0x2ab);
    expect(memory.readRom(2175)).toBe(0x3ff);
  });

  it('masks oversized image words to 10 bits', () => {
    const rom = new Uint16Array(ROM_SIZE);
    rom[5] = 0xfff;
    rom[6] = 0x400;
    const memory = new Memory(rom);

    expect(memory.readRom(5)).toBe(0x3ff);
    expect(memory.readRom(6)).toBe(0x000);
  });

  it('rejects addresses outside the ROM', () => {
    const memory = new Memory(identityRom());
    expect(() => memory.readRom(-1)).toThrow(RangeError);
    expect(() => memory.readRom(ROM_SIZE)).toThrow(RangeError);
    expect(() => memory.readRom(1.5)).toThrow(RangeError);
  });

  it('is a copy of the supplied image, not a live view of it', () => {
    const rom = identityRom();
    const memory = new Memory(rom);
    rom[10] = 0x3ff;
    expect(memory.readRom(10)).toBe(10);
  });

  it('accepts a plain array as well as a typed array', () => {
    const memory = new Memory(new Array<number>(ROM_SIZE).fill(0x201));
    expect(memory.readRom(0)).toBe(0x201);
    expect(memory.romSize).toBe(ROM_SIZE);
  });
});

describe('Memory - ROM size validation', () => {
  it('rejects an undersized image', () => {
    expect(() => new Memory(new Uint16Array(ROM_PROGRAM_SIZE))).toThrow(RangeError);
  });

  it('rejects an oversized image', () => {
    expect(() => new Memory(new Uint16Array(ROM_SIZE + 1))).toThrow(RangeError);
  });

  it('names both the expected and the actual size in the error', () => {
    expect(() => new Memory(new Uint16Array(4))).toThrow(/2176.*got 4/s);
  });

  it('accepts an image of exactly 2176 words', () => {
    expect(() => new Memory(new Uint16Array(ROM_SIZE))).not.toThrow();
  });
});

describe('Memory - RAM', () => {
  it('reads and writes at both bounds', () => {
    const memory = new Memory(identityRom());
    memory.writeRam(0, 0x0a);
    memory.writeRam(RAM_SIZE - 1, 0x05);

    expect(memory.readRam(0)).toBe(0x0a);
    expect(memory.readRam(159)).toBe(0x05);
    expect(memory.ramSize).toBe(160);
  });

  it('masks writes to 4 bits', () => {
    const memory = new Memory(identityRom());
    memory.writeRam(32, 0xff);
    expect(memory.readRam(32)).toBe(0x0f);
  });

  it('keeps in-range nibble values untouched', () => {
    const memory = new Memory(identityRom());
    for (let value = 0; value <= 0x0f; value += 1) {
      memory.writeRam(7, value);
      expect(memory.readRam(7)).toBe(value);
    }
  });

  it('rejects addresses outside the implemented 160 nibbles', () => {
    const memory = new Memory(identityRom());
    expect(() => memory.readRam(-1)).toThrow(RangeError);
    expect(() => memory.readRam(RAM_SIZE)).toThrow(RangeError);
    expect(() => memory.writeRam(RAM_SIZE, 0)).toThrow(RangeError);
    expect(() => memory.writeRam(255, 0)).toThrow(RangeError);
  });

  it('reports which addresses are implemented', () => {
    const memory = new Memory(identityRom());
    expect(memory.isImplementedRamAddress(0)).toBe(true);
    expect(memory.isImplementedRamAddress(159)).toBe(true);
    expect(memory.isImplementedRamAddress(160)).toBe(false);
  });

  it('leaves every nibble independent', () => {
    const memory = new Memory(identityRom());
    memory.clearRam();
    memory.writeRam(80, 0x0f);
    expect(memory.readRam(79)).toBe(0);
    expect(memory.readRam(81)).toBe(0);
  });
});

describe('Memory - power-on RAM state', () => {
  it('comes up holding the undefined fill pattern, not zeroes', () => {
    const memory = new Memory(identityRom());
    expect(RAM_POWER_ON_FILL).not.toBe(0);
    expect(memory.readRam(0)).toBe(RAM_POWER_ON_FILL);
    expect(memory.readRam(159)).toBe(RAM_POWER_ON_FILL);
    expect(memory.ramCleared).toBe(false);
  });

  it('zeroes every nibble once the program clears RAM', () => {
    const memory = new Memory(identityRom());
    memory.clearRam();
    expect(memory.snapshot().ram).toEqual(new Array<number>(RAM_SIZE).fill(0));
    expect(memory.ramCleared).toBe(true);
  });

  it('invalidates RAM on power-off - the unit has no other reset', () => {
    const memory = new Memory(identityRom());
    memory.clearRam();
    memory.writeRam(12, 0x07);

    memory.powerOff();

    expect(memory.readRam(12)).toBe(RAM_POWER_ON_FILL);
    expect(memory.ramCleared).toBe(false);
  });

  it('leaves ROM intact across a power cycle', () => {
    const memory = new Memory(identityRom());
    memory.powerOff();
    memory.powerOn();
    expect(memory.readRom(0x100)).toBe(0x100);
  });

  it('snapshots RAM as a copy, not a live view', () => {
    const memory = new Memory(identityRom());
    memory.clearRam();
    const snapshot = memory.snapshot();
    memory.writeRam(3, 0x09);
    expect(snapshot.ram[3]).toBe(0);
  });
});

describe('Memory - effective RAM address', () => {
  it('combines X as the file and Y as the nibble within it', () => {
    const memory = new Memory(identityRom());
    expect(memory.getEffectiveRamAddress(0, 0)).toBe(0);
    expect(memory.getEffectiveRamAddress(0, 15)).toBe(15);
    expect(memory.getEffectiveRamAddress(1, 0)).toBe(16);
    expect(memory.getEffectiveRamAddress(9, 15)).toBe(159);
  });

  it('uses only the low 4 bits of each 6-bit pointer', () => {
    const memory = new Memory(identityRom());
    // 0x39 = 0b111001: the high pointer bits must not leak into the address.
    expect(memory.getEffectiveRamAddress(0x39, 0x35)).toBe(memory.getEffectiveRamAddress(9, 5));
  });

  it('covers all 160 implemented nibbles exactly once', () => {
    const memory = new Memory(identityRom());
    const seen = new Set<number>();
    for (let file = 0; file < RAM_FILE_COUNT; file += 1) {
      for (let nibble = 0; nibble < RAM_FILE_SIZE; nibble += 1) {
        seen.add(memory.getEffectiveRamAddress(file, nibble));
      }
    }
    expect(seen.size).toBe(RAM_SIZE);
    expect(Math.max(...seen)).toBe(RAM_SIZE - 1);
  });

  it('surfaces unimplemented files rather than aliasing them', () => {
    const memory = new Memory(identityRom());
    const address = memory.getEffectiveRamAddress(10, 0);
    expect(address).toBe(160);
    expect(memory.isImplementedRamAddress(address)).toBe(false);
    expect(() => memory.readRam(address)).toThrow(RangeError);
  });

  it('round-trips through read and write', () => {
    const memory = new Memory(identityRom());
    memory.clearRam();
    const address = memory.getEffectiveRamAddress(5, 12);
    memory.writeRam(address, 0x0c);
    expect(memory.readRam(memory.getEffectiveRamAddress(5, 12))).toBe(0x0c);
    expect(address).toBe(5 * RAM_FILE_SIZE + 12);
  });
});

describe('Memory - ROM page addressing', () => {
  it('composes (page << 5) | offset', () => {
    expect(romAddress(0, 0)).toBe(0);
    expect(romAddress(0, 31)).toBe(31);
    expect(romAddress(1, 0)).toBe(32);
    expect(romAddress(63, 31)).toBe(ROM_PROGRAM_SIZE - 1);
  });

  it('masks the page to 6 bits and the offset to 5', () => {
    expect(romAddress(64, 0)).toBe(0);
    expect(romAddress(0, 32)).toBe(0);
    expect(romAddress(0xff, 0xff)).toBe(ROM_PROGRAM_SIZE - 1);
  });

  it('decomposes an address back into page and offset', () => {
    for (const address of [0, 31, 32, 1000, 2047]) {
      expect(romAddress(romPage(address), romOffset(address))).toBe(address);
    }
    expect(romPage(1000)).toBe(31);
    expect(romOffset(1000)).toBe(8);
  });

  it('covers the whole program region with 64 pages of 32 words', () => {
    expect(ROM_PAGE_COUNT * ROM_PAGE_SIZE).toBe(ROM_PROGRAM_SIZE);
  });

  it('detects the page boundary between the last and first word of a page', () => {
    expect(crossesPageBoundary(30, 31)).toBe(false);
    expect(crossesPageBoundary(31, 32)).toBe(true);
    expect(crossesPageBoundary(32, 63)).toBe(false);
    expect(crossesPageBoundary(63, 64)).toBe(true);
  });

  it('reads every word of a page through composed addresses', () => {
    const memory = new Memory(identityRom());
    for (let offset = 0; offset < ROM_PAGE_SIZE; offset += 1) {
      const address = romAddress(4, offset);
      expect(memory.readRom(address)).toBe(address & 0x3ff);
      expect(romPage(address)).toBe(4);
    }
  });
});
