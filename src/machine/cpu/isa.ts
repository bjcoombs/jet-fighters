// HMCS44 (Hitachi HD38800) instruction set architecture: the one table the
// decoder, the CPU and the assembler (PRD R2) are all built from.
//
// Why this file exists at all. An emulator that decodes from one opcode table
// and an assembler that encodes from another will drift, and the failure mode is
// nasty: the ROM assembles to words the CPU reads as *different* instructions,
// which surfaces much later as inexplicable game behaviour. So the bit patterns,
// operand shapes, word counts and cycle costs are stated exactly once, here.
// decoder.ts derives its 1024-entry map from `ISA`; tools/hmasm (R2) imports the
// same array to encode. Nothing else may hardcode an opcode.
//
// Sources and provenance. The *instruction set* - the mnemonics, their operand
// widths and their semantics - is the documented HMCS40 family one summarised in
// docs/prd/jet-fighters-v2.md (R1). The *encoding* is this repo's own: Jet
// Fighter's ROM was never dumped, no opcode map appears in our source material,
// and every word this core will ever execute comes from an assembler we also
// write. The encoding therefore has one job - to be fixed, total, and shared -
// and it is stated as a convention rather than dressed up as a measurement.
// Where a *semantic* detail (a flag effect, a cycle cost) is not settled by our
// source material, the entry says so in `notes` instead of inventing precision.
//
// The map, in three regions:
//
// | opcode        | shape                   | contents                        |
// |---------------|-------------------------|---------------------------------|
// | 0x000-0x03F   | six-bit sub-opcode      | 64 operand-less instructions    |
// | 0x040-0x1AF   | group << 4 \| operand4  | 23 instructions, one 4-bit each |
// | 0x200-0x2A1   | branch region           | BR, CAL, JMPL, CALL             |
//
// Everything outside them, and every operand outside an instruction's valid
// range, is unassigned - see `UNASSIGNED_REGIONS`, which records why each gap is
// genuinely unassigned rather than merely unimplemented.
//
// Pure data only: no DOM, no timers, no Web APIs.

import {
  INSTRUCTION_CATEGORY,
  InstructionCategory,
  InstructionType,
} from './instruction.js';
import { ROM_OFFSET_MASK, ROM_PATTERN_SIZE, WORD_MASK } from './memory.js';
import { PC_MASK } from './registers.js';
import { R_PORT_COUNT } from './ports.js';

/** Number of distinct ten-bit opcodes. */
export const OPCODE_COUNT = WORD_MASK + 1;

/** Bits of a RAM nibble a bit-addressing instruction can name: 0-3. */
export const RAM_BIT_COUNT = 4;

/**
 * Pattern tables the `P` instruction can select.
 *
 * The pattern region is 128 ten-bit words (memory.ts) and `P` indexes it with a
 * table selector above the accumulator's four bits, so there are 128/16 = 8
 * tables of 16 entries.
 */
export const PATTERN_TABLE_COUNT = ROM_PATTERN_SIZE / 16;

/**
 * Cost of one ROM word, in machine cycles.
 *
 * The HMCS40 family fetches and executes one word per instruction cycle, so
 * every instruction costs its word count. `P` is the single exception in this
 * table and states its own reason.
 */
export const CYCLES_PER_WORD = 1;

/** What an instruction's operand field names. Drives assembler diagnostics. */
export enum OperandKind {
  /** No operand field. */
  NONE = 'NONE',
  /** 4-bit literal: an immediate value, 0-15. */
  IMMEDIATE = 'IMMEDIATE',
  /** D-port pin selector, 0-15. */
  D_PIN = 'D_PIN',
  /** R-port selector, 0-4 (ports.ts: five 4-bit ports). */
  R_PORT = 'R_PORT',
  /** Bit within the selected RAM nibble, 0-3. */
  RAM_BIT = 'RAM_BIT',
  /** Pattern-table selector for `P`, 0-7. */
  PATTERN_TABLE = 'PATTERN_TABLE',
  /** 5-bit offset within the current ROM page (memory.ts: 32-word pages). */
  PAGE_OFFSET = 'PAGE_OFFSET',
  /** Bit 10 of a two-word branch target; the second word carries the low ten. */
  LONG_HIGH = 'LONG_HIGH',
}

