// TMS1000-family assembler (PRD R2), stage four: an assembly result -> the
// artefacts a build and a human each need.
//
// Paths in this header are relative to the repository root.
//
// - `romImage` is what the emulator eats: exactly `ROM_SIZE` eight-bit words.
// - `formatListing` is what a person reads when a routine does not do what they
//   meant, and what the acceptance contract reads to decide whether the
//   assembler placed code the way the hardware does.
// - `formatSymbolTable` answers "where did that routine end up".
//
// ## The listing is a contract, not a convenience
//
// Two things about it are load-bearing, and both exist because of a specific
// way this assembler could be wrong while looking right.
//
// **The summary is named fields.** Word count and RAM high-water mark are
// written as fixed `; Key: value` lines, so a build gate reads them with a
// regular expression instead of inferring them from the maximum of an address
// column. Inference is not equivalent: the highest *address* in a ROM whose
// pages are visited in LFSR order says nothing about how many words were
// assembled, because a page's last-executed word is at physical offset $20 and
// its seventh is at $3F. `LISTING_KEYS` names the spellings so a rename breaks
// output.test.ts rather than a gate somewhere else.
//
// **Every row carries both orders.** `ORD` is the instruction's position within
// its page counting in execution order; `OFF` is the physical word the assembler
// emitted it at. An assembler that laid instructions down sequentially would
// produce a listing that is valid in every other respect - the addresses would
// be contiguous, the words would decode, the symbol table would resolve - and
// the only thing distinguishing it from a correct one is that these two columns
// would agree on every row. So the columns are printed even where they are
// equal, which they are for the first two words of every page; printing only the
// disagreements would leave a reader unable to tell "no disagreement" from "no
// column".
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import {
  formatAddress,
  formatPage,
  formatWord,
  OPLA_SLOT_COUNT,
  SymbolKind,
  type AssembledWord,
  type AssemblyResult,
} from './assembler.js';
import {
  RAM_SIZE,
  RESET_ADDRESS,
  RESET_CHAPTER,
  RESET_ORDINAL,
  RESET_PAGE,
  ROM_CHAPTER_COUNT,
  ROM_PAGE_COUNT,
  ROM_SIZE,
  romChapter,
  romOffset,
  romPage,
  WORD_MASK,
} from './memory.js';

/**
 * The keys of the listing's summary block.
 *
 * Stated as constants because they are read by things outside this repo's test
 * suite - the acceptance gate greps them - so renaming one is an interface
 * change and should look like one.
 */
export const LISTING_KEYS = Object.freeze({
  programWords: 'Program words',
  highestAddress: 'Highest address',
  ramHighWater: 'RAM high-water mark',
  pagesUsed: 'Pages used',
  resetVector: 'Reset vector',
  oplaSlots: 'O PLA slots declared',
});

/** Prefix on every line of the listing that is not an assembled word. */
export const LISTING_COMMENT = ';';

/** The column names of a listing row, in order, for the header line. */
export const LISTING_COLUMNS = Object.freeze([
  'ADDR',
  'CH',
  'PG',
  'ORD',
  'OFF',
  'WORD',
  'SOURCE',
]);

/** The separator between listing columns. */
export const LISTING_SEPARATOR = ' | ';

/**
 * Build the ROM image an emulator can be constructed from.
 *
 * Exactly `ROM_SIZE` eight-bit words. Words the source never wrote are 0, which
 * decodes as `MNEA`; a mask ROM has a value in every cell whether the program
 * uses it or not, so leaving them undefined is not an option the hardware
 * offers.
 *
 * @throws RangeError if a word is wider than eight bits or lands outside the
 *   ROM. Both are assembler bugs rather than source errors - `assemble` rejects
 *   them with a source position long before here - so they fail loudly and
 *   without a position rather than being masked into something plausible.
 */
