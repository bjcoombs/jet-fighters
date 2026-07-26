// HMCS44 (Hitachi HD38800) instruction representation.
//
// Sources: the mnemonics, their operand widths, and their semantics are the
// documented HMCS40-family instruction set as summarised in
// docs/prd/jet-fighters-v2.md (R1) - a 4-bit ALU over 10-bit opcodes, with the
// status flag ST carrying every test result and gating the conditional
// branches.
//
// What this module deliberately does *not* claim: a bit-exact reproduction of
// Hitachi's opcode table. Jet Fighter's ROM was never dumped (PRD, Technical
// Context), so there is no image to match and no opcode map in our source
// material to match it against. The bit assignments live in isa.ts and are
// fixed there once, for this repo, with the decoder and the assembler (R2)
// deriving from that single table. The *instruction set* is the documented one;
// the *encoding* is ours, and is stated as such rather than passed off as
// measured.
//
// Pure data only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the machine advances by cycles driven from cpu.ts.

/**
 * Every instruction this core recognises, named by its HMCS40 mnemonic.
 *
 * String-valued so a decoded instruction prints as itself in a failed
 * assertion and in `CPU.disassemble()`, rather than as an opaque index.
 */
export enum InstructionType {
  // --- Control -------------------------------------------------------------
  /** No operation. */
  NOP = 'NOP',
  /** Standby: stop the CPU clock, leave the oscillator and timer running. */
  SBY = 'SBY',
  /** Stop: halt the oscillator. Only a power cycle leaves this state. */
  STOP = 'STOP',

  // --- ALU, carry and status -----------------------------------------------
  /** A <- A + M. */
  AM = 'AM',
  /** A <- A + M + carry. */
  AMC = 'AMC',
  /** A <- M - A - borrow. */
  SMC = 'SMC',
  /** A <- A + immediate. */
  AI = 'AI',
  /** B <- B + 1. */
  IB = 'IB',
  /** B <- B - 1. */
  DB = 'DB',
  /** Decimal adjust after addition. */
  DAA = 'DAA',
  /** Decimal adjust after subtraction. */
  DAS = 'DAS',
  /** A <- 0 - A. */
  NEGA = 'NEGA',
  /** B <- ~B. */
  COMB = 'COMB',
  /** A <- A | B. */
  OR = 'OR',
  /** Rotate A right through carry. */
  ROTR = 'ROTR',
  /** Rotate A left through carry. */
  ROTL = 'ROTL',
  /** Carry <- 1. */
  SEC = 'SEC',
  /** Carry <- 0. */
  REC = 'REC',
  /** ST <- carry. */
  TC = 'TC',
  /** Y <- Y + 1. */
  IY = 'IY',
  /** Y <- Y - 1. */
  DY = 'DY',
  /** Y <- Y + A. */
  AYY = 'AYY',
  /** Y <- Y - A. */
  SYY = 'SYY',

  // --- Comparisons: every one of these lands in ST, nothing else -----------
  /** ST <- (A <= M). */
  ALEM = 'ALEM',
  /** ST <- (A <= immediate). */
  ALEI = 'ALEI',
  /** ST <- (B <= M). */
  BLEM = 'BLEM',
  /** ST <- (A != M). */
  ANEM = 'ANEM',
  /** ST <- (B != M). */
  BNEM = 'BNEM',
  /** ST <- (Y != A). */
  YNEA = 'YNEA',
  /** ST <- (Y != immediate). */
  YNEI = 'YNEI',
  /** ST <- (M != immediate). */
  MNEI = 'MNEI',

  // --- Loads and exchanges -------------------------------------------------
  /** A <- B. */
  LAB = 'LAB',
  /** B <- A. */
  LBA = 'LBA',
  /** A <- Y. */
  LAY = 'LAY',
  /** A <- SPX. */
  LASPX = 'LASPX',
  /** A <- SPY. */
  LASPY = 'LASPY',
  /** A <- M. */
  LAM = 'LAM',
  /** B <- M. */
  LBM = 'LBM',
  /** A <- immediate. */
  LAI = 'LAI',
  /** B <- immediate. */
  LBI = 'LBI',
  /** X <- A. */
  LXA = 'LXA',
  /** Y <- A. */
  LYA = 'LYA',
  /** X <- immediate. */
  LXI = 'LXI',
  /** Y <- immediate. */
  LYI = 'LYI',
  /** A <-> M. */
  XMA = 'XMA',
  /** B <-> M. */
  XMB = 'XMB',
  /** X <-> SPX and Y <-> SPY. */
  XSP = 'XSP',
  /** ST <- bit n of M. */
  TM = 'TM',
  /** Read a pattern-region ROM word indexed by A: A <- low nibble, B <- high nibble. */
  P = 'P',