/**
 * One instruction of the architecture.
 *
 * `mask`/`match`/`operandMask` are the whole encoding: an opcode decodes to this
 * entry when `(opcode & mask) === match`, and its operand is
 * `opcode & operandMask`. `encodeInstruction` is the exact inverse.
 */
export interface IsaEntry {
  /** Which instruction it is. The enum's string value is its mnemonic. */
  readonly type: InstructionType;
  /** Assembly mnemonic - identical to `type`, named separately for the assembler. */
  readonly mnemonic: string;
  /** Category, taken from `INSTRUCTION_CATEGORY` so classification has one home. */
  readonly category: InstructionCategory;
  /** Bits the pattern fixes. */
  readonly mask: number;
  /** Value those bits must take. */
  readonly match: number;
  /** Bits carrying the operand; 0 for the operand-less instructions. */
  readonly operandMask: number;
  /** What the operand names. */
  readonly operandKind: OperandKind;
  /** Operand values at or above this are not valid encodings. */
  readonly operandLimit: number;
  /** ROM words occupied: 1, or 2 for the long jump and call. */
  readonly words: number;
  /** Machine cycles. `words * CYCLES_PER_WORD` unless the entry says otherwise. */
  readonly cycles: number;
  /** One-line semantics, for listings, disassembly comments and documentation. */
  readonly summary: string;
  /** Where behaviour or cost is this repo's stated choice rather than documented. */
  readonly notes?: string;
}

/**
 * Flag rules, stated once for the whole architecture.
 *
 * Our source material fixes the register set and the mnemonics but not every
 * flag effect, so these are the rules this core implements and the assembler and
 * game ROM are written against. They are a convention, not a measurement.
 *
 * 1. **Carry** is written only by SEC, REC, the adds (AM, AMC, AI), the subtract
 *    (SMC), the rotates (ROTR, ROTL) and the decimal adjusts (DAA, DAS). Carry
 *    is the family's inverted borrow: SEC before a subtraction means "no borrow
 *    in", and carry 1 after one means "no borrow out" (M >= A). Nothing else
 *    touches it - notably NEGA and COMB
 *    leave it alone, because no carry effect for them appears in our source
 *    material and silently inventing one would corrupt a BCD chain.
 * 2. **ST** is written by every test: the comparisons (ALEM, ALEI, BLEM, ANEM,
 *    BNEM, YNEA, YNEI, MNEI), the bit and pin tests (TM, TD, TDY, TI0, TI1,
 *    TIF0, TIF1, TTF) and TC.
 * 3. **ST also takes the "did not wrap" result** of the pointer and counter
 *    arithmetic - IY, DY, IB, DB, AYY, SYY and the Y adjustment inside LMAIY,
 *    LMADY and LMIIY. ST is 1 when the operation stayed inside four bits and 0
 *    when it wrapped, which makes `IY / BR loop` a count-until-wrap loop with no
 *    separate compare.
 * 4. **BR, CAL, JMPL, CALL and TBR consume ST**: they act when ST is 1, and ST
 *    returns to 1 afterwards either way, so an unconditional branch needs no
 *    preparation.
 */
export const FLAG_RULES = Object.freeze({
  carryWriters: Object.freeze([
    InstructionType.SEC,
    InstructionType.REC,
    InstructionType.AM,
    InstructionType.AMC,
    InstructionType.AI,
    InstructionType.SMC,
    InstructionType.ROTR,
    InstructionType.ROTL,
    InstructionType.DAA,
    InstructionType.DAS,
  ] as readonly InstructionType[]),
  statusConsumers: Object.freeze([
    InstructionType.BR,
    InstructionType.CAL,
    InstructionType.JMPL,
    InstructionType.CALL,
    InstructionType.TBR,
  ] as readonly InstructionType[]),
});

