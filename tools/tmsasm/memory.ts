// TMS1000-family assembler (PRD R2), the geometry: ROM shape, RAM shape, and the
// shift-register program counter that decides where a word physically lands.
//
// Paths in this header are relative to the repository root.
//
// This module is the reason `tools/tmsasm/` is not a search-and-replace of
// `tools/hmasm/`. On the HMCS44 the n-th instruction of a page is at offset n.
// On this machine it is not, and every other file here depends on that fact
// being stated in exactly one place.
//
// ## The program counter is a shift register
//
// The 6-bit PC is a linear-feedback shift register. It visits all 64 states of a
// page exactly once before repeating, so it is a bijection over the page and is
// invertible - but the order is not numeric. Straight-line execution from the
// top of a page walks the physical offsets
//
//     00 01 03 07 0F 1F 3F 3E 3D 3B 37 2F 1E 3C 39 33 ...
//
// `docs/research/tms1370-architecture.md` section 2 records that sequence, its
// provenance (MAME `tms1k_base.cpp:324-337`) and the two consequences below.
// `LFSR_REFERENCE_SEQUENCE` in memory.test.ts is that table copied verbatim from
// the document, and the test asserts `LFSR_SEQUENCE` reproduces it. The ground
// truth is therefore external to this file: a generator that agreed only with
// itself would be worth nothing, and the rule is easy to get subtly wrong - a
// plausible-looking variant closes after 62 states and leaves two words of every
// page unreachable.
//
// Two consequences, both of which this assembler exists to handle:
//
// 1. **A ROM image is not laid out in execution order.** The n-th instruction of
//    a page is emitted at physical offset `LFSR_SEQUENCE[n]`.
// 2. **A branch operand is an LFSR state, not an instruction ordinal.** `BR` and
//    `CALL` carry the raw low six bits of the target address, so a label at the
//    n-th slot of a page assembles to `LFSR_SEQUENCE[n]`, not to n.
//
// ## The address is three fields, not one number
//
//     bit:  10   9  8  7  6   5  4  3  2  1  0
//          [CA] [   PA    ] [      PC        ]
//           chapter  page     program counter
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

/** Bits of the program counter within a page. */
export const PC_BITS = 6;

/** Low mask of the program counter - also the highest physical offset. */
export const PC_MASK = (1 << PC_BITS) - 1;

/** Words in one ROM page. The LFSR visits every one of them. */
export const ROM_PAGE_SIZE = 1 << PC_BITS;

/** Pages in one chapter. */
export const ROM_PAGE_COUNT = 16;

/** Chapters the TMS1100 core implements - 2048 words is two of them. */
export const ROM_CHAPTER_COUNT = 2;

/** Words in one chapter. */
export const ROM_CHAPTER_SIZE = ROM_PAGE_COUNT * ROM_PAGE_SIZE;

/** The whole program region: 2048 eight-bit instruction words. */
export const ROM_SIZE = ROM_CHAPTER_COUNT * ROM_CHAPTER_SIZE;

/** Bits in one ROM word. Eight, not the HMCS44's ten. */
export const WORD_BITS = 8;

/** Largest value a ROM word can hold. */
export const WORD_MASK = (1 << WORD_BITS) - 1;

/** Nibbles in one RAM file. Y selects one of them. */
export const RAM_FILE_SIZE = 16;

/** RAM files the TMS1100 core implements. X selects one of them. */
export const RAM_FILE_COUNT = 8;

/** RAM the device implements: 128 four-bit words. */
export const RAM_SIZE = RAM_FILE_COUNT * RAM_FILE_SIZE;

/**
 * The chapter the machine enters on reset.
 *
 * Reset enters at chapter 0, page 15, PC 0 - see `RESET_PAGE`.
 */
export const RESET_CHAPTER = 0;

/**
 * The page the machine enters on reset.
 *
 * The highest page of chapter 0, not the lowest. Nothing about the number 15 is
 * negotiable and nothing about it is guessable from the rest of the layout,
 * which is why the page allocator reserves it up front rather than letting a
 * program grow into it and collide at the end of an assembly.
 */
export const RESET_PAGE = ROM_PAGE_COUNT - 1;

