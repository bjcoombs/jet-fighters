// TMS1370 (TMS1100 core) instruction set: the one table the decoder, the
// execution engine and any future disassembler are built from.
//
// Sources. Encoding is `docs/research/tms1370-architecture.md` §5, which
// transcribes MAME's fixed-opcode table (S1 `tms1000.cpp:129-142` as modified by
// `tms1100.cpp:66-72`) and its disassembler map (S1 `tms1k_dasm.cpp:177-198`).
// Semantics are TI's Table 3 (S3 §3.2), which the research document
// cross-checked against MAME and found to agree on every mnemonic present in
// both - including the two places the TMS1100 differs from the TMS1000:
//
//   - COMX complements *only the MSB* of X on this core.
//   - COMC replaces the TMS1000's CLO. **There is no clear-O instruction.**
//     Clearing the O register means executing TDO with A = 0 and the status
//     latch clear.
//
// What this table is *not*. Opcodes 0x00-0x08, 0x0E, 0x20-0x27, 0x38-0x3F and
// 0x40-0x7F are decoded through the mask-programmable microinstruction PLA
// (research doc §5, S3 §2.7), so "the standard TMS1100 instruction set" is a
// default rather than the architecture. Confirming MP2110's own decode needs
// `tms1100_common2_micro.pla`, which this project has not obtained: contract
// V13 is recorded `undriven` for that reason. This table therefore states the
// **standard set**, which is what the PRD directs while the artifact is absent.
// Nothing here claims a PLA decode was read, and nothing here records a
// divergence - inventing either would be a failed run rather than a blocked one.
//
// Pure data only: no DOM, no timers, no Web APIs.

import { NIBBLE_MASK, PAGE_MASK, PC_MASK, X_MASK } from './registers.js';

/** Instruction words are 8 bits, and every instruction is exactly one word. */
export const OPCODE_BITS = 8;

/** Number of distinct opcodes. Every one of them is assigned on this core. */
export const OPCODE_COUNT = 1 << OPCODE_BITS;

/** 8-bit opcode mask. */
export const OPCODE_MASK = OPCODE_COUNT - 1;

/**
 * Machine cycles one instruction costs.
 *
 * "All instructions are executed in one instruction cycle" (S3 §2.8, quoted in
 * research doc §6). There is no multi-cycle instruction and no multi-word
 * instruction on this core, so this is a constant rather than a table column.
 * How long an instruction cycle *lasts* is `timing.ts`'s business, not this
 * file's.
 */
export const CYCLES_PER_INSTRUCTION = 1;

/** Bits in the SBIT/RBIT/TBIT bit index. */
export const RAM_BIT_INDEX_BITS = 2;

/** Number of addressable bits in a RAM nibble. */
export const RAM_BIT_COUNT = 1 << RAM_BIT_INDEX_BITS;

/** Smallest addend the AnAAC family can encode. There is no A0AAC. */
export const MIN_ADDEND = 1;

/** Largest addend the AnAAC family can encode: adding 15 is subtracting 1. */
export const MAX_ADDEND = NIBBLE_MASK;

/**
 * Reverse the low `width` bits of a value.
 *
 * Constant and index operands are stored **bit-reversed** in the opcode
 * (research doc §5, "Operand encoding is bit-reversed"): MAME computes
 * `bitswap<4>(opcode,0,1,2,3)` on every fetch (S1 `tms1k_base.cpp:343`). An
 * assembler that emits operands unreversed produces a ROM that assembles,
 * disassembles under a naive disassembler, and computes the wrong numbers - so
 * the reversal lives in the shared table and not in either consumer.
 *
 * The function is its own inverse at a fixed width, which is why encode and
 * decode both call it rather than carrying two tables.
 */
export function reverseBits(value: number, width: number): number {
  let reversed = 0;
  for (let bit = 0; bit < width; bit += 1) {
    reversed = (reversed << 1) | ((value >> bit) & 1);
  }
  return reversed;
}