/** An operand-less instruction at one exact opcode. */
function fixed(type: InstructionType, opcode: number, summary: string, notes?: string): IsaEntry {
  return entry({
    type,
    mask: WORD_MASK,
    match: opcode,
    operandMask: 0,
    operandKind: OperandKind.NONE,
    operandLimit: 1,
    words: 1,
    cycles: CYCLES_PER_WORD,
    summary,
    notes,
  });
}

/** An instruction occupying a group of sixteen, low nibble as its operand. */
function group(
  type: InstructionType,
  groupIndex: number,
  operandKind: OperandKind,
  operandLimit: number,
  summary: string,
  notes?: string,
): IsaEntry {
  return entry({
    type,
    mask: 0x3f0,
    match: groupIndex << 4,
    operandMask: 0x00f,
    operandKind,
    operandLimit,
    words: 1,
    cycles: CYCLES_PER_WORD,
    summary,
    notes,
  });
}

/** Fill in the derived fields so no entry can disagree with itself. */
function entry(spec: Omit<IsaEntry, 'mnemonic' | 'category'>): IsaEntry {
  return Object.freeze({
    ...spec,
    mnemonic: spec.type,
    category: INSTRUCTION_CATEGORY[spec.type],
  });
}

/**
 * The instruction set.
 *
 * Order is irrelevant to correctness - the patterns are disjoint and isa.test.ts
 * asserts it - but it is kept in opcode order so the table reads as the map it
 * is.
 */
