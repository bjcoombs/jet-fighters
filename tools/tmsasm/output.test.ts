import { describe, expect, it } from 'vitest';
import { assemble, OPLA_SLOT_COUNT } from './assembler.js';
import {
  formatListing,
  formatOplaTable,
  formatSummary,
  formatSymbolTable,
  LISTING_COLUMNS,
  LISTING_KEYS,
  LISTING_SEPARATOR,
  oplaImage,
  romImage,
} from './output.js';
import { RAM_SIZE, ROM_SIZE, WORD_MASK } from './memory.js';

/** The value of a `; Key: value` summary line, or undefined. */
function summaryValue(listing: string, key: string): string | undefined {
  const match = new RegExp(`^; ${key}: (.*)$`, 'm').exec(listing);
  return match?.[1];
}

/** The rows of a listing that are assembled words rather than commentary. */
function wordRows(listing: string): string[] {
  return listing
    .split('\n')
    .filter((line) => line.startsWith('$'))
    .map((line) => line.trimEnd());
}

/** One word row split into its columns. */
function columns(row: string): string[] {
  return row.split(LISTING_SEPARATOR);
}

describe('romImage', () => {
  it('is exactly the ROM size, one byte per word', () => {
    const image = romImage(assemble('CLA\n'));
    expect(image).toBeInstanceOf(Uint8Array);
    expect(image).toHaveLength(ROM_SIZE);
  });

  it('places each word at its physical address, not its ordinal', () => {
    const image = romImage(assemble('CLA\nCLA\nRETN\n'));
    // Third instruction: ordinal 2, physical offset $03.
    expect(image[0x03]).toBe(0x0f);
    expect(image[0x02]).toBe(0);
  });

  it('leaves unwritten cells at zero - a mask ROM has a value everywhere', () => {
    const image = romImage(assemble('CLA\n'));
    expect(image.filter((word) => word !== 0)).toHaveLength(1);
  });
});

describe('oplaImage', () => {
  it('is 32 eight-bit plate masks', () => {
    const image = oplaImage(assemble('.OPLA 1, $FF\n'));
    expect(image).toHaveLength(OPLA_SLOT_COUNT);
    expect(image[1]).toBe(0xff);
    expect(image[0]).toBe(0);
  });

  it('is a copy - mutating it does not reach the assembly result', () => {
    const result = assemble('.OPLA 1, 1\n');
    const image = oplaImage(result);
    image[1] = 99;
    expect(result.opla[1]).toBe(1);
  });
});

describe('the listing summary', () => {
  const listing = formatListing(assemble('.EQU RAM_S, 20\nLDX 2\nCLA\nCLA\n', 'game.asm'));

  it('names the program-region word count as its own field', () => {
    expect(summaryValue(listing, LISTING_KEYS.programWords)).toBe(`3 of ${ROM_SIZE}`);
  });

  it('names the RAM high-water mark as its own field', () => {
    expect(summaryValue(listing, LISTING_KEYS.ramHighWater)).toMatch(
      new RegExp(`^48 of ${RAM_SIZE} nibbles`),
    );
  });

  it('does not make either figure inferrable from the address column alone', () => {
    // Three words assembled, highest address $003: a gate reading the maximum of
    // the address column would report four words, not three. The gap is the
    // LFSR skipping $002, and it grows with the size of the program.
    const rows = wordRows(listing);
    expect(rows).toHaveLength(3);
    expect(summaryValue(listing, LISTING_KEYS.highestAddress)).toMatch(/^3 \(\$003\)/);
  });

  it('reports the reset vector and the pages in use', () => {
    expect(summaryValue(listing, LISTING_KEYS.resetVector)).toMatch(/^absent/);
    expect(summaryValue(listing, LISTING_KEYS.pagesUsed)).toMatch(/^1 of 32/);
    expect(summaryValue(formatSummary(assemble('.PAGE 15\nCLA\n')), LISTING_KEYS.resetVector))
      .toMatch(/^present at \$3C0/);
  });

  it('counts the declared O PLA slots', () => {
    expect(summaryValue(listing, LISTING_KEYS.oplaSlots)).toBe(`0 of ${OPLA_SLOT_COUNT}`);
  });

  it('says so rather than printing a number when nothing was assembled', () => {
    expect(summaryValue(formatSummary(assemble('')), LISTING_KEYS.highestAddress)).toMatch(
      /^none/,
    );
  });
});

