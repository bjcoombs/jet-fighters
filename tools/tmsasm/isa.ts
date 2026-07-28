// TMS1000-family assembler (PRD R2), the instruction table.
//
// Paths in this header are relative to the repository root.
//
// ## Why this table lives under tools/ and not under src/
//
// `tools/hmasm/parser.ts` resolves mnemonics against `src/machine/cpu/isa.ts`,
// the same array the decoder builds its opcode map from, precisely so the
// assembler cannot drift from the CPU. That is the right arrangement and this
// file is not an argument against it - it is a statement of where the rebuild
// currently stands. The TMS1370 core is being written in parallel with this
// assembler and there is no `src/` table to point at yet. Whichever of the two
// lands second does not get to quietly become the second opinion: when the core
// exists, this table is what the round-trip test in isa.test.ts pins, and the
// merge is a deliberate step with the two tables in front of the reader.
//
// ## Provenance, and what "standard" means here
//
// Encodings are transcribed from `docs/research/tms1370-architecture.md`
// section 5, which records MAME's disassembler table
// (`tms1k_dasm.cpp:177-198`) as *the standard TMS1100 set* and is explicit that
// the standard set is a default rather than the architecture: opcodes outside
// the fixed half are decoded through a mask-programmable microinstruction PLA.
//
// `tms1100_common2_micro.pla` has **not** been obtained by this project. The
// standard encodings below are what that artefact would be expected to confirm;
// they are not a decode read off it, and nothing here should be read as one.
// Contract criterion V13 is recorded `undriven` for that reason.
//
// ## Operands are stored bit-reversed
//
// Constant and index operands are held reversed in the opcode - MAME computes
// `bitswap<4>(opcode, 0,1,2,3)` on every fetch. It applies to `LDP` (4 bits),
// `LDX` (3), the `SBIT`/`RBIT`/`TBIT1` index (2), and `TCY`/`YNEC`/`TCMIY` (4).
// It does **not** apply to the `BR`/`CALL` target, which is the raw low six bits
// and is therefore a physical LFSR state (memory.ts).
//
// An assembler that emits operands unreversed produces a ROM that assembles,
// disassembles under a naive disassembler, and computes the wrong numbers.
//
// ## The AnAAC family
//
// `0x70-0x7E` add a constant to the accumulator. The addend is the reversed
// operand plus one, so the fifteen opcodes cover every non-zero addend exactly
// once in scrambled order, and `0x7F` - which would be "add zero" - is `CLA`
// instead. TI names two of them separately: `IAC` is `A1AAC` and `DAN` is
// `A15AAC`, adding fifteen being subtracting one in four bits. Both are accepted
// as aliases so the source can say what it means.
//
// Node-side tool: no DOM, no Web APIs, no runtime dependencies.

import { PC_MASK, RAM_FILE_COUNT, RAM_FILE_SIZE, ROM_PAGE_COUNT, WORD_MASK } from './memory.js';

/** What an instruction's single operand denotes. */
export enum OperandKind {
  /** The instruction takes no operand. */
  NONE = 'NONE',
  /** A four-bit constant - `TCY`, `YNEC`, `TCMIY`. */
  CONSTANT = 'CONSTANT',
  /** A page number for the page buffer - `LDP`. */
  PAGE = 'PAGE',
  /** A RAM file number - `LDX`. */
  RAM_FILE = 'RAM_FILE',
  /** A bit within the addressed nibble - `SBIT`, `RBIT`, `TBIT1`. */
  RAM_BIT = 'RAM_BIT',
  /** A branch or call target, written as an address and emitted as an LFSR state. */
  BRANCH_TARGET = 'BRANCH_TARGET',
}