export const ISA: readonly IsaEntry[] = Object.freeze([
  // --- 0x000-0x03F: the 64 operand-less instructions -----------------------
  fixed(InstructionType.NOP, 0x000, 'No operation.'),
  fixed(
    InstructionType.SBY,
    0x001,
    'Standby: stop the CPU clock; oscillator, prescaler and timer keep running.',
  ),
  fixed(InstructionType.STOP, 0x002, 'Stop the oscillator. Only a power cycle leaves this state.'),
  fixed(InstructionType.RTN, 0x003, 'PC <- popped return address.'),
  fixed(InstructionType.RTNI, 0x004, 'PC <- popped return address; IE <- 1.'),
  fixed(InstructionType.SEC, 0x005, 'Carry <- 1 (no borrow into a following subtraction).'),
  fixed(InstructionType.REC, 0x006, 'Carry <- 0.'),
  fixed(InstructionType.TC, 0x007, 'ST <- carry.'),
  fixed(InstructionType.AM, 0x008, 'A <- A + M, carry <- carry out.'),
  fixed(InstructionType.AMC, 0x009, 'A <- A + M + carry, carry <- carry out.'),
  fixed(
    InstructionType.SMC,
    0x00a,
    'A <- M - A - borrow, carry <- 1 when no borrow out (M >= A).',
  ),
  fixed(InstructionType.DAA, 0x00b, 'Decimal adjust A after an addition.'),
  fixed(InstructionType.DAS, 0x00c, 'Decimal adjust A after a subtraction.'),
  fixed(
    InstructionType.NEGA,
    0x00d,
    'A <- 0 - A (two’s complement).',
    'Leaves carry alone: no carry effect for NEGA appears in our source material.',
  ),
  fixed(InstructionType.COMB, 0x00e, 'B <- ~B.'),
  fixed(InstructionType.ROTR, 0x00f, 'Rotate A right through carry.'),
  fixed(InstructionType.ROTL, 0x010, 'Rotate A left through carry.'),
  fixed(InstructionType.IB, 0x011, 'B <- B + 1, ST <- 1 unless B wrapped to 0.'),
  fixed(InstructionType.DB, 0x012, 'B <- B - 1, ST <- 1 unless B wrapped to 15.'),
  fixed(InstructionType.IY, 0x013, 'Y <- Y + 1, ST <- 1 unless Y wrapped to 0.'),
  fixed(InstructionType.DY, 0x014, 'Y <- Y - 1, ST <- 1 unless Y wrapped to 15.'),
  fixed(InstructionType.AYY, 0x015, 'Y <- Y + A, ST <- 1 unless the sum left four bits.'),
  fixed(InstructionType.SYY, 0x016, 'Y <- Y - A, ST <- 1 unless the difference borrowed.'),
  fixed(InstructionType.XSP, 0x017, 'X <-> SPX and Y <-> SPY.'),
  fixed(InstructionType.LAB, 0x018, 'A <- B.'),
  fixed(InstructionType.LBA, 0x019, 'B <- A.'),
  fixed(InstructionType.LAY, 0x01a, 'A <- Y (low four bits).'),
  fixed(InstructionType.LASPX, 0x01b, 'A <- SPX (low four bits).'),
  fixed(InstructionType.LASPY, 0x01c, 'A <- SPY (low four bits).'),
  fixed(InstructionType.LAM, 0x01d, 'A <- M.'),
  fixed(InstructionType.LBM, 0x01e, 'B <- M.'),
  fixed(InstructionType.XMA, 0x01f, 'A <-> M.'),
  fixed(InstructionType.XMB, 0x020, 'B <-> M.'),
  fixed(InstructionType.LMAIY, 0x021, 'M <- A, then Y <- Y + 1 with the IY status rule.'),
  fixed(InstructionType.LMADY, 0x022, 'M <- A, then Y <- Y - 1 with the DY status rule.'),
  fixed(InstructionType.LXA, 0x023, 'X <- A.'),
  fixed(InstructionType.LYA, 0x024, 'Y <- A.'),
  fixed(InstructionType.ALEM, 0x025, 'ST <- (A <= M).'),
  fixed(InstructionType.BLEM, 0x026, 'ST <- (B <= M).'),
  fixed(InstructionType.ANEM, 0x027, 'ST <- (A != M).'),
  fixed(InstructionType.YNEA, 0x028, 'ST <- (Y != A).'),
  fixed(InstructionType.BNEM, 0x029, 'ST <- (B != M).'),
  fixed(InstructionType.OR, 0x02a, 'A <- A | B.'),
  fixed(InstructionType.LTA, 0x02b, 'Timer/counter <- A.'),
  fixed(
    InstructionType.LAT,
    0x02c,
    'A <- timer/counter.',
    'Our source material names the timer *load* instructions but not a read-back. ' +
      'LAT is this repo’s, so the ROM can read the free-running counter - the PRD’s ' +
      'randomness source (R3) needs it.',
  ),
  fixed(InstructionType.TTF, 0x02d, 'ST <- timer overflow flag TF.'),
  fixed(InstructionType.SEIE, 0x02e, 'IE <- 1.'),
  fixed(InstructionType.REIE, 0x02f, 'IE <- 0.'),
  fixed(InstructionType.SEIF0, 0x030, 'IF0 <- 1.'),
  fixed(InstructionType.REIF0, 0x031, 'IF0 <- 0.'),
  fixed(InstructionType.SEIF1, 0x032, 'IF1 <- 1.'),
  fixed(InstructionType.REIF1, 0x033, 'IF1 <- 0.'),
  fixed(InstructionType.SETF, 0x034, 'TF <- 1.'),
  fixed(InstructionType.RETF, 0x035, 'TF <- 0.'),
  fixed(
    InstructionType.SECF,
    0x036,
    'CF <- 1: the timer counts INT0 falling edges (event counter mode).',
    'The family documents a timer/counter mode select; which edge and which pin ' +
      'it counts is this repo’s stated model (timer.ts).',
  ),
  fixed(InstructionType.RECF, 0x037, 'CF <- 0: the timer counts prescaler ticks (timer mode).'),
  fixed(InstructionType.TI0, 0x038, 'ST <- level of the INT0 pin.'),
  fixed(InstructionType.TI1, 0x039, 'ST <- level of the INT1 pin.'),
  fixed(InstructionType.TIF0, 0x03a, 'ST <- IF0.'),
  fixed(InstructionType.TIF1, 0x03b, 'ST <- IF1.'),
  fixed(
    InstructionType.TBR,
    0x03c,
    'Computed branch: PC <- current page, offset ((B & 1) << 4) | A, when ST is 1.',
    'The offset composition is this repo’s: a 5-bit page offset does not fit in ' +
      'one 4-bit accumulator, so bit 0 of B supplies the top bit.',
  ),
  fixed(InstructionType.SEDY, 0x03d, 'D pin (Y & 15) <- 1.'),
  fixed(InstructionType.REDY, 0x03e, 'D pin (Y & 15) <- 0.'),
  fixed(InstructionType.TDY, 0x03f, 'ST <- D pin (Y & 15).'),

  // --- 0x040-0x19F: one 4-bit operand each ---------------------------------
  group(InstructionType.LAI, 0x04, OperandKind.IMMEDIATE, 16, 'A <- i.'),
  group(InstructionType.LBI, 0x05, OperandKind.IMMEDIATE, 16, 'B <- i.'),
  group(InstructionType.LXI, 0x06, OperandKind.IMMEDIATE, 16, 'X <- i.'),
  group(InstructionType.LYI, 0x07, OperandKind.IMMEDIATE, 16, 'Y <- i.'),
  group(InstructionType.AI, 0x08, OperandKind.IMMEDIATE, 16, 'A <- A + i, carry <- carry out.'),
  group(InstructionType.ALEI, 0x09, OperandKind.IMMEDIATE, 16, 'ST <- (A <= i).'),
  group(InstructionType.YNEI, 0x0a, OperandKind.IMMEDIATE, 16, 'ST <- (Y != i).'),
  group(InstructionType.MNEI, 0x0b, OperandKind.IMMEDIATE, 16, 'ST <- (M != i).'),
  group(
    InstructionType.LMIIY,
    0x0c,
    OperandKind.IMMEDIATE,
    16,
    'M <- i, then Y <- Y + 1 with the IY status rule.',
  ),
  group(InstructionType.SED, 0x0d, OperandKind.D_PIN, 16, 'D pin i <- 1 (releases the pin).'),
  group(InstructionType.RED, 0x0e, OperandKind.D_PIN, 16, 'D pin i <- 0 (pulls the pin down).'),
  group(InstructionType.TD, 0x0f, OperandKind.D_PIN, 16, 'ST <- D pin i.'),
  group(InstructionType.XAMR, 0x10, OperandKind.R_PORT, R_PORT_COUNT, 'A <-> R port r.'),
  group(InstructionType.SEM, 0x11, OperandKind.RAM_BIT, RAM_BIT_COUNT, 'Bit n of M <- 1.'),
  group(InstructionType.REM, 0x12, OperandKind.RAM_BIT, RAM_BIT_COUNT, 'Bit n of M <- 0.'),
  group(InstructionType.TM, 0x13, OperandKind.RAM_BIT, RAM_BIT_COUNT, 'ST <- bit n of M.'),
  group(InstructionType.LAR, 0x14, OperandKind.R_PORT, R_PORT_COUNT, 'A <- R port r.'),
  group(InstructionType.LBR, 0x15, OperandKind.R_PORT, R_PORT_COUNT, 'B <- R port r.'),
  group(InstructionType.LRA, 0x16, OperandKind.R_PORT, R_PORT_COUNT, 'R port r <- A.'),
  group(InstructionType.LRB, 0x17, OperandKind.R_PORT, R_PORT_COUNT, 'R port r <- B.'),
  group(InstructionType.LTI, 0x18, OperandKind.IMMEDIATE, 16, 'Timer/counter <- i.'),
  group(
    InstructionType.LPI,
    0x19,
    OperandKind.IMMEDIATE,
    16,
    'Prescaler divide ratio <- 2^i machine cycles per timer tick.',
    'The prescaler ratio is configurable on the family but our source material does ' +
      'not name the instruction that configures it, so LPI - mnemonic, encoding and ' +
      'the 2^i ratio ladder in timer.ts - is this repo’s.',
  ),
  entry({
    type: InstructionType.P,
    mask: 0x3f0,
    match: 0x1a0,
    operandMask: 0x00f,
    operandKind: OperandKind.PATTERN_TABLE,
    operandLimit: PATTERN_TABLE_COUNT,
    words: 1,
    // The one instruction in the table that costs more than its word count: it
    // performs a second ROM access, for the pattern word, after its own fetch.
    // The databook figure is not in our source material; charging the extra
    // fetch is this core's stated cost, and it is stated here rather than
    // silently defaulted to one.
    cycles: 2 * CYCLES_PER_WORD,
    summary: 'A <- pattern[t][A] low nibble, B <- its high nibble.',
    notes:
      'Two cycles: the pattern-ROM read is a second memory access. Not a databook ' +
      'figure - our source material gives no per-instruction cycle table.',
  }),

  // --- 0x200-0x2A1: control transfer ---------------------------------------
  // BR and CAL carry a five-bit in-page offset, matching memory.ts's 32-word
  // pages. CAL's page is always 0, so the ROM has 32 subroutine entry points -
  // the same "subroutine page" constraint the family imposes, at our page size.
  entry({
    type: InstructionType.BR,
    mask: 0x3e0,
    match: 0x200,
    operandMask: ROM_OFFSET_MASK,
    operandKind: OperandKind.PAGE_OFFSET,
    operandLimit: ROM_OFFSET_MASK + 1,
    words: 1,
    cycles: CYCLES_PER_WORD,
    summary: 'PC <- current page, offset o, when ST is 1.',
  }),
  entry({
    type: InstructionType.CAL,
    mask: 0x3e0,
    match: 0x220,
    operandMask: ROM_OFFSET_MASK,
    operandKind: OperandKind.PAGE_OFFSET,
    operandLimit: ROM_OFFSET_MASK + 1,
    words: 1,
    cycles: CYCLES_PER_WORD,
    summary: 'Push PC, then PC <- page 0, offset o, when ST is 1.',
  }),
  // JMPL and CALL are two words: the first carries bit 10 of the target, the
  // second the low ten bits. Together that is the full 11-bit program counter.
  entry({
    type: InstructionType.JMPL,
    mask: 0x3fe,
    match: 0x280,
    operandMask: 0x001,
    operandKind: OperandKind.LONG_HIGH,
    operandLimit: 2,
    words: 2,
    cycles: 2 * CYCLES_PER_WORD,
    summary: 'PC <- an 11-bit target anywhere in the program region, when ST is 1.',
  }),
  entry({
    type: InstructionType.CALL,
    mask: 0x3fe,
    match: 0x2a0,
    operandMask: 0x001,
    operandKind: OperandKind.LONG_HIGH,
    operandLimit: 2,
    words: 2,
    cycles: 2 * CYCLES_PER_WORD,
    summary: 'Push PC, then PC <- an 11-bit target, when ST is 1.',
  }),
]);