export function romImage(result: AssemblyResult): Uint8Array {
  const image = new Uint8Array(ROM_SIZE);
  for (const word of result.words) {
    if (word.address < 0 || word.address >= ROM_SIZE) {
      throw new RangeError(
        `assembled word at ${word.address} is outside the ${ROM_SIZE}-word ROM`,
      );
    }
    if (!Number.isInteger(word.word) || word.word < 0 || word.word > WORD_MASK) {
      throw new RangeError(`assembled word ${word.word} is not an eight-bit value`);
    }
    image[word.address] = word.word;
  }
  return image;
}

/**
 * The O output PLA as the machine image carries it.
 *
 * Thirty-two eight-bit plate masks, indexed by `status_latch << 4 |
 * accumulator`. Undeclared slots are 0 - every plate dark - which is what lets
 * the ROM source declare only the patterns it uses. Slot 0 is dark by
 * construction; `assemble` rejects a source that says otherwise.
 */
export function oplaImage(result: AssemblyResult): Uint8Array {
  return Uint8Array.from(result.opla);
}

/** `; Key: value`, the one shape every summary line takes. */
function summaryLine(key: string, value: string): string {
  return `${LISTING_COMMENT} ${key}: ${value}`;
}

/**
 * The summary block: the size of the assembly and the two hardware ceilings.
 *
 * `Program words` is a count of words emitted, not a function of the highest
 * address, for the reason in this file's header: on a machine whose pages are
 * visited out of address order the two are not interchangeable, and the count is
 * the one the 2048-word ceiling is about.
 */
export function formatSummary(result: AssemblyResult): string {
  const highest =
    result.highestAddress < 0
      ? 'none - no words were assembled'
      : `${result.highestAddress} (${formatAddress(result.highestAddress)}) of ${ROM_SIZE - 1}`;
  const pageCount = ROM_PAGE_COUNT * ROM_CHAPTER_COUNT;
  const pagesUsed = result.pageClaims.filter((claim) => !claim.reserved).length;
  const reset = result.resetVectorPresent
    ? `present at ${formatAddress(RESET_ADDRESS)} ` +
      `(${formatPage(RESET_CHAPTER, RESET_PAGE)}, word ${RESET_ORDINAL})`
    : `absent - nothing was emitted at ${formatAddress(RESET_ADDRESS)} ` +
      `(${formatPage(RESET_CHAPTER, RESET_PAGE)}, word ${RESET_ORDINAL})`;
  return [
    `${LISTING_COMMENT} tmsasm listing for ${result.file}`,
    summaryLine(LISTING_KEYS.programWords, `${result.words.length} of ${ROM_SIZE}`),
    summaryLine(LISTING_KEYS.highestAddress, highest),
    summaryLine(
      LISTING_KEYS.ramHighWater,
      `${result.ramHighWater} of ${RAM_SIZE} nibbles (static, from LDX and RAM_ constants)`,
    ),
    summaryLine(
      LISTING_KEYS.pagesUsed,
      `${pagesUsed} of ${pageCount} (${formatPage(RESET_CHAPTER, RESET_PAGE)} is reserved ` +
        'for the reset routine)',
    ),
    summaryLine(LISTING_KEYS.resetVector, reset),
    summaryLine(LISTING_KEYS.oplaSlots, `${result.oplaEntries.length} of ${OPLA_SLOT_COUNT}`),
  ].join('\n');
}

/** The explanation of the two placement columns, so a reader need not guess. */
function placementNote(): string {
  return [
    `${LISTING_COMMENT}`,
    `${LISTING_COMMENT} The program counter is a shift register, so a page is not filled in`,
    `${LISTING_COMMENT} address order. ORD is an instruction's position within its page`,
    `${LISTING_COMMENT} counting in execution order; OFF is the physical word it was emitted`,
    `${LISTING_COMMENT} at. The two agree only for the first two words of a page.`,
    `${LISTING_COMMENT}`,
    `${LISTING_COMMENT} ${LISTING_COLUMNS.join(LISTING_SEPARATOR)}`,
  ].join('\n');
}

