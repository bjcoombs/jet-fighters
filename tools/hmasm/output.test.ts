import { describe, it, expect } from 'vitest';
import { assemble } from './assembler.js';
import {
  formatListing,
  formatSummary,
  formatSymbolTable,
  LISTING_KEYS,
  romImage,
} from './output.js';
import { Memory, RAM_SIZE, ROM_SIZE } from '../../src/machine/cpu/memory.js';
import { decode, encode } from '../../src/machine/cpu/decoder.js';
import { InstructionType } from '../../src/machine/cpu/instruction.js';

/** Assemble a fragment under the name the artefacts quote. */
function build(source: string) {
  return assemble(source, 'jetfighter.asm');
}

/** The value of one summary key, as the build gate's regular expression sees it. */
function summaryValue(listing: string, key: string): string {
  const match = new RegExp(`^; ${key}: (.*)$`, 'm').exec(listing);
  expect(match, key).not.toBeNull();
  return (match?.[1] ?? '').trim();
}

describe('romImage', () => {
  it('is exactly the ROM size Memory demands, so it needs no reshaping', () => {
    const image = romImage(build('NOP\n'));
    expect(image).toBeInstanceOf(Uint16Array);
    expect(image).toHaveLength(ROM_SIZE);
    expect(() => new Memory(image)).not.toThrow();
  });

  it('places each word at its own address', () => {
    const image = romImage(build('.ORG $100\nLAI 5\nLBI 6\n'));
    expect(image[0x100]).toBe(encode(InstructionType.LAI, 5));
    expect(image[0x101]).toBe(encode(InstructionType.LBI, 6));
  });

  it('leaves unwritten cells at zero, which the CPU decodes as NOP', () => {
    const image = romImage(build('.ORG $100\nLAI 5\n'));
    expect(image[0]).toBe(0);
    expect(decode(image[0] as number).type).toBe(InstructionType.NOP);
  });

  it('carries pattern-region words above the program region', () => {
    const image = romImage(build('.PATTERN 1\n.DW $3FF\n'));
    expect(image[2048 + 16]).toBe(0x3ff);
  });

  it('holds only ten-bit values', () => {
    const image = romImage(build('.DW $3FF, 0, 512\n'));
    for (const word of image) {
      expect(word).toBeLessThanOrEqual(0x3ff);
    }
  });
});

describe('formatSummary - the numbers a build gate reads', () => {
  it('reports the word count, the highest address and the RAM high-water mark', () => {
    const summary = formatSummary(build('.EQU RAM_SCORE, 32\nLXI 1\nLAI 5\n'));
    expect(summaryValue(summary, LISTING_KEYS.words)).toBe('2');
    expect(summaryValue(summary, LISTING_KEYS.highestAddress)).toBe('1 ($001)');
    expect(summaryValue(summary, LISTING_KEYS.ramHighWater)).toBe(
      `33 of ${RAM_SIZE} nibbles (static, from LXI and RAM_ constants)`,
    );
  });

  it('gives the highest address in decimal first, so a regex can read it', () => {
    const summary = formatSummary(build('.ORG $7FF\nNOP\n'));
    expect(/^; Highest address: (\d+) \(\$7FF\)$/m.exec(summary)?.[1]).toBe('2047');
  });

  it('names the source file it assembled', () => {
    expect(formatSummary(build('NOP\n'))).toMatch(/^; hmasm listing for jetfighter\.asm$/m);
  });

  it('says so plainly when nothing was assembled', () => {
    const summary = formatSummary(build('; only a comment\n'));
    expect(summaryValue(summary, LISTING_KEYS.words)).toBe('0');
    expect(summaryValue(summary, LISTING_KEYS.highestAddress)).toBe('none - nothing was assembled');
  });
});

describe('formatListing - address | opcode hex | source line', () => {
  it('writes one row per assembled word', () => {
    const listing = formatListing(build('main:   LAI 5   ; go\n'), { symbols: false });
    expect(listing).toContain('$000 | $045 | main:   LAI 5   ; go');
  });

  it('leaves the source column blank on a continuation word', () => {
    const rows = formatListing(build('CALL $10\n'), { symbols: false })
      .split('\n')
      .filter((line) => line.startsWith('$'));
    expect(rows).toEqual(['$000 | $2A0 | CALL $10', '$001 | $010 |']);
  });

  it('separates discontinuous runs with a blank line', () => {
    const listing = formatListing(build('NOP\n.ORG $10\nNOP\n'), { symbols: false });
    expect(listing).toContain('$000 | $000 | NOP\n\n$010 | $000 | NOP');
  });

  it('keeps a contiguous run unbroken', () => {
    const listing = formatListing(build('NOP\nNOP\n'), { symbols: false });
    expect(listing).toContain('$000 | $000 | NOP\n$001 | $000 | NOP');
  });

  it('quotes a line from an included file at the address it landed', () => {
    const result = assemble('.INCLUDE "tail.asm"\n', 'main.asm', {
      readInclude: (path) => ({ file: path, source: '  LBI 2\n' }),
    });
    expect(formatListing(result, { symbols: false })).toContain('$000 | $052 |   LBI 2');
  });

  it('appends the symbol table by default and omits it on request', () => {
    const result = build('main:\nNOP\n');
    expect(formatListing(result)).toContain('; Symbols');
    expect(formatListing(result, { symbols: false })).not.toContain('; Symbols');
  });

  it('ends with a newline, as a text file should', () => {
    expect(formatListing(build('NOP\n')).endsWith('\n')).toBe(true);
  });
});

describe('formatSymbolTable', () => {
  it('sorts by name and aligns the columns', () => {
    const table = formatSymbolTable(build('.EQU SPEED, 3\nmain:\nNOP\nzz:\nNOP\n'));
    expect(table.split('\n')).toEqual([
      '; Symbols',
      '; SPEED | CONSTANT | $003 (3)',
      '; main  | LABEL    | $000',
      '; zz    | LABEL    | $001',
    ]);
  });

  it('gives a constant its decimal value alongside the hexadecimal one', () => {
    expect(formatSymbolTable(build('.EQU SPEED, 10\nNOP\n'))).toContain('$00A (10)');
  });

  it('says so when the program defined no symbols', () => {
    expect(formatSymbolTable(build('NOP\n'))).toBe('; Symbols: none');
  });
});