/** A run of opcodes carrying no instruction, and why it carries none. */
export interface UnassignedRegion {
  readonly first: number;
  readonly last: number;
  readonly reason: string;
}

/**
 * Every gap in the map, with the reason it is a gap.
 *
 * The distinction this records is the one that matters when reading a coverage
 * number: *unassigned* means the architecture has no instruction to put there,
 * not that one is missing from the core. isa.test.ts checks this list against
 * the decoder, so a region cannot silently stop being a gap.
 *
 * The arithmetic behind the gaps: the architecture has 91 instructions, and all
 * but the branches take at most a 4-bit operand. That is
 * 64 operand-less + 23 x 16 + 2 x 32 + 2 x 2 = 500 of the 1024 patterns, less
 * the 99 patterns inside group instructions whose operand names hardware that
 * does not exist (R ports 5-15, RAM bits 4-15, pattern tables 8-15), leaving 401
 * valid encodings and 623 unassigned. A 10-bit opcode space is simply wider than
 * this instruction set needs; the alternative - inventing mnemonics to fill it -
 * would be worse than an honest gap.
 */
export const UNASSIGNED_REGIONS: readonly UnassignedRegion[] = Object.freeze([
  {
    first: 0x1b0,
    last: 0x1ff,
    reason:
      'Five spare 16-opcode groups. Every documented instruction taking a 4-bit ' +
      'operand already has one; filling these would mean inventing instructions.',
  },
  {
    first: 0x240,
    last: 0x27f,
    reason:
      'Two spare branch-shaped blocks. The family gives BR one in-page target form ' +
      'and CAL one page-0 form, both encoded; a third would have no semantics.',
  },
  {
    first: 0x282,
    last: 0x29f,
    reason:
      'Tail of the JMPL block. JMPL’s first word carries only bit 10 of the ' +
      'target - the other ten bits are the second word - so it needs two patterns ' +
      'of the 32 the block is aligned to.',
  },
  {
    first: 0x2a2,
    last: 0x3ff,
    reason:
      'Tail of the CALL block and the whole top quarter of the opcode space. ' +
      'Nothing in the documented instruction set remains to encode here.',
  },
]);