/** Every instruction the standard TMS1100 opcode map assigns. */
export enum Mnemonic {
  /** M != A -> status. */
  MNEA = 'MNEA',
  /** A <= M -> status. */
  ALEM = 'ALEM',
  /** Y != A -> status, and status -> status latch. */
  YNEA = 'YNEA',
  /** Exchange M and A. */
  XMA = 'XMA',
  /** Decrement Y; carry -> status. */
  DYN = 'DYN',
  /** Increment Y; carry -> status. */
  IYC = 'IYC',
  /** A + M -> A; carry -> status. */
  AMAAC = 'AMAAC',
  /** M - 1 -> A; carry -> status. */
  DMAN = 'DMAN',
  /** K inputs -> A. */
  TKA = 'TKA',
  /** Complement the MSB of X - not the whole register. */
  COMX = 'COMX',
  /** status latch : A -> O register. */
  TDO = 'TDO',
  /** Complement the chapter buffer. Replaces the TMS1000's CLO. */
  COMC = 'COMC',
  /** Reset the R output selected by Y. */
  RSTR = 'RSTR',
  /** Set the R output selected by Y. */
  SETR = 'SETR',
  /** K != 0 -> status. */
  KNEZ = 'KNEZ',
  /** Return from subroutine. */
  RETN = 'RETN',
  /** Load the page buffer with a 4-bit constant. */
  LDP = 'LDP',
  /** A -> Y. */
  TAY = 'TAY',
  /** M -> A. */
  TMA = 'TMA',
  /** M -> Y. */
  TMY = 'TMY',
  /** Y -> A. */
  TYA = 'TYA',
  /** A -> M, decrement Y; carry -> status. */
  TAMDYN = 'TAMDYN',
  /** A -> M, increment Y; carry -> status. */
  TAMIYC = 'TAMIYC',
  /** A -> M, then clear A. */
  TAMZA = 'TAMZA',
  /** A -> M. */
  TAM = 'TAM',
  /** Load X with a 3-bit constant. */
  LDX = 'LDX',
  /** Set one bit of M. */
  SBIT = 'SBIT',
  /** Reset one bit of M. */
  RBIT = 'RBIT',
  /** Test one bit of M -> status. */
  TBIT = 'TBIT',
  /** M - A -> A; carry (no borrow) -> status. */
  SAMAN = 'SAMAN',
  /** Complement and increment A; carry -> status, i.e. A was zero. */
  CPAIZ = 'CPAIZ',
  /** M + 1 -> A; carry -> status. */
  IMAC = 'IMAC',
  /** M != 0 -> status. */
  MNEZ = 'MNEZ',
  /** Load Y with a 4-bit constant. */
  TCY = 'TCY',
  /** Y != constant -> status. */
  YNEC = 'YNEC',
  /** Constant -> M, increment Y. */
  TCMIY = 'TCMIY',
  /** A + n -> A; carry -> status. n is 1-15; TI names A1AAC "IAC" and A15AAC "DAN". */
  ANAAC = 'ANAAC',
  /** Clear A. */
  CLA = 'CLA',
  /** Branch within a page, conditional on status. */
  BR = 'BR',
  /** Call a subroutine, conditional on status. */
  CALL = 'CALL',
}

/** What an instruction's operand field names. */
export enum OperandKind {
  /** No operand field. */
  NONE = 'NONE',
  /** 4-bit page number for LDP, stored bit-reversed. */
  PAGE = 'PAGE',
  /** 3-bit RAM file number for LDX, stored bit-reversed. */
  FILE = 'FILE',
  /** 2-bit index of a bit within the addressed nibble, stored bit-reversed. */
  RAM_BIT = 'RAM_BIT',
  /** 4-bit literal for TCY/YNEC/TCMIY, stored bit-reversed. */
  CONSTANT = 'CONSTANT',
  /** Addend 1-15 for the AnAAC family: the bit-reversed field, plus one. */
  ADDEND = 'ADDEND',
  /**
   * 6-bit branch target: an LFSR *state*, not an instruction ordinal, and the
   * one operand that is **not** bit-reversed (research doc §5; S1
   * `tms1k_base.cpp:412` loads the raw low six bits into the shift register).
   */
  TARGET = 'TARGET',
}