/** One row of the instruction table. */
export interface IsaEntry {
  /** The canonical mnemonic, upper case. */
  readonly mnemonic: string;
  /** Other spellings the source may use for the same instruction. */
  readonly aliases: readonly string[];
  /** The opcode with a zero operand field. */
  readonly opcode: number;
  readonly operandKind: OperandKind;
  /** Width of the operand field in bits; 0 when there is no operand. */
  readonly operandBits: number;
  /** One past the largest legal operand value. */
  readonly operandLimit: number;
  /** True when the operand is stored bit-reversed in the opcode. */
  readonly reversed: boolean;
  /** One line for `--help` and for the listing's disassembly column. */
  readonly summary: string;
}

/** Reverse the low `bits` bits of `value`. */
export function bitReverse(value: number, bits: number): number {
  let reversed = 0;
  for (let index = 0; index < bits; index += 1) {
    reversed = (reversed << 1) | ((value >>> index) & 1);
  }
  return reversed;
}

/** Shorthand for a row with no operand. */
function fixed(mnemonic: string, opcode: number, summary: string, aliases: string[] = []): IsaEntry {
  return Object.freeze({
    mnemonic,
    aliases: Object.freeze(aliases),
    opcode,
    operandKind: OperandKind.NONE,
    operandBits: 0,
    operandLimit: 1,
    reversed: false,
    summary,
  });
}

/** Shorthand for a row whose operand is stored bit-reversed. */
function reversedOperand(
  mnemonic: string,
  opcode: number,
  operandKind: OperandKind,
  operandBits: number,
  operandLimit: number,
  summary: string,
): IsaEntry {
  return Object.freeze({
    mnemonic,
    aliases: Object.freeze([]),
    opcode,
    operandKind,
    operandBits,
    operandLimit,
    reversed: true,
    summary,
  });
}

/**
 * The addend of each `AnAAC` opcode, and therefore its mnemonic.
 *
 * Derived rather than listed: `n` is the reversed operand plus one, which is the
 * same rule the encoder uses, so a typo cannot put `A9AAC` at the opcode that
 * adds five.
 */
const ADD_CONSTANT_OPCODES: readonly IsaEntry[] = Object.freeze(
  Array.from({ length: 15 }, (_unused, low) => {
    const addend = bitReverse(low, 4) + 1;
    const aliases = [`A${addend}ACC`];
    if (addend === 1) {
      aliases.push('IAC');
    }
    if (addend === 15) {
      aliases.push('DAN');
    }
    return fixed(
      `A${addend}AAC`,
      0x70 | low,
      `add ${addend} to the accumulator, result to the accumulator`,
      aliases,
    );
  }),
);

/**
 * Every instruction of the standard TMS1100 set.
 *
 * Ordered by opcode so the table reads against the map in the research document
 * without the reader having to sort it.
 */