/** Every instruction, indexed by type. Built once; `ISA` stays the source. */
const BY_TYPE: ReadonlyMap<InstructionType, IsaEntry> = new Map(
  ISA.map((isaEntry) => [isaEntry.type, isaEntry]),
);

/**
 * The entry for one instruction type.
 *
 * @throws RangeError for `UNKNOWN` and for any type with no encoding - both mean
 *   the caller is asking for a word that cannot be assembled.
 */
export function isaEntryFor(type: InstructionType): IsaEntry {
  const found = BY_TYPE.get(type);
  if (!found) {
    throw new RangeError(`${type} has no encoding`);
  }
  return found;
}

/** The entry an opcode decodes to, or undefined when the pattern is unassigned. */
export function isaEntryForOpcode(opcode: number): IsaEntry | undefined {
  const word = opcode & WORD_MASK;
  for (const candidate of ISA) {
    if ((word & candidate.mask) === candidate.match) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Build the opcode for a one-word instruction - the exact inverse of decoding.
 *
 * @throws RangeError for a two-word instruction (use `encodeLongInstruction`) or
 *   for an operand outside the instruction's range. An operand naming hardware
 *   the device does not have - R port 7, RAM bit 9 - is a range error here and
 *   an unassigned pattern when decoded, never a silently clamped instruction.
 */
export function encodeInstruction(type: InstructionType, operand = 0): number {
  const spec = isaEntryFor(type);
  if (spec.words !== 1) {
    throw new RangeError(`${type} is a two-word instruction - use encodeLong()`);
  }
  if (spec.operandMask === 0) {
    if (operand !== 0) {
      throw new RangeError(`${type} takes no operand, got ${operand}`);
    }
    return spec.match;
  }
  if (!Number.isInteger(operand) || operand < 0 || operand >= spec.operandLimit) {
    throw new RangeError(
      `${type} operand out of range: ${operand} (expected 0..${spec.operandLimit - 1})`,
    );
  }
  return spec.match | operand;
}

/**
 * Build the two words of a long jump or call to an 11-bit program address.
 *
 * @throws RangeError if `type` is not two-word or `address` is outside the
 *   2048-word program region.
 */
export function encodeLongInstruction(type: InstructionType, address: number): [number, number] {
  const spec = isaEntryFor(type);
  if (spec.words !== 2) {
    throw new RangeError(`${type} is a one-word instruction - use encode()`);
  }
  if (!Number.isInteger(address) || address < 0 || address > PC_MASK) {
    throw new RangeError(`${type} target out of range: ${address} (expected 0..${PC_MASK})`);
  }
  return [spec.match | ((address >>> 10) & 0x001), address & WORD_MASK];
}