/** How wide each operand field is, and therefore how far its reversal reaches. */
const OPERAND_BITS: Readonly<Record<OperandKind, number>> = Object.freeze({
  [OperandKind.NONE]: 0,
  [OperandKind.PAGE]: 4,
  [OperandKind.FILE]: 3,
  [OperandKind.RAM_BIT]: RAM_BIT_INDEX_BITS,
  [OperandKind.CONSTANT]: 4,
  [OperandKind.ADDEND]: 4,
  [OperandKind.TARGET]: 6,
});

/** Valid operand range for each kind, as an inclusive `[min, max]`. */
const OPERAND_RANGE: Readonly<Record<OperandKind, readonly [number, number]>> = Object.freeze({
  [OperandKind.NONE]: [0, 0] as const,
  [OperandKind.PAGE]: [0, PAGE_MASK] as const,
  [OperandKind.FILE]: [0, X_MASK] as const,
  [OperandKind.RAM_BIT]: [0, RAM_BIT_COUNT - 1] as const,
  [OperandKind.CONSTANT]: [0, NIBBLE_MASK] as const,
  [OperandKind.ADDEND]: [MIN_ADDEND, MAX_ADDEND] as const,
  [OperandKind.TARGET]: [0, PC_MASK] as const,
});

/** Bits an operand field occupies in the opcode. */
export function operandBits(kind: OperandKind): number {
  return OPERAND_BITS[kind];
}

/** Inclusive `[min, max]` an operand of this kind may take. */
export function operandRange(kind: OperandKind): readonly [number, number] {
  return OPERAND_RANGE[kind];
}

/**
 * One row of the opcode map.
 *
 * A row covers `opcodeCount` consecutive opcodes starting at `base`. That is
 * exact even for the bit-reversed operands: reversal is a bijection on the field
 * width, so the set of opcodes a row occupies is contiguous even though the
 * order the operand values appear in is scrambled.
 */
export interface IsaEntry {
  readonly mnemonic: Mnemonic;
  /** Lowest opcode this row occupies. */
  readonly base: number;
  /** How many consecutive opcodes it occupies. */
  readonly opcodeCount: number;
  /** What the operand field names. */
  readonly operand: OperandKind;
  /** One line, for listings and diagnostics. */
  readonly summary: string;
}

function entry(
  mnemonic: Mnemonic,
  base: number,
  opcodeCount: number,
  operand: OperandKind,
  summary: string,
): IsaEntry {
  return Object.freeze({ mnemonic, base, opcodeCount, operand, summary });
}

const NONE = OperandKind.NONE;

/**
 * The standard TMS1100 opcode map, in opcode order.
 *
 * Rows are contiguous and, together, total {@link OPCODE_COUNT}: unlike the
 * HMCS44 core this replaces, **every** 8-bit pattern is assigned here, so there
 * is no unassigned-opcode region and no `UNKNOWN` instruction. `isa.test.ts`
 * asserts the totalling and the absence of gaps and overlaps, which is what
 * makes `encode(decode(op)) === op` meaningful across the whole space.
 */