  // --- Stores --------------------------------------------------------------
  /** M <- A, then Y <- Y + 1. */
  LMAIY = 'LMAIY',
  /** M <- A, then Y <- Y - 1. */
  LMADY = 'LMADY',
  /** M <- immediate, then Y <- Y + 1. */
  LMIIY = 'LMIIY',
  /** Bit n of M <- 1. */
  SEM = 'SEM',
  /** Bit n of M <- 0. */
  REM = 'REM',

  // --- Control transfer ----------------------------------------------------
  /** Branch within the current ROM page, taken when ST is 1. */
  BR = 'BR',
  /** Call a page-0 subroutine, taken when ST is 1. */
  CAL = 'CAL',
  /** Two-word jump anywhere in the 2048-word program region. */
  JMPL = 'JMPL',
  /** Two-word call anywhere in the 2048-word program region. */
  CALL = 'CALL',
  /** Computed in-page branch through the accumulators - the jump-table primitive. */
  TBR = 'TBR',
  /** Return from subroutine. */
  RTN = 'RTN',
  /** Return from interrupt. */
  RTNI = 'RTNI',

  // --- Ports ---------------------------------------------------------------
  /** D pin n <- 1 (releases an open-drain pin). */
  SED = 'SED',
  /** D pin n <- 0 (pulls an open-drain pin down). */
  RED = 'RED',
  /** ST <- D pin n. */
  TD = 'TD',
  /** A <- R port r. */
  LAR = 'LAR',
  /** B <- R port r. */
  LBR = 'LBR',
  /** R port r <- A. */
  LRA = 'LRA',
  /** R port r <- B. */
  LRB = 'LRB',
  /** A <-> R port r. */
  XAMR = 'XAMR',
  /** D pin (Y) <- 1 - the Y-indirect form of SED, for a grid-scan loop. */
  SEDY = 'SEDY',
  /** D pin (Y) <- 0 - the Y-indirect form of RED. */
  REDY = 'REDY',
  /** ST <- D pin (Y) - the Y-indirect form of TD. */
  TDY = 'TDY',

  // --- Timer, prescaler and interrupt flags --------------------------------
  /** Timer/counter <- immediate. */
  LTI = 'LTI',
  /** Timer/counter <- A. */
  LTA = 'LTA',
  /** A <- timer/counter. */
  LAT = 'LAT',
  /** Prescaler divide-ratio select <- immediate. */
  LPI = 'LPI',
  /** ST <- timer overflow flag TF. */
  TTF = 'TTF',
  /** TF <- 1. */
  SETF = 'SETF',
  /** TF <- 0. */
  RETF = 'RETF',
  /** CF <- 1: the timer counts INT0 edges instead of prescaler ticks. */
  SECF = 'SECF',
  /** CF <- 0: the timer counts prescaler ticks. */
  RECF = 'RECF',
  /** IE <- 1: interrupts enabled. */
  SEIE = 'SEIE',
  /** IE <- 0: interrupts masked. */
  REIE = 'REIE',
  /** IF0 <- 1. */
  SEIF0 = 'SEIF0',
  /** IF0 <- 0. */
  REIF0 = 'REIF0',
  /** IF1 <- 1. */
  SEIF1 = 'SEIF1',
  /** IF1 <- 0. */
  REIF1 = 'REIF1',
  /** ST <- level of the INT0 pin. */
  TI0 = 'TI0',
  /** ST <- level of the INT1 pin. */
  TI1 = 'TI1',
  /** ST <- IF0. */
  TIF0 = 'TIF0',
  /** ST <- IF1. */
  TIF1 = 'TIF1',

  // --- Not an instruction --------------------------------------------------
  /**
   * No instruction is encoded at this bit pattern.
   *
   * Decoding never throws on one: a runaway program counter reaching an
   * unassigned word is a condition the real device exhibits, and the CPU - not
   * the decoder - decides what to do about it.
   */
  UNKNOWN = 'UNKNOWN',
}

