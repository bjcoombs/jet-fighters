// HMCS40 assembler (PRD R2), stage four: an assembly result -> the artefacts a
// build and a human each need.
//
// Three of them, and they are deliberately different shapes:
//
// - `romImage` is what the emulator eats: exactly `ROM_SIZE` ten-bit words, the
//   size `Memory`'s constructor insists on, so the output of the assembler drops
//   straight into the machine with no reshaping step in between.
// - `formatListing` is what a person reads when a routine does not do what they
//   meant: address, word, source line, one row per emitted word.
// - `formatSymbolTable` is what a person reads when they need to know where a
//   routine ended up, or whether a `.EQU` folded to the number they expected.
//
// ## The listing's summary is machine-readable on purpose
//
// The numbers at the head of a listing - words assembled, highest program
// address, pattern words, RAM high-water mark - are the two hardware ceilings
// and the size of the ROM. They are written as fixed `; Key: value` lines with
// in every one, so a CI check can read them out of the listing with a regular
// expression rather than re-implementing the assembler to find them. The exact
// spellings are the contract; `LISTING_KEYS` names them so a change here breaks
// output.test.ts rather than a build gate somewhere else.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import {
  RAM_SIZE,
  ROM_PROGRAM_SIZE,
  ROM_SIZE,
  WORD_MASK,
} from '../../src/machine/cpu/memory.js';
import {
  formatAddress,
  formatWord,
  SymbolKind,
  type AssembledWord,
  type AssemblyResult,
} from './assembler.js';

/**
 * The keys of the listing's summary block.
 *
 * Stated as constants because they are read by things outside this repo's test
 * suite - a build gate greps them - so renaming one is an interface change and
 * should look like one.
 */
export const LISTING_KEYS = Object.freeze({
  words: 'Assembled words',
  highestAddress: 'Highest address',
  patternWords: 'Pattern words',
  ramHighWater: 'RAM high-water mark',
});

/** Prefix on every line of the listing that is not an assembled word. */
export const LISTING_COMMENT = ';';

/**
 * Build the ROM image an emulator can be constructed from.
 *
 * Exactly `ROM_SIZE` words - 2048 program plus 128 pattern - because that is the
 * length `Memory` requires. Words the source never wrote are 0, which the CPU
 * decodes as `NOP`; a mask ROM has a value in every cell whether the program
 * uses it or not, so leaving them undefined is not an option the hardware offers.
 *
 * @throws RangeError if a word is wider than ten bits or lands outside the ROM.
 *   Both are assembler bugs rather than source errors - `assemble` rejects them
 *   with a source position long before here - so they fail loudly and without a
 *   position rather than being masked into something plausible.
 */
export function romImage(result: AssemblyResult): Uint16Array {
  const image = new Uint16Array(ROM_SIZE);
  for (const word of result.words) {
    if (word.address < 0 || word.address >= ROM_SIZE) {
      throw new RangeError(`assembled word at ${word.address} is outside the ${ROM_SIZE}-word ROM`);
    }
    if (!Number.isInteger(word.word) || word.word < 0 || word.word > WORD_MASK) {
      throw new RangeError(`assembled word ${word.word} is not a ten-bit value`);
    }
    image[word.address] = word.word;
  }
  return image;
}

/** `; Key: value`, the one shape every summary line takes. */
function summaryLine(key: string, value: string): string {
  return `${LISTING_COMMENT} ${key}: ${value}`;
}

/**
 * The summary block: the size of the assembly and the two hardware ceilings.
 *
 * Every number appears in decimal, addresses with their hexadecimal spelling
 * alongside, so both a reader and a regular expression get what they came for.
 *
 * `Highest address` is the highest address in the **program region**, and the
 * pattern region is reported on its own line. The two are different questions:
 * the program-region figure is the 2048-word ceiling a ROM can bust by growing,
 * while the pattern words sit above it by construction - `.PATTERN` is the only
 * way to reach them (memory.ts, assembler.ts) - so rolling them into one number
 * would make every ROM with a pattern table look like it had overflowed.
 */
export function formatSummary(result: AssemblyResult): string {
  const programWords = result.words.filter((word) => word.address < ROM_PROGRAM_SIZE);
  const patternWords = result.words.filter((word) => word.address >= ROM_PROGRAM_SIZE);
  const highestProgram = programWords.at(-1)?.address ?? -1;
  const highestPattern = patternWords.at(-1)?.address;
  const highest =
    highestProgram < 0
      ? 'none - no program words were assembled'
      : `${highestProgram} (${formatAddress(highestProgram)}) of ${ROM_PROGRAM_SIZE - 1}`;
  return [
    `${LISTING_COMMENT} hmasm listing for ${result.file}`,
    summaryLine(LISTING_KEYS.words, `${programWords.length} in the program region`),
    summaryLine(LISTING_KEYS.highestAddress, highest),
    summaryLine(
      LISTING_KEYS.patternWords,
      highestPattern === undefined
        ? '0'
        : `${patternWords.length} (highest ${highestPattern}, ${formatAddress(highestPattern)})`,
    ),
    summaryLine(
      LISTING_KEYS.ramHighWater,
      `${result.ramHighWater} of ${RAM_SIZE} nibbles (static, from LXI and RAM_ constants)`,
    ),
  ].join('\n');
}

/** One listing row: `$07F | $04F | source text`. */
function listingRow(word: AssembledWord): string {
  const source = word.continuation ? '' : word.sourceLine;
  return `${formatAddress(word.address)} | ${formatWord(word.word)} | ${source}`.trimEnd();
}

/**
 * The symbol table, widest name first so the columns line up.
 *
 * Sorted by name rather than left in definition order: the question a symbol
 * dump answers is "what is `frameCount`?", and hunting for it in source order
 * over a two-thousand-word program is the slow way to find out.
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
    // A label is an address and reads as hexadecimal; a constant is whatever the
    // author meant it to be, so it gets its decimal value alongside.
    const value =
      symbol.kind === SymbolKind.LABEL
        ? formatAddress(symbol.value)
        : `${formatAddress(symbol.value)} (${symbol.value})`;
    return `${LISTING_COMMENT} ${name} | ${kind} | ${value}`;
  });
  return [`${LISTING_COMMENT} Symbols`, ...rows].join('\n');
}

/** What a listing includes. */
export interface ListingOptions {
  /** Append the symbol table. Default true - one file answers both questions. */
  readonly symbols?: boolean;
}

/**
 * Render the whole listing: summary, one row per assembled word, symbol table.
 *
 * Rows are in address order, which is not always source order - `.ORG` may send
 * the emit address backwards - so a blank line marks every discontinuity. That
 * makes the runs of contiguous code visible at a glance, and a blank line is
 * trivial for a parser to skip.
 */
export function formatListing(result: AssemblyResult, options: ListingOptions = {}): string {
  const lines: string[] = [formatSummary(result), ''];
  let expected = -1;
  for (const word of result.words) {
    if (expected >= 0 && word.address !== expected) {
      lines.push('');
    }
    lines.push(listingRow(word));
    expected = word.address + 1;
  }
  if (options.symbols !== false) {
    lines.push('', formatSymbolTable(result));
  }
  return `${lines.join('\n')}\n`;
}