export const ISA: readonly IsaEntry[] = Object.freeze([
  entry(Mnemonic.MNEA, 0x00, 1, NONE, 'M != A -> status'),
  entry(Mnemonic.ALEM, 0x01, 1, NONE, 'A <= M -> status'),
  entry(Mnemonic.YNEA, 0x02, 1, NONE, 'Y != A -> status, status -> status latch'),
  entry(Mnemonic.XMA, 0x03, 1, NONE, 'exchange M and A'),
  entry(Mnemonic.DYN, 0x04, 1, NONE, 'Y - 1 -> Y, carry -> status'),
  entry(Mnemonic.IYC, 0x05, 1, NONE, 'Y + 1 -> Y, carry -> status'),
  entry(Mnemonic.AMAAC, 0x06, 1, NONE, 'A + M -> A, carry -> status'),
  entry(Mnemonic.DMAN, 0x07, 1, NONE, 'M - 1 -> A, carry -> status'),
  entry(Mnemonic.TKA, 0x08, 1, NONE, 'K -> A'),
  entry(Mnemonic.COMX, 0x09, 1, NONE, 'complement the MSB of X'),
  entry(Mnemonic.TDO, 0x0a, 1, NONE, 'status latch : A -> O register'),
  entry(Mnemonic.COMC, 0x0b, 1, NONE, 'complement the chapter buffer'),
  entry(Mnemonic.RSTR, 0x0c, 1, NONE, 'reset the R output selected by Y'),
  entry(Mnemonic.SETR, 0x0d, 1, NONE, 'set the R output selected by Y'),
  entry(Mnemonic.KNEZ, 0x0e, 1, NONE, 'K != 0 -> status'),
  entry(Mnemonic.RETN, 0x0f, 1, NONE, 'return from subroutine'),
  entry(Mnemonic.LDP, 0x10, 16, OperandKind.PAGE, 'constant -> page buffer'),
  entry(Mnemonic.TAY, 0x20, 1, NONE, 'A -> Y'),
  entry(Mnemonic.TMA, 0x21, 1, NONE, 'M -> A'),
  entry(Mnemonic.TMY, 0x22, 1, NONE, 'M -> Y'),
  entry(Mnemonic.TYA, 0x23, 1, NONE, 'Y -> A'),
  entry(Mnemonic.TAMDYN, 0x24, 1, NONE, 'A -> M, Y - 1 -> Y, carry -> status'),
  entry(Mnemonic.TAMIYC, 0x25, 1, NONE, 'A -> M, Y + 1 -> Y, carry -> status'),
  entry(Mnemonic.TAMZA, 0x26, 1, NONE, 'A -> M, 0 -> A'),
  entry(Mnemonic.TAM, 0x27, 1, NONE, 'A -> M'),
  entry(Mnemonic.LDX, 0x28, 8, OperandKind.FILE, 'constant -> X'),
  entry(Mnemonic.SBIT, 0x30, 4, OperandKind.RAM_BIT, 'set one bit of M'),
  entry(Mnemonic.RBIT, 0x34, 4, OperandKind.RAM_BIT, 'reset one bit of M'),
  entry(Mnemonic.TBIT, 0x38, 4, OperandKind.RAM_BIT, 'M bit -> status'),
  entry(Mnemonic.SAMAN, 0x3c, 1, NONE, 'M - A -> A, carry -> status'),
  entry(Mnemonic.CPAIZ, 0x3d, 1, NONE, 'complement and increment A, carry -> status'),
  entry(Mnemonic.IMAC, 0x3e, 1, NONE, 'M + 1 -> A, carry -> status'),
  entry(Mnemonic.MNEZ, 0x3f, 1, NONE, 'M != 0 -> status'),
  entry(Mnemonic.TCY, 0x40, 16, OperandKind.CONSTANT, 'constant -> Y'),
  entry(Mnemonic.YNEC, 0x50, 16, OperandKind.CONSTANT, 'Y != constant -> status'),
  entry(Mnemonic.TCMIY, 0x60, 16, OperandKind.CONSTANT, 'constant -> M, Y + 1 -> Y'),
  entry(Mnemonic.ANAAC, 0x70, 15, OperandKind.ADDEND, 'A + n -> A, carry -> status'),
  entry(Mnemonic.CLA, 0x7f, 1, NONE, '0 -> A'),
  entry(Mnemonic.BR, 0x80, 64, OperandKind.TARGET, 'branch within the page if status'),
  entry(Mnemonic.CALL, 0xc0, 64, OperandKind.TARGET, 'call a subroutine if status'),
]);

/** Look a row up by mnemonic. */
export const ISA_BY_MNEMONIC: ReadonlyMap<Mnemonic, IsaEntry> = new Map(
  ISA.map((row) => [row.mnemonic, row]),
);