describe('the listing rows', () => {
  const listing = formatListing(assemble('a: CLA\nCLA\nCLA\nCLA\n'));

  it('name their columns in a header line', () => {
    expect(listing).toContain(`; ${LISTING_COLUMNS.join(LISTING_SEPARATOR)}`);
  });

  it('carry both the ordinal within the page and the physical offset', () => {
    const rows = wordRows(listing);
    expect(rows).toHaveLength(4);
    const ordinalColumn = LISTING_COLUMNS.indexOf('ORD');
    const offsetColumn = LISTING_COLUMNS.indexOf('OFF');
    expect(columns(rows[0] as string)[ordinalColumn]?.trim()).toBe('0');
    expect(columns(rows[0] as string)[offsetColumn]?.trim()).toBe('$00');
    expect(columns(rows[3] as string)[ordinalColumn]?.trim()).toBe('3');
    expect(columns(rows[3] as string)[offsetColumn]?.trim()).toBe('$07');
  });

  it('print the ordinal even where it equals the offset', () => {
    const rows = wordRows(listing);
    const ordinalColumn = LISTING_COLUMNS.indexOf('ORD');
    // Ordinals 0 and 1 sit at offsets $00 and $01. The column is still there.
    expect(columns(rows[1] as string)[ordinalColumn]?.trim()).toBe('1');
  });

  it('show the two orders differing on a page long enough for them to', () => {
    const rows = wordRows(listing);
    const ordinalColumn = LISTING_COLUMNS.indexOf('ORD');
    const offsetColumn = LISTING_COLUMNS.indexOf('OFF');
    const differing = rows.filter((row) => {
      const parts = columns(row);
      const ordinal = Number.parseInt(parts[ordinalColumn] as string, 10);
      const offset = Number.parseInt((parts[offsetColumn] as string).replace('$', ''), 16);
      return ordinal !== offset;
    });
    expect(differing.length).toBeGreaterThan(0);
  });

  it('hold an eight-bit value in the word column on every row', () => {
    // The CALL returns rather than re-entering the top of the program: a call
    // that reaches itself is class 3 of the static analyses and is rejected.
    const full = formatListing(assemble('CLA\nLDP 15\nBR 0\nCALL sub\nsub: RETN\n.DW $FFFF\n'));
    const wordColumn = LISTING_COLUMNS.indexOf('WORD');
    for (const row of wordRows(full)) {
      const word = Number.parseInt((columns(row)[wordColumn] as string).replace('$', ''), 16);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(WORD_MASK);
    }
  });

  it('quote a multi-word statement once and leave the continuations blank', () => {
    const rows = wordRows(formatListing(assemble('.DW $1234\n')));
    const sourceColumn = LISTING_COLUMNS.indexOf('SOURCE');
    const sources = rows.map((row) => columns(row)[sourceColumn] ?? '');
    expect(sources.filter((text) => text.includes('.DW'))).toHaveLength(1);
  });

  it('mark a discontinuity in address with a blank line', () => {
    // Ordinals 0,1,2 land at $00,$01,$03 - a gap the reader should see.
    expect(formatListing(assemble('CLA\nCLA\nCLA\n'))).toMatch(/\$001 \|[^\n]*\n\n\$003 \|/);
  });
});

describe('the O PLA table', () => {
  const table = formatOplaTable(assemble('.OPLA 1, %00000110\n'));

  it('prints all 32 slots, declared or not', () => {
    const rows = table.split('\n').filter((line) => /^; +\d+ \| \$/.test(line));
    expect(rows).toHaveLength(OPLA_SLOT_COUNT);
  });

  it('distinguishes a declared slot from an undeclared dark one', () => {
    expect(table).toMatch(/^; +1 \| \$06 \| %00000110 \| declared$/m);
    expect(table).toMatch(/^; +2 \| \$00 \| %00000000 \| undeclared, dark$/m);
  });

  it('shows slot 0 dark', () => {
    expect(table).toMatch(/^; +0 \| \$00 \| %00000000 \| undeclared, dark$/m);
  });
});

describe('the symbol table', () => {
  it('says so when there are no symbols', () => {
    expect(formatSymbolTable(assemble('CLA\n'))).toBe('; Symbols: none');
  });

  it('sorts by name and gives a label its page and LFSR state', () => {
    const table = formatSymbolTable(assemble('.EQU SPEED, 3\n.PAGE 2\nzz: CLA\naa: CLA\n'));
    const names = table
      .split('\n')
      .slice(1)
      .map((line) => line.slice(2).split(' |')[0]?.trim());
    expect(names).toEqual(['SPEED', 'aa', 'zz']);
    expect(table).toMatch(/zz +\| LABEL +\| \$080 \(chapter 0, page 2, LFSR state \$00\)/);
    expect(table).toMatch(/aa +\| LABEL +\| \$081 \(chapter 0, page 2, LFSR state \$01\)/);
  });

  it('gives a constant its decimal value alongside', () => {
    expect(formatSymbolTable(assemble('.EQU SPEED, 3\n'))).toMatch(/CONSTANT \| \$003 \(3\)/);
  });
});

describe('formatListing options', () => {
  it('appends the O PLA table and the symbol table by default', () => {
    const listing = formatListing(assemble('a: CLA\n'));
    expect(listing).toContain('O output PLA');
    expect(listing).toContain('; Symbols');
  });

  it('drops either on request', () => {
    const listing = formatListing(assemble('a: CLA\n'), { opla: false, symbols: false });
    expect(listing).not.toContain('O output PLA');
    expect(listing).not.toContain('; Symbols');
  });

  it('ends with exactly one newline', () => {
    expect(formatListing(assemble('CLA\n'))).toMatch(/[^\n]\n$/);
  });
});
