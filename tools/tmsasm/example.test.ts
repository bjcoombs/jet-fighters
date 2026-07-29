// End-to-end proof against a real file on disk. Paths in this file are relative
// to the repository root.
//
// The acceptance contract's V1 driver runs
//
//     npx vite-node tools/tmsasm/cli.ts asm/jetfighter.asm --listing /tmp/jf.lst
//
// and reads the listing. This suite drives the same code path over
// `tools/tmsasm/fixtures/demo.asm` and asserts every conjunct of V1 that does
// not depend on the size of the real game program, so a fault in the listing,
// the CLI or the page allocator is caught by a fixture that exercises every
// directive rather than by whatever the game happens to contain. What it
// deliberately does not assert is the >= 200 word floor: that is a claim about
// the ROM, and a fixture padded to clear it would be a fixture lying on the
// ROM's behalf.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, type AssemblyResult } from './assembler.js';
import {
  formatListing,
  LISTING_COLUMNS,
  LISTING_KEYS,
  LISTING_SEPARATOR,
  romImage,
} from './output.js';
import { RAM_SIZE, RESET_ADDRESS, ROM_SIZE, WORD_MASK } from './memory.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/demo.asm', import.meta.url));

/**
 * The fixture `.INCLUDE`s `asm/opla.inc.asm`, so it needs the same file reader
 * the CLI supplies. The assembler itself stays pure and takes one as an option.
 */
const readInclude = (included: string, fromFile: string) => {
  const resolved = resolve(dirname(fromFile), included);
  return { file: resolved, source: readFileSync(resolved, 'utf8') };
};

const result: AssemblyResult = assemble(readFileSync(FIXTURE, 'utf8'), FIXTURE, { readInclude });
const listing = formatListing(result);

/** The value of a `; Key: value` summary line. */
function summaryValue(key: string): string {
  const match = new RegExp(`^; ${key}: (.*)$`, 'm').exec(listing);
  expect(match, `listing has no '${key}' summary field`).not.toBeNull();
  return (match as RegExpExecArray)[1] as string;
}

/** Every assembled-word row of the listing, split into columns. */
function rows(): string[][] {
  return listing
    .split('\n')
    .filter((line) => line.startsWith('$'))
    .map((line) => line.trimEnd().split(LISTING_SEPARATOR));
}

/** The value of one column of one row. */
function column(row: string[], name: string): string {
  return (row[LISTING_COLUMNS.indexOf(name)] ?? '').trim();
}

describe('the fixture assembles', () => {
  it('without error', () => {
    expect(result.words.length).toBeGreaterThan(0);
  });

  it('into a ROM image of the right size', () => {
    expect(romImage(result)).toHaveLength(ROM_SIZE);
  });

  it('with the reset routine at chapter 0, page 15, word 0', () => {
    expect(result.resetVectorPresent).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === 'reset')?.value).toBe(RESET_ADDRESS);
  });
});

describe('the listing satisfies V1', () => {
  it('reports the program-region word count as a named summary field', () => {
    const words = /^(\d+) of (\d+)$/.exec(summaryValue(LISTING_KEYS.programWords));
    expect(words).not.toBeNull();
    expect(Number((words as RegExpExecArray)[1])).toBe(result.words.length);
    expect(Number((words as RegExpExecArray)[2])).toBe(ROM_SIZE);
  });

  it('reports the RAM high-water mark as a named summary field', () => {
    const ram = /^(\d+) of (\d+) nibbles/.exec(summaryValue(LISTING_KEYS.ramHighWater));
    expect(ram).not.toBeNull();
    expect(Number((ram as RegExpExecArray)[1])).toBeLessThanOrEqual(RAM_SIZE);
    expect(Number((ram as RegExpExecArray)[2])).toBe(RAM_SIZE);
  });

  it('stays inside the 2048-word ceiling', () => {
    expect(result.words.length).toBeLessThanOrEqual(ROM_SIZE);
    expect(result.highestAddress).toBeLessThan(ROM_SIZE);
  });

  it('holds an eight-bit value in every emitted word', () => {
    for (const row of rows()) {
      const word = Number.parseInt(column(row, 'WORD').replace('$', ''), 16);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(WORD_MASK);
    }
    for (const word of result.words) {
      expect(word.word).toBeLessThanOrEqual(WORD_MASK);
    }
  });

  it('prints both the ordinal within the page and the emitted physical offset', () => {
    const listed = rows();
    expect(listed.length).toBeGreaterThan(0);
    for (const row of listed) {
      expect(column(row, 'ORD')).toMatch(/^\d+$/);
      expect(column(row, 'OFF')).toMatch(/^\$[0-9A-F]{2}$/);
    }
  });

  it('shows at least one page where the two orders differ', () => {
    const differingPages = new Set(
      rows()
        .filter((row) => {
          const ordinal = Number.parseInt(column(row, 'ORD'), 10);
          const offset = Number.parseInt(column(row, 'OFF').replace('$', ''), 16);
          return ordinal !== offset;
        })
        .map((row) => `${column(row, 'CH')}:${column(row, 'PG')}`),
    );
    expect(differingPages.size).toBeGreaterThan(0);
  });

  it('would fail that conjunct if the assembler laid code down sequentially', () => {
    // The negative case, stated so the assertion above is visibly armed: a
    // sequential assembler emits offset === ordinal on every row, which is
    // exactly the set this filter would come back empty for.
    const sequential = rows().every(
      (row) =>
        Number.parseInt(column(row, 'ORD'), 10) ===
        Number.parseInt(column(row, 'OFF').replace('$', ''), 16),
    );
    expect(sequential).toBe(false);
  });
});

describe('the fixture exercises the directive set', () => {
  it('declares O PLA slots, slot 0 dark', () => {
    expect(result.oplaEntries.length).toBeGreaterThan(0);
    expect(result.opla[0]).toBe(0);
    expect(result.opla).toHaveLength(32);
  });

  it('places code on more than one page', () => {
    expect(new Set(result.words.map((word) => `${word.chapter}:${word.page}`)).size).toBeGreaterThan(
      1,
    );
  });

  it('emits .DB text one word per character, wherever the LFSR put them', () => {
    expect(result.symbols.find((symbol) => symbol.name === 'name')).toBeDefined();
    // "JET" - three words, at whatever physical offsets the LFSR gave them.
    const letters = result.words.filter((word) => [0x4a, 0x45, 0x54].includes(word.word));
    expect(letters).toHaveLength(3);
  });

  it('resolves a forward branch to a label defined later in the file', () => {
    const call = result.instructions.find((entry) => entry.mnemonic === 'CALL');
    const step = result.symbols.find((symbol) => symbol.name === 'step')?.value;
    expect(call?.target).toBe(step);
  });
});