/** The ordinal of the first instruction executed after reset - PC starts at 0. */
export const RESET_ORDINAL = 0;

/**
 * One step of the program counter's shift register.
 *
 * Left shift with the feedback bit the XNOR of the two high bits, plus the two
 * end corrections that turn a 62-state cycle into the full 64. Transcribed from
 * `docs/research/tms1370-architecture.md` section 2; the corrections are what
 * carry the sequence through the all-ones state instead of sticking there.
 */
export function nextProgramCounter(pc: number): number {
  let feedback = ((pc << 1) ^ pc) & (1 << (PC_BITS - 1)) ? 0 : 1;
  if (pc === PC_MASK >> 1) {
    feedback = 1;
  } else if (pc === PC_MASK) {
    feedback = 0;
  }
  return ((pc << 1) | feedback) & PC_MASK;
}

/**
 * Physical offset of the n-th instruction of a page, for n in `0..63`.
 *
 * Built by stepping `nextProgramCounter` from 0. Frozen because half this tool
 * indexes it and a mutated copy would misplace code silently.
 */
export const LFSR_SEQUENCE: readonly number[] = Object.freeze(
  ((): number[] => {
    const sequence: number[] = [];
    let pc = 0;
    for (let index = 0; index < ROM_PAGE_SIZE; index += 1) {
      sequence.push(pc);
      pc = nextProgramCounter(pc);
    }
    return sequence;
  })(),
);

/**
 * The inverse of `LFSR_SEQUENCE`: which ordinal a physical offset holds.
 *
 * Exists because `.ORG` names a physical address and everything after it has to
 * carry on in execution order from there. It is total because the sequence is a
 * bijection - a partial inverse would be the symptom of a broken step rule, so
 * `lfsrOrdinal` throws rather than returning `undefined` and letting the caller
 * decide what a missing state means.
 */
const ORDINAL_BY_OFFSET: readonly number[] = Object.freeze(
  ((): number[] => {
    const ordinals = new Array<number>(ROM_PAGE_SIZE).fill(-1);
    LFSR_SEQUENCE.forEach((offset, ordinal) => {
      ordinals[offset] = ordinal;
    });
    return ordinals;
  })(),
);

/** Physical offset of the `ordinal`-th instruction of a page. */
export function lfsrOffset(ordinal: number): number {
  const offset = LFSR_SEQUENCE[ordinal];
  if (offset === undefined) {
    throw new RangeError(
      `page ordinal ${ordinal} is outside 0..${ROM_PAGE_SIZE - 1} - a page holds ` +
        `${ROM_PAGE_SIZE} words and the assembler must reject a full page before here`,
    );
  }
  return offset;
}

/** Which instruction of a page the physical `offset` holds. */
export function lfsrOrdinal(offset: number): number {
  const ordinal = ORDINAL_BY_OFFSET[offset];
  if (ordinal === undefined || ordinal < 0) {
    throw new RangeError(`physical offset ${offset} is outside 0..${PC_MASK}`);
  }
  return ordinal;
}

/** The chapter a ROM address is in. */
export function romChapter(address: number): number {
  return (address >>> (PC_BITS + 4)) & (ROM_CHAPTER_COUNT - 1);
}

/** The page a ROM address is on, within its chapter. */
export function romPage(address: number): number {
  return (address >>> PC_BITS) & (ROM_PAGE_COUNT - 1);
}

/** The physical offset a ROM address names, within its page. */
export function romOffset(address: number): number {
  return address & PC_MASK;
}

/** Assemble the three address fields into the 11-bit ROM address. */
export function romAddress(chapter: number, page: number, offset: number): number {
  return (chapter << (PC_BITS + 4)) | (page << PC_BITS) | offset;
}

/** The ROM address of the `ordinal`-th instruction of a given page. */
export function romAddressForOrdinal(
  chapter: number,
  page: number,
  ordinal: number,
): number {
  return romAddress(chapter, page, lfsrOffset(ordinal));
}

/** The address the machine fetches its first instruction from. */
export const RESET_ADDRESS = romAddressForOrdinal(
  RESET_CHAPTER,
  RESET_PAGE,
  RESET_ORDINAL,
);