/** Coarse grouping, for dispatch tables, disassembly listings and tests. */
export enum InstructionCategory {
  /** NOP and the standby/stop states. */
  CONTROL = 'CONTROL',
  /** Arithmetic, carry manipulation and the ST-setting comparisons. */
  ALU = 'ALU',
  /** Moves data into a register, including register/RAM exchanges. */
  LOAD = 'LOAD',
  /** Moves data into RAM. */
  STORE = 'STORE',
  /** Changes the program counter, or may. */
  BRANCH = 'BRANCH',
  /** Touches the R or D pins. */
  PORT = 'PORT',
  /** Touches the timer, the prescaler, or the interrupt flags. */
  TIMER = 'TIMER',
  /** Unassigned bit pattern. */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Category of every instruction type.
 *
 * `Record<InstructionType, ...>` rather than a lookup with a default: adding a
 * mnemonic without classifying it is then a compile error, not a silent
 * `UNKNOWN` at runtime.
 */
export const INSTRUCTION_CATEGORY: Record<InstructionType, InstructionCategory> = {
  [InstructionType.NOP]: InstructionCategory.CONTROL,
  [InstructionType.SBY]: InstructionCategory.CONTROL,
  [InstructionType.STOP]: InstructionCategory.CONTROL,

  [InstructionType.AM]: InstructionCategory.ALU,
  [InstructionType.AMC]: InstructionCategory.ALU,
  [InstructionType.SMC]: InstructionCategory.ALU,
  [InstructionType.AI]: InstructionCategory.ALU,
  [InstructionType.IB]: InstructionCategory.ALU,
  [InstructionType.DB]: InstructionCategory.ALU,
  [InstructionType.DAA]: InstructionCategory.ALU,
  [InstructionType.DAS]: InstructionCategory.ALU,
  [InstructionType.NEGA]: InstructionCategory.ALU,
  [InstructionType.COMB]: InstructionCategory.ALU,
  [InstructionType.OR]: InstructionCategory.ALU,
  [InstructionType.ROTR]: InstructionCategory.ALU,
  [InstructionType.ROTL]: InstructionCategory.ALU,
  [InstructionType.SEC]: InstructionCategory.ALU,
  [InstructionType.REC]: InstructionCategory.ALU,
  [InstructionType.TC]: InstructionCategory.ALU,
  [InstructionType.IY]: InstructionCategory.ALU,
  [InstructionType.DY]: InstructionCategory.ALU,
  [InstructionType.AYY]: InstructionCategory.ALU,
  [InstructionType.SYY]: InstructionCategory.ALU,
  [InstructionType.ALEM]: InstructionCategory.ALU,
  [InstructionType.ALEI]: InstructionCategory.ALU,
  [InstructionType.BLEM]: InstructionCategory.ALU,
  [InstructionType.ANEM]: InstructionCategory.ALU,
  [InstructionType.BNEM]: InstructionCategory.ALU,
  [InstructionType.YNEA]: InstructionCategory.ALU,
  [InstructionType.YNEI]: InstructionCategory.ALU,
  [InstructionType.MNEI]: InstructionCategory.ALU,

  [InstructionType.LAB]: InstructionCategory.LOAD,
  [InstructionType.LBA]: InstructionCategory.LOAD,
  [InstructionType.LAY]: InstructionCategory.LOAD,
  [InstructionType.LASPX]: InstructionCategory.LOAD,
  [InstructionType.LASPY]: InstructionCategory.LOAD,
  [InstructionType.LAM]: InstructionCategory.LOAD,
  [InstructionType.LBM]: InstructionCategory.LOAD,
  [InstructionType.LAI]: InstructionCategory.LOAD,
  [InstructionType.LBI]: InstructionCategory.LOAD,
  [InstructionType.LXA]: InstructionCategory.LOAD,
  [InstructionType.LYA]: InstructionCategory.LOAD,
  [InstructionType.LXI]: InstructionCategory.LOAD,
  [InstructionType.LYI]: InstructionCategory.LOAD,
  [InstructionType.XMA]: InstructionCategory.LOAD,
  [InstructionType.XMB]: InstructionCategory.LOAD,
  [InstructionType.XSP]: InstructionCategory.LOAD,
  [InstructionType.TM]: InstructionCategory.LOAD,
  [InstructionType.P]: InstructionCategory.LOAD,

  [InstructionType.LMAIY]: InstructionCategory.STORE,
  [InstructionType.LMADY]: InstructionCategory.STORE,
  [InstructionType.LMIIY]: InstructionCategory.STORE,
  [InstructionType.SEM]: InstructionCategory.STORE,
  [InstructionType.REM]: InstructionCategory.STORE,

  [InstructionType.BR]: InstructionCategory.BRANCH,
  [InstructionType.CAL]: InstructionCategory.BRANCH,
  [InstructionType.JMPL]: InstructionCategory.BRANCH,
  [InstructionType.CALL]: InstructionCategory.BRANCH,
  [InstructionType.TBR]: InstructionCategory.BRANCH,
  [InstructionType.RTN]: InstructionCategory.BRANCH,
  [InstructionType.RTNI]: InstructionCategory.BRANCH,

  [InstructionType.SED]: InstructionCategory.PORT,
  [InstructionType.RED]: InstructionCategory.PORT,
  [InstructionType.TD]: InstructionCategory.PORT,
  [InstructionType.LAR]: InstructionCategory.PORT,
  [InstructionType.LBR]: InstructionCategory.PORT,
  [InstructionType.LRA]: InstructionCategory.PORT,
  [InstructionType.LRB]: InstructionCategory.PORT,
  [InstructionType.XAMR]: InstructionCategory.PORT,
  [InstructionType.SEDY]: InstructionCategory.PORT,
  [InstructionType.REDY]: InstructionCategory.PORT,
  [InstructionType.TDY]: InstructionCategory.PORT,

  [InstructionType.LTI]: InstructionCategory.TIMER,
  [InstructionType.LTA]: InstructionCategory.TIMER,
  [InstructionType.LAT]: InstructionCategory.TIMER,
  [InstructionType.LPI]: InstructionCategory.TIMER,
  [InstructionType.TTF]: InstructionCategory.TIMER,
  [InstructionType.SETF]: InstructionCategory.TIMER,
  [InstructionType.RETF]: InstructionCategory.TIMER,
  [InstructionType.SECF]: InstructionCategory.TIMER,
  [InstructionType.RECF]: InstructionCategory.TIMER,
  [InstructionType.SEIE]: InstructionCategory.TIMER,
  [InstructionType.REIE]: InstructionCategory.TIMER,
  [InstructionType.SEIF0]: InstructionCategory.TIMER,
  [InstructionType.REIF0]: InstructionCategory.TIMER,
  [InstructionType.SEIF1]: InstructionCategory.TIMER,
  [InstructionType.REIF1]: InstructionCategory.TIMER,
  [InstructionType.TI0]: InstructionCategory.TIMER,
  [InstructionType.TI1]: InstructionCategory.TIMER,
  [InstructionType.TIF0]: InstructionCategory.TIMER,
  [InstructionType.TIF1]: InstructionCategory.TIMER,

  [InstructionType.UNKNOWN]: InstructionCategory.UNKNOWN,
};

/** One decoded instruction. Immutable - `decode()` hands out shared instances. */
export interface Instruction {
  /** The ten-bit ROM word this was decoded from. */
  readonly opcode: number;
  /** Which instruction it is. */
  readonly type: InstructionType;
  /** Its category, derived from `type` via `INSTRUCTION_CATEGORY`. */
  readonly category: InstructionCategory;
  /**
   * Immediates and register selectors, in mnemonic order. Empty for the
   * operand-less instructions.
   *
   * A two-word instruction carries only what its *first* word encodes; the CPU
   * fetches the second word and combines them (see `longAddress()`).
   */
  readonly operands: readonly number[];
  /**
   * Machine cycles this instruction costs.
   *
   * The HMCS40 family is a one-cycle-per-word machine, so this is `words` for
   * every instruction but `P`, which spends a second cycle on its pattern-ROM
   * read (see isa.ts, which states that cost and its uncertainty). It is carried
   * per instruction so that when a databook figure turns out to differ, the fix
   * belongs in the ISA table and nowhere else.
   */
  readonly cycles: number;
  /** ROM words the instruction occupies: 1, or 2 for the long jump and call. */
  readonly words: number;
}

/** True when the bit pattern encodes no instruction. */
export function isUnknown(instruction: Instruction): boolean {
  return instruction.type === InstructionType.UNKNOWN;
}

/** True when the CPU must fetch a second ROM word to execute this. */
export function isTwoWord(instruction: Instruction): boolean {
  return instruction.words === 2;
}

/** Render an instruction as assembly text: `LAI 5`, `BR 12`, `NOP`. */
export function formatInstruction(instruction: Instruction): string {
  if (instruction.operands.length === 0) {
    return instruction.type;
  }
  return `${instruction.type} ${instruction.operands.join(', ')}`;
}