/** One listing row: `$3C0 | 0 | 15 |  2 | $03 | $28 | source text`. */
function listingRow(word: AssembledWord): string {
  const source = word.continuation ? '' : word.sourceLine;
  return [
    formatAddress(word.address),
    String(word.chapter),
    String(word.page).padStart(2),
    String(word.ordinal).padStart(2),
    formatWord(word.offset),
    formatWord(word.word),
    source,
  ]
    .join(LISTING_SEPARATOR)
    .trimEnd();
}

/**
 * The O output PLA section: all 32 slots, declared or not.
 *
 * Every slot is printed, not only the declared ones. The table has 32 entries
 * whatever the source says, and a listing that showed three rows would leave a
 * reader to work out whether the other twenty-nine were dark or missing.
 */
export function formatOplaTable(result: AssemblyResult): string {
  const declared = new Set(result.oplaEntries.map((entry) => entry.index));
  const rows = Array.from({ length: OPLA_SLOT_COUNT }, (_unused, index) => {
    const mask = result.opla[index] ?? 0;
    const bits = mask.toString(2).padStart(8, '0');
    const origin = declared.has(index) ? 'declared' : 'undeclared, dark';
    return (
      `${LISTING_COMMENT} ${String(index).padStart(2)} | ${formatWord(mask)} | ` +
      `%${bits} | ${origin}`
    );
  });
  return [
    `${LISTING_COMMENT} O output PLA - index is status_latch << 4 | accumulator`,
    `${LISTING_COMMENT} SLOT | MASK | PLATES | ORIGIN`,
    ...rows,
  ].join('\n');
}

/**
 * The symbol table, widest name first so the columns line up.
 *
 * Sorted by name rather than left in definition order: the question a symbol
 * dump answers is "what is `frameCount`?", and hunting for it in source order
 * over a two-thousand-word program is the slow way to find out.
 *
 * A label's value is printed with its page and its in-page LFSR state, because
 * that state is literally what a `BR` to it carries and the hexadecimal address
 * alone does not show it.
 */
export function formatSymbolTable(result: AssemblyResult): string {
  if (result.symbols.length === 0) {
    return `${LISTING_COMMENT} Symbols: none`;
  }
  const sorted = [...result.symbols].sort((left, right) => (left.name < right.name ? -1 : 1));
  const nameWidth = Math.max(...sorted.map((symbol) => symbol.name.length));
  const kindWidth = Math.max(...Object.values(SymbolKind).map((kind) => kind.length));
  const rows = sorted.map((symbol) => {
    const name = symbol.name.padEnd(nameWidth);
    const kind = symbol.kind.padEnd(kindWidth);
    const value =
      symbol.kind === SymbolKind.LABEL
        ? `${formatAddress(symbol.value)} (${formatPage(
            romChapter(symbol.value),
            romPage(symbol.value),
          )}, LFSR state ${formatWord(romOffset(symbol.value))})`
        : `${formatAddress(symbol.value)} (${symbol.value})`;
    return `${LISTING_COMMENT} ${name} | ${kind} | ${value}`;
  });
  return [`${LISTING_COMMENT} Symbols`, ...rows].join('\n');
}

/** What a listing includes. */
export interface ListingOptions {
  /** Append the symbol table. Default true - one file answers both questions. */
  readonly symbols?: boolean;
  /** Append the O output PLA table. Default true. */
  readonly opla?: boolean;
}

/**
 * Render the whole listing: summary, one row per assembled word, then the O PLA
 * table and the symbol table.
 *
 * Rows are in physical address order, which is emphatically not execution
 * order, so a blank line marks every discontinuity in *address*. That keeps runs
 * of contiguous ROM visible at a glance and is trivial for a parser to skip.
 */
export function formatListing(result: AssemblyResult, options: ListingOptions = {}): string {
  const lines: string[] = [formatSummary(result), placementNote()];
  let expected = -1;
  for (const word of result.words) {
    if (expected >= 0 && word.address !== expected) {
      lines.push('');
    }
    lines.push(listingRow(word));
    expected = word.address + 1;
  }
  if (options.opla !== false) {
    lines.push('', formatOplaTable(result));
  }
  if (options.symbols !== false) {
    lines.push('', formatSymbolTable(result));
  }
  return `${lines.join('\n')}\n`;
}