function buildOpcodeRows(): readonly IsaEntry[] {
  const rows = new Array<IsaEntry | undefined>(OPCODE_COUNT).fill(undefined);
  for (const row of ISA) {
    for (let offset = 0; offset < row.opcodeCount; offset += 1) {
      const opcode = row.base + offset;
      const existing = rows[opcode];
      if (existing !== undefined) {
        throw new Error(
          `TMS1370 opcode map overlaps at 0x${opcode.toString(16).padStart(2, '0')}: ` +
            `${existing.mnemonic} and ${row.mnemonic}`,
        );
      }
      rows[opcode] = row;
    }
  }
  const gap = rows.indexOf(undefined);
  if (gap !== -1) {
    // Failing at import time is the point. Every 8-bit pattern is assigned on
    // this core, so a gap means the table lost a row - and a program counter
    // reaching it would otherwise execute a silent no-op rather than fault.
    throw new Error(
      `TMS1370 opcode map has no row for 0x${gap.toString(16).padStart(2, '0')}`,
    );
  }
  return Object.freeze(rows as IsaEntry[]);
}

/** `OPCODE_ROWS[opcode]` is the row that opcode belongs to. Total by construction. */
export const OPCODE_ROWS: readonly IsaEntry[] = buildOpcodeRows();

/** The row a given opcode belongs to. */
export function isaEntryForOpcode(opcode: number): IsaEntry {
  return OPCODE_ROWS[opcode & OPCODE_MASK] as IsaEntry;
}

/** A decoded instruction: an opcode, what it does, and its operand value. */
export interface Instruction {
  /** The 8-bit word this was decoded from. */
  readonly opcode: number;
  readonly mnemonic: Mnemonic;
  readonly operand: OperandKind;
  /**
   * The operand's *value* - already un-reversed, and already offset for the
   * AnAAC family, so this is the number the programmer wrote. Zero when the
   * instruction has no operand field.
   */
  readonly value: number;
}

/** Turn an opcode's operand field into the value the programmer wrote. */
export function decodeOperand(kind: OperandKind, field: number): number {
  const bits = OPERAND_BITS[kind];
  if (bits === 0) {
    return 0;
  }
  const raw = field & ((1 << bits) - 1);
  if (kind === OperandKind.TARGET) {
    return raw;
  }
  const value = reverseBits(raw, bits);
  return kind === OperandKind.ADDEND ? value + MIN_ADDEND : value;
}

/** Turn an operand value into the field the opcode carries. */
export function encodeOperand(kind: OperandKind, value: number): number {
  const bits = OPERAND_BITS[kind];
  if (bits === 0) {
    return 0;
  }
  const mask = (1 << bits) - 1;
  if (kind === OperandKind.TARGET) {
    return value & mask;
  }
  const offset = kind === OperandKind.ADDEND ? value - MIN_ADDEND : value;
  return reverseBits(offset & mask, bits);
}

/** True when `value` is in range for an operand of this kind. */
export function isOperandInRange(kind: OperandKind, value: number): boolean {
  const [min, max] = OPERAND_RANGE[kind];
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Assemble an instruction into its opcode.
 *
 * Throws on an out-of-range operand rather than masking it: a caller asking for
 * `LDX 8` on a 3-bit X register has a bug, and silently storing `LDX 0` is the
 * class of failure this project's assembler exists to make impossible.
 */
export function encodeInstruction(mnemonic: Mnemonic, value = 0): number {
  const row = ISA_BY_MNEMONIC.get(mnemonic);
  if (row === undefined) {
    throw new Error(`unknown TMS1370 mnemonic ${String(mnemonic)}`);
  }
  if (!isOperandInRange(row.operand, value)) {
    const [min, max] = OPERAND_RANGE[row.operand];
    throw new Error(
      `${row.mnemonic} operand ${value} is outside ${min}..${max}`,
    );
  }
  return (row.base + encodeOperand(row.operand, value)) & OPCODE_MASK;
}

/** Assemble a decoded instruction back into the word it came from. */
export function encode(instruction: Pick<Instruction, 'mnemonic' | 'value'>): number {
  return encodeInstruction(instruction.mnemonic, instruction.value);
}