export const ISA: readonly IsaEntry[] = Object.freeze([
  fixed('MNEA', 0x00, 'status = memory != accumulator'),
  fixed('ALEM', 0x01, 'status = accumulator <= memory'),
  fixed('YNEA', 0x02, 'status = Y != accumulator'),
  fixed('XMA', 0x03, 'exchange memory and accumulator'),
  fixed('DYN', 0x04, 'decrement Y, status = no borrow'),
  fixed('IYC', 0x05, 'increment Y, status = carry'),
  fixed('AMAAC', 0x06, 'add memory to accumulator, status = carry'),
  fixed('DMAN', 0x07, 'decrement memory, status = no borrow'),
  fixed('TKA', 0x08, 'transfer K inputs to the accumulator'),
  fixed('COMX', 0x09, 'complement the MSB of X'),
  fixed('TDO', 0x0a, 'transfer accumulator and status latch to the O register'),
  fixed('COMC', 0x0b, 'complement the chapter buffer'),
  fixed('RSTR', 0x0c, 'reset the R output selected by Y'),
  fixed('SETR', 0x0d, 'set the R output selected by Y'),
  fixed('KNEZ', 0x0e, 'status = K inputs != 0'),
  fixed('RETN', 0x0f, 'return from subroutine'),
  reversedOperand('LDP', 0x10, OperandKind.PAGE, 4, ROM_PAGE_COUNT, 'load the page buffer'),
  fixed('TAY', 0x20, 'transfer accumulator to Y'),
  fixed('TMA', 0x21, 'transfer memory to accumulator'),
  fixed('TMY', 0x22, 'transfer memory to Y'),
  fixed('TYA', 0x23, 'transfer Y to accumulator'),
  fixed('TAMDYN', 0x24, 'accumulator to memory, decrement Y, status = no borrow'),
  fixed('TAMIYC', 0x25, 'accumulator to memory, increment Y, status = carry'),
  fixed('TAMZA', 0x26, 'accumulator to memory, zero the accumulator'),
  fixed('TAM', 0x27, 'transfer accumulator to memory'),
  reversedOperand('LDX', 0x28, OperandKind.RAM_FILE, 3, RAM_FILE_COUNT, 'load the RAM file address X'),
  reversedOperand('SBIT', 0x30, OperandKind.RAM_BIT, 2, 4, 'set one bit of the addressed nibble'),
  reversedOperand('RBIT', 0x34, OperandKind.RAM_BIT, 2, 4, 'reset one bit of the addressed nibble'),
  reversedOperand('TBIT1', 0x38, OperandKind.RAM_BIT, 2, 4, 'status = the addressed bit is 1'),
  fixed('SAMAN', 0x3c, 'subtract accumulator from memory, status = no borrow'),
  fixed('CPAIZ', 0x3d, 'complement the accumulator and add one, status = result is zero'),
  fixed('IMAC', 0x3e, 'increment memory into the accumulator, status = carry'),
  fixed('MNEZ', 0x3f, 'status = memory != 0'),
  reversedOperand('TCY', 0x40, OperandKind.CONSTANT, 4, 16, 'transfer a constant to Y'),
  reversedOperand('YNEC', 0x50, OperandKind.CONSTANT, 4, 16, 'status = Y != constant'),
  reversedOperand(
    'TCMIY',
    0x60,
    OperandKind.CONSTANT,
    4,
    16,
    'transfer a constant to memory, increment Y',
  ),
  ...ADD_CONSTANT_OPCODES,
  fixed('CLA', 0x7f, 'clear the accumulator'),
  Object.freeze({
    mnemonic: 'BR',
    aliases: Object.freeze([]),
    opcode: 0x80,
    operandKind: OperandKind.BRANCH_TARGET,
    operandBits: 6,
    operandLimit: PC_MASK + 1,
    reversed: false,
    summary: 'branch within the page when status is 1',
  } satisfies IsaEntry),
  Object.freeze({
    mnemonic: 'CALL',
    aliases: Object.freeze([]),
    opcode: 0xc0,
    operandKind: OperandKind.BRANCH_TARGET,
    operandBits: 6,
    operandLimit: PC_MASK + 1,
    reversed: false,
    summary: 'call a subroutine when status is 1',
  } satisfies IsaEntry),
]);

/** `TBIT1` under MAME's shorter spelling, plus every alias declared above. */
const EXTRA_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  TBIT: 'TBIT1',
});

/** Every accepted spelling, canonical and alias, mapped to its row. */
const ENTRY_BY_NAME: ReadonlyMap<string, IsaEntry> = new Map(
  (() => {
    const pairs: [string, IsaEntry][] = [];
    for (const entry of ISA) {
      pairs.push([entry.mnemonic, entry]);
      for (const alias of entry.aliases) {
        pairs.push([alias, entry]);
      }
    }
    for (const [alias, canonical] of Object.entries(EXTRA_ALIASES)) {
      const entry = ISA.find((candidate) => candidate.mnemonic === canonical);
      if (entry) {
        pairs.push([alias, entry]);
      }
    }
    return pairs;
  })(),
);

/** Every spelling the assembler accepts, alphabetically, for a "did you mean". */
export const MNEMONICS: readonly string[] = Object.freeze(
  [...ENTRY_BY_NAME.keys()].sort(),
);

/** The row a mnemonic resolves to, case-insensitively, or undefined. */
export function isaEntryForMnemonic(mnemonic: string): IsaEntry | undefined {
  return ENTRY_BY_NAME.get(mnemonic.toUpperCase());
}

/** True when the instruction is written with an operand. */
export function operandArity(entry: IsaEntry): number {
  return entry.operandKind === OperandKind.NONE ? 0 : 1;
}

/**
 * The eight-bit word an instruction and its operand assemble to.
 *
 * @throws RangeError when the operand is outside the field. `assemble` rejects
 *   that with a source position long before here, so reaching this is a bug in
 *   the assembler rather than in the program, and it fails loudly.
 */
export function encodeInstruction(entry: IsaEntry, operand = 0): number {
  if (entry.operandKind === OperandKind.NONE) {
    if (operand !== 0) {
      throw new RangeError(`${entry.mnemonic} takes no operand, got ${operand}`);
    }
    return entry.opcode;
  }
  if (!Number.isInteger(operand) || operand < 0 || operand >= entry.operandLimit) {
    throw new RangeError(
      `${entry.mnemonic} operand ${operand} is outside 0..${entry.operandLimit - 1}`,
    );
  }
  const field = entry.reversed ? bitReverse(operand, entry.operandBits) : operand;
  return (entry.opcode | field) & WORD_MASK;
}

/** One decoded opcode. */
export interface DecodedInstruction {
  readonly entry: IsaEntry;
  /** The operand as the source would write it - already un-reversed. */
  readonly operand: number;
}

/**
 * Decode an eight-bit word back to an instruction and its written operand.
 *
 * Total over `0..255` by construction: the standard set covers the whole opcode
 * space, so there is no "illegal opcode" to report. isa.test.ts asserts the
 * `encode(decode(word)) === word` round-trip over all 256 words, which is what
 * catches an operand field that is masked or reversed inconsistently between the
 * two directions.
 */
export function decodeInstruction(word: number): DecodedInstruction {
  if (!Number.isInteger(word) || word < 0 || word > WORD_MASK) {
    throw new RangeError(`${word} is not an eight-bit ROM word`);
  }
  // Widest fields first: a BR at 0x80 must not be read as the fixed opcode its
  // low bits happen to spell.
  let best: IsaEntry | undefined;
  for (const entry of ISA) {
    const field = (1 << entry.operandBits) - 1;
    if ((word & ~field & WORD_MASK) !== entry.opcode) {
      continue;
    }
    if (!best || entry.opcode > best.opcode) {
      best = entry;
    }
  }
  if (!best) {
    throw new RangeError(`no instruction decodes ${word}`);
  }
  const field = word & ((1 << best.operandBits) - 1);
  return Object.freeze({
    entry: best,
    operand: best.reversed ? bitReverse(field, best.operandBits) : field,
  });
}

/** What an operand of each kind is called in a diagnostic. */
export const OPERAND_DESCRIPTION: Readonly<Record<OperandKind, string>> = Object.freeze({
  [OperandKind.NONE]: 'operand',
  [OperandKind.CONSTANT]: 'constant',
  [OperandKind.PAGE]: 'page number',
  [OperandKind.RAM_FILE]: 'RAM file',
  [OperandKind.RAM_BIT]: 'RAM bit',
  [OperandKind.BRANCH_TARGET]: 'target address',
});

/**
 * The RAM nibbles an `LDX k` puts in reach.
 *
 * X names one of the eight sixteen-nibble files, so selecting file `k` reaches
 * every nibble up to `(k << 4) | 15`. Used for the static high-water mark the
 * 128-nibble ceiling is checked against.
 */
export function ramReachOfFile(file: number): number {
  return (file + 1) * RAM_FILE_SIZE;
}
