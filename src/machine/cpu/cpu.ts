// HMCS44 (Hitachi HD38800) CPU core: fetch, decode, execute.
//
// Sources: the register set, memory sizes, port topology and ~400 kHz on-chip
// oscillator are the documented HD38800 configuration summarised in
// docs/prd/jet-fighters-v2.md (R1). The subsystems this class wires together -
// registers.ts, memory.ts, ports.ts, timer.ts, alu.ts - each carry their own
// provenance notes, and the opcode encoding and flag rules are isa.ts's stated
// conventions.
//
// Scope. This is the whole machine: the execution pipeline (fetch, two-word
// fetch, decode, dispatch, cycle accounting, program counter rules) and a
// handler for every instruction the architecture defines. No instruction
// decodes to something the core then ignores; `unimplementedOpcodes` exists
// only as a guard against a future mnemonic landing in isa.ts without one.
//
// Pure logic only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - `step()` advances the machine by cycles and the caller decides how
// many to run.

import {
  add,
  clearBit,
  complement,
  decimalAdjustAdd,
  decimalAdjustSubtract,
  decrement,
  increment,
  negate,
  or,
  rotateLeft,
  rotateRight,
  setBit,
  subtract,
  testBit,
  type AluResult,
} from './alu.js';
import {
  formatInstruction,
  InstructionType,
  isTwoWord,
  type Instruction,
} from './instruction.js';
import { decode, longAddress } from './decoder.js';
import {
  Memory,
  ROM_PROGRAM_SIZE,
  ROM_SIZE,
  romAddress,
  romPage,
  type MemorySnapshot,
} from './memory.js';
import { Ports, type PortSnapshot } from './ports.js';
import { NIBBLE_MASK, PC_MASK, Registers, type RegisterSnapshot } from './registers.js';
import { Timer, type TimerSnapshot } from './timer.js';

/** Documented on-chip oscillator frequency of the HD38800, in hertz. */
export const OSCILLATOR_HZ = 400_000;

/**
 * Oscillator periods per machine cycle.
 *
 * The HMCS40 family divides its oscillator down to an instruction cycle, but
 * the divisor is not settled by our source material - the research fixes the
 * oscillator at ~400 kHz and nothing more (PRD R1). This core therefore counts
 * one cycle per oscillator period and says so, rather than inventing a divisor
 * that would silently rescale every timing in the machine. When the figure is
 * confirmed, changing this constant rescales the whole emulation at once:
 * cycle *counts* are hardware facts and stay put, cycle *duration* is here.
 */
export const CLOCK_DIVIDER = 1;

/** Machine cycles per second of emulated time. */
export const CYCLE_HZ = OSCILLATOR_HZ / CLOCK_DIVIDER;

/**
 * Machine cycles a standby cycle costs.
 *
 * SBY stops the CPU clock and leaves the oscillator and prescaler running, so
 * emulated time must keep passing while the core waits. `step()` in standby
 * charges this and advances the timer by it, which is what eventually wakes the
 * core.
 */
export const STANDBY_CYCLE_COST = 1;

/** Complete machine state at an instant, for tests, probes and debug UIs. */
export interface CPUState {
  /** Machine cycles executed since reset. */
  readonly cycles: number;
  /** False once STOP has executed; only `reset()` clears it. */
  readonly running: boolean;
  /** True between SBY and the timer or interrupt request that ends it. */
  readonly standby: boolean;
  /** Seconds of emulated time elapsed since reset. */
  readonly elapsedTime: number;
  /** Unassigned opcodes executed since reset. */
  readonly illegalOpcodes: number;
  /** Valid opcodes with no handler, executed since reset. Zero for this core. */
  readonly unimplementedOpcodes: number;
  readonly registers: RegisterSnapshot;
  readonly memory: MemorySnapshot;
  readonly ports: PortSnapshot;
  readonly timer: TimerSnapshot;
}

/**
 * The HMCS44 core.
 *
 * The subsystems are public and final: the board model wires itself to
 * `ports.onDChange` for grid strobes and D14 speaker edges, and the probe reads
 * `registers` and `memory` directly. Nothing here hides them behind
 * pass-through accessors that would only have to be widened later.
 *
 * Execution model, and the rules the rest of the machine depends on:
 *
 * - `step()` runs exactly one instruction and returns what it cost. The caller
 *   owns the clock; this class never schedules anything.
 * - Fetch increments the program counter *before* execution, so a call pushes
 *   the address of the following instruction and a branch overwrites a counter
 *   that already points past itself.
 * - The program counter wraps at 2048 rather than running into the pattern
 *   region above it, matching the 11-bit counter in registers.ts.
 * - The timer advances by exactly the cycles each instruction cost, including
 *   the cycles spent in standby.
 * - An unassigned opcode costs one cycle, advances the counter, and increments
 *   `illegalOpcodes`. It does not throw: a runaway counter is something the
 *   real device does, and a ROM under test must be able to exhibit it.
 */
export class HMCS44CPU {
  readonly registers = new Registers();
  readonly memory: Memory;
  readonly ports = new Ports();
  readonly timer = new Timer();

  private _cycles = 0;
  private _running = true;
  private _standby = false;
  private _illegalOpcodes = 0;
  private _unimplementedOpcodes = 0;

  /**
   * @param romImage Either a full `ROM_SIZE` (2176) word image, or the
   *   `ROM_PROGRAM_SIZE` (2048) word program region alone - the assembler (R2)
   *   emits the latter, and the pattern region above it is zero-filled. Any
   *   other length is rejected by `Memory`.
   */
  constructor(romImage: ArrayLike<number>) {
    this.memory = new Memory(padRom(romImage));
    this.reset();
  }

  /** Machine cycles executed since reset. */
  get cycles(): number {
    return this._cycles;
  }

  /** False once STOP has executed. */
  get running(): boolean {
    return this._running;
  }

  /**
   * True while the core is in standby.
   *
   * SBY stops the CPU clock only: the oscillator, prescaler and timer keep
   * running, and a timer overflow or an interrupt request resumes execution at
   * the instruction after the SBY. `running` stays true throughout - the core
   * is waiting, not halted.
   */
  get standby(): boolean {
    return this._standby;
  }

  /** Unassigned opcodes executed since reset. */
  get illegalOpcodes(): number {
    return this._illegalOpcodes;
  }

  /**
   * Valid opcodes reached with no handler.
   *
   * Zero for every opcode this architecture defines. It is kept, and counted
   * rather than ignored, so that a mnemonic added to isa.ts without an
   * execution handler shows up as a number instead of as an instruction that
   * silently does nothing.
   */
  get unimplementedOpcodes(): number {
    return this._unimplementedOpcodes;
  }

  /**
   * Power-on reset.
   *
   * Registers, ports and the timer clear, the program counter goes to 0, and
   * RAM returns to the undefined power-on fill rather than to zeroes - the real
   * unit's only reset is the power switch cutting the battery, and the game
   * program is expected to clear what it uses (PRD R4, memory.ts).
   */
  reset(): void {
    this.registers.reset();
    this.ports.reset();
    this.timer.reset();
    this.memory.powerOn();
    this._cycles = 0;
    this._running = true;
    this._standby = false;
    this._illegalOpcodes = 0;
    this._unimplementedOpcodes = 0;
  }

  /** Halt execution, as STOP does. Only `reset()` undoes it. */
  stop(): void {
    this._running = false;
  }

  /** Resume a halted core without clearing state. */
  start(): void {
    this._running = true;
  }

  /**
   * Drive one of the two external interrupt pins from the board.
   *
   * A falling edge raises that line's request flag, ends standby, and in counter
   * mode clocks the timer from INT0 (timer.ts).
   */
  setInterruptLine(line: number, level: number): void {
    this.timer.setInterruptLine(line, level);
  }

  /**
   * Fetch, decode and execute one instruction.
   *
   * @returns the machine cycles consumed - two for a long jump, a long call or a
   *   pattern read, one otherwise - or 0 when the core is halted, so a caller
   *   draining a cycle budget terminates instead of spinning. In standby it
   *   returns `STANDBY_CYCLE_COST` per call and executes nothing.
   */
  step(): number {
    if (!this._running) {
      return 0;
    }
    if (this._standby) {
      return this.standbyCycle();
    }

    const address = this.registers.pc;
    const instruction = decode(this.memory.readRom(address));
    this.registers.incrementPc();

    let secondWord = 0;
    if (isTwoWord(instruction)) {
      secondWord = this.memory.readRom(this.registers.pc);
      this.registers.incrementPc();
    }

    this.execute(instruction, address, secondWord);
    this._cycles += instruction.cycles;
    this.timer.tick(instruction.cycles);
    return instruction.cycles;
  }

  /**
   * Run until at least `cycles` machine cycles have elapsed, or the core halts.
   *
   * Instructions are indivisible, so this overshoots by at most one
   * instruction's cost; the overshoot is included in the return value and in
   * `cycles`, never discarded.
   *
   * @returns cycles actually executed.
   */
  run(cycles: number): number {
    let executed = 0;
    while (executed < cycles && this._running) {
      const cost = this.step();
      if (cost === 0) {
        break;
      }
      executed += cost;
    }
    return executed;
  }

  /** Machine cycles per second of emulated time. */
  getCyclesPerSecond(): number {
    return CYCLE_HZ;
  }

  /** Seconds of emulated time elapsed since reset. */
  getElapsedTime(): number {
    return this._cycles / CYCLE_HZ;
  }

  /** Complete machine state, snapshotted across every subsystem. */
  getState(): CPUState {
    return {
      cycles: this._cycles,
      running: this._running,
      standby: this._standby,
      elapsedTime: this.getElapsedTime(),
      illegalOpcodes: this._illegalOpcodes,
      unimplementedOpcodes: this._unimplementedOpcodes,
      registers: this.registers.snapshot(),
      memory: this.memory.snapshot(),
      ports: this.ports.snapshot(),
      timer: this.timer.snapshot(),
    };
  }

  /**
   * Render the instruction at `address` as assembly text.
   *
   * Reads a second ROM word for a long jump or call so the printed target is
   * the real one. Purely a debugging aid: it changes no state.
   */
  disassemble(address: number): string {
    const instruction = decode(this.memory.readRom(address));
    if (isTwoWord(instruction)) {
      const secondWord = this.memory.readRom((address + 1) & PC_MASK);
      return `${instruction.type} ${longAddress(instruction, secondWord)}`;
    }
    return formatInstruction(instruction);
  }

  /** The RAM nibble the pointers currently select - the operand the databook calls M. */
  private get ramAddress(): number {
    return this.memory.getEffectiveRamAddress(this.registers.x, this.registers.y);
  }

  private readM(): number {
    return this.memory.readRam(this.ramAddress);
  }

  private writeM(value: number): void {
    this.memory.writeRam(this.ramAddress, value);
  }

  /** One cycle of doing nothing but keeping time, and the wake check. */
  private standbyCycle(): number {
    this._cycles += STANDBY_CYCLE_COST;
    this.timer.tick(STANDBY_CYCLE_COST);
    if (this.timer.pending) {
      this._standby = false;
    }
    return STANDBY_CYCLE_COST;
  }

  /**
   * Execute one decoded instruction.
   *
   * @param address the address the opcode was fetched from. Branches are
   *   page-relative to *this*, not to the already-incremented program counter,
   *   so a branch in the last word of a page targets its own page rather than
   *   the next one.
   * @param secondWord the word following a two-word instruction, else 0.
   */
  private execute(instruction: Instruction, address: number, secondWord: number): void {
    const regs = this.registers;
    const operand = instruction.operands[0] ?? 0;

    switch (instruction.type) {
      // --- Control -----------------------------------------------------
      case InstructionType.NOP:
        break;

      case InstructionType.SBY:
        // The CPU clock stops; the oscillator, prescaler and timer do not. A
        // timer overflow or interrupt request resumes the core where it left
        // off (see `standbyCycle`).
        this._standby = true;
        break;

      case InstructionType.STOP:
        // The oscillator itself halts. Nothing on the device can restart it -
        // on the real unit only the power switch does (PRD R4).
        this._running = false;
        break;

      // --- ALU: carry-affecting arithmetic ------------------------------
      case InstructionType.AM:
        this.writeAccumulatorA(add(regs.a, this.readM()));
        break;

      case InstructionType.AMC:
        this.writeAccumulatorA(add(regs.a, this.readM(), regs.carry));
        break;

      case InstructionType.SMC:
        // M - A, not A - M: the family's subtract takes the memory operand as
        // the minuend (instruction.ts), which is what makes a multi-digit BCD
        // subtraction walk RAM rather than the accumulator.
        this.writeAccumulatorA(subtract(this.readM(), regs.a, regs.carry));
        break;

      case InstructionType.AI:
        this.writeAccumulatorA(add(regs.a, operand));
        break;

      case InstructionType.DAA:
        this.writeAccumulatorA(decimalAdjustAdd(regs.a, regs.carry));
        break;

      case InstructionType.DAS:
        this.writeAccumulatorA(decimalAdjustSubtract(regs.a, regs.carry));
        break;

      case InstructionType.ROTR:
        this.writeAccumulatorA(rotateRight(regs.a, regs.carry));
        break;

      case InstructionType.ROTL:
        this.writeAccumulatorA(rotateLeft(regs.a, regs.carry));
        break;

      // --- ALU: no carry effect (isa.ts, flag rule 1) -------------------
      case InstructionType.NEGA:
        regs.a = negate(regs.a).value;
        break;

      case InstructionType.COMB:
        regs.b = complement(regs.b).value;
        break;

      case InstructionType.OR:
        regs.a = or(regs.a, regs.b).value;
        break;

      case InstructionType.SEC:
        regs.carry = true;
        break;

      case InstructionType.REC:
        regs.carry = false;
        break;

      case InstructionType.TC:
        regs.status = regs.carry ? 1 : 0;
        break;

      // --- ALU: counters, which land in ST (isa.ts, flag rule 3) --------
      case InstructionType.IB:
        this.writeAccumulatorB(increment(regs.b), (result) => result.carry);
        break;

      case InstructionType.DB:
        this.writeAccumulatorB(decrement(regs.b), (result) => !result.carry);
        break;

      case InstructionType.IY:
        this.writePointerY(increment(this.yNibble), (result) => result.carry);
        break;

      case InstructionType.DY:
        this.writePointerY(decrement(this.yNibble), (result) => !result.carry);
        break;

      case InstructionType.AYY:
        this.writePointerY(add(this.yNibble, regs.a), (result) => result.carry);
        break;

      case InstructionType.SYY:
        this.writePointerY(subtract(this.yNibble, regs.a), (result) => !result.carry);
        break;

      // --- Comparisons: every one of these lands in ST, nothing else ----
      case InstructionType.ALEM:
        regs.status = regs.a <= this.readM() ? 1 : 0;
        break;

      case InstructionType.ALEI:
        regs.status = regs.a <= operand ? 1 : 0;
        break;

      case InstructionType.BLEM:
        regs.status = regs.b <= this.readM() ? 1 : 0;
        break;

      case InstructionType.ANEM:
        regs.status = regs.a !== this.readM() ? 1 : 0;
        break;

      case InstructionType.BNEM:
        regs.status = regs.b !== this.readM() ? 1 : 0;
        break;

      case InstructionType.YNEA:
        regs.status = this.yNibble !== regs.a ? 1 : 0;
        break;

      case InstructionType.YNEI:
        regs.status = this.yNibble !== operand ? 1 : 0;
        break;

      case InstructionType.MNEI:
        regs.status = this.readM() !== operand ? 1 : 0;
        break;

      // --- Loads and exchanges ------------------------------------------
      case InstructionType.LAB:
        regs.a = regs.b;
        break;

      case InstructionType.LBA:
        regs.b = regs.a;
        break;

      case InstructionType.LAY:
        regs.a = this.yNibble;
        break;

      case InstructionType.LASPX:
        regs.a = regs.spx;
        break;

      case InstructionType.LASPY:
        regs.a = regs.spy;
        break;

      case InstructionType.LAM:
        regs.a = this.readM();
        break;

      case InstructionType.LBM:
        regs.b = this.readM();
        break;

      case InstructionType.LAI:
        regs.a = operand;
        break;

      case InstructionType.LBI:
        regs.b = operand;
        break;

      case InstructionType.LXA:
        regs.x = regs.a;
        break;

      case InstructionType.LYA:
        regs.y = regs.a;
        break;

      case InstructionType.LXI:
        regs.x = operand;
        break;

      case InstructionType.LYI:
        regs.y = operand;
        break;

      case InstructionType.XMA: {
        const nibble = this.readM();
        this.writeM(regs.a);
        regs.a = nibble;
        break;
      }

      case InstructionType.XMB: {
        const nibble = this.readM();
        this.writeM(regs.b);
        regs.b = nibble;
        break;
      }

      case InstructionType.XSP:
        regs.swapXY();
        break;

      case InstructionType.TM:
        regs.status = testBit(this.readM(), operand);
        break;

      case InstructionType.P: {
        // A pattern table is 16 words of the pattern region, indexed by A; the
        // operand selects the table. The word's low two nibbles land in A and B,
        // which is how the ROM turns a BCD digit into a plate pattern (PRD R3).
        const word = this.memory.readRom(ROM_PROGRAM_SIZE + (operand << 4) + regs.a);
        regs.a = word & NIBBLE_MASK;
        regs.b = (word >>> 4) & NIBBLE_MASK;
        break;
      }

      // --- Stores --------------------------------------------------------
      case InstructionType.LMAIY:
        this.writeM(regs.a);
        this.writePointerY(increment(this.yNibble), (result) => result.carry);
        break;

      case InstructionType.LMADY:
        this.writeM(regs.a);
        this.writePointerY(decrement(this.yNibble), (result) => !result.carry);
        break;

      case InstructionType.LMIIY:
        this.writeM(operand);
        this.writePointerY(increment(this.yNibble), (result) => result.carry);
        break;

      case InstructionType.SEM:
        this.writeM(setBit(this.readM(), operand));
        break;

      case InstructionType.REM:
        this.writeM(clearBit(this.readM(), operand));
        break;

      // --- Control transfer ---------------------------------------------
      case InstructionType.BR:
        this.branchIf(romAddress(romPage(address), operand));
        break;

      case InstructionType.CAL:
        this.callIf(romAddress(0, operand));
        break;

      case InstructionType.JMPL:
        this.branchIf(longAddress(instruction, secondWord));
        break;

      case InstructionType.CALL:
        this.callIf(longAddress(instruction, secondWord));
        break;

      case InstructionType.TBR:
        // The computed branch: a five-bit in-page offset assembled from both
        // accumulators, because one 4-bit accumulator cannot span a 32-word
        // page (isa.ts).
        this.branchIf(romAddress(romPage(address), ((regs.b & 1) << 4) | regs.a));
        break;

      case InstructionType.RTN:
        regs.pc = regs.pop();
        break;

      case InstructionType.RTNI:
        // Return *and* re-enable interrupts: the handler runs with IE clear and
        // hands it back on the way out, so a handler cannot be re-entered.
        regs.pc = regs.pop();
        this.timer.setInterruptEnabled(true);
        break;

      // --- Ports ---------------------------------------------------------
      case InstructionType.SED:
        this.ports.writeD(operand, 1);
        break;

      case InstructionType.RED:
        this.ports.writeD(operand, 0);
        break;

      case InstructionType.TD:
        regs.status = this.ports.readD(operand);
        break;

      case InstructionType.SEDY:
        this.ports.writeD(this.yNibble, 1);
        break;

      case InstructionType.REDY:
        this.ports.writeD(this.yNibble, 0);
        break;

      case InstructionType.TDY:
        regs.status = this.ports.readD(this.yNibble);
        break;

      case InstructionType.LAR:
        regs.a = this.ports.readRNibble(operand);
        break;

      case InstructionType.LBR:
        regs.b = this.ports.readRNibble(operand);
        break;

      case InstructionType.LRA:
        this.ports.writeRNibble(operand, regs.a);
        break;

      case InstructionType.LRB:
        this.ports.writeRNibble(operand, regs.b);
        break;

      case InstructionType.XAMR: {
        // Reads the *resolved* pin state, not the latch: an open-drain pin the
        // ROM released reads back whatever the board is driving (ports.ts).
        const pins = this.ports.readRNibble(operand);
        this.ports.writeRNibble(operand, regs.a);
        regs.a = pins;
        break;
      }

      // --- Timer, prescaler and interrupt flags ---------------------------
      case InstructionType.LTI:
        this.timer.load(operand);
        break;

      case InstructionType.LTA:
        this.timer.load(regs.a);
        break;

      case InstructionType.LAT:
        regs.a = this.timer.counter;
        break;

      case InstructionType.LPI:
        this.timer.setPrescalerSelect(operand);
        break;

      case InstructionType.TTF:
        regs.status = this.timer.timerFlag ? 1 : 0;
        break;

      case InstructionType.SETF:
        this.timer.setTimerFlag(true);
        break;

      case InstructionType.RETF:
        this.timer.setTimerFlag(false);
        break;

      case InstructionType.SECF:
        this.timer.setCounterMode(true);
        break;

      case InstructionType.RECF:
        this.timer.setCounterMode(false);
        break;

      case InstructionType.SEIE:
        this.timer.setInterruptEnabled(true);
        break;

      case InstructionType.REIE:
        this.timer.setInterruptEnabled(false);
        break;

      case InstructionType.SEIF0:
        this.timer.setInterruptFlag(0, true);
        break;

      case InstructionType.REIF0:
        this.timer.setInterruptFlag(0, false);
        break;

      case InstructionType.SEIF1:
        this.timer.setInterruptFlag(1, true);
        break;

      case InstructionType.REIF1:
        this.timer.setInterruptFlag(1, false);
        break;

      case InstructionType.TI0:
        regs.status = this.timer.interruptLine(0);
        break;

      case InstructionType.TI1:
        regs.status = this.timer.interruptLine(1);
        break;

      case InstructionType.TIF0:
        regs.status = this.timer.interruptFlag(0) ? 1 : 0;
        break;

      case InstructionType.TIF1:
        regs.status = this.timer.interruptFlag(1) ? 1 : 0;
        break;

      // --- Not executable --------------------------------------------------
      case InstructionType.UNKNOWN:
        this._illegalOpcodes += 1;
        break;

      default:
        // Unreachable for every instruction isa.ts defines - and counted rather
        // than ignored so that if one is ever added without a handler here, it
        // shows up as a number instead of as a silent no-op.
        this._unimplementedOpcodes += 1;
        break;
    }
  }

  /** The four bits of Y that address RAM and take part in the arithmetic. */
  private get yNibble(): number {
    return this.registers.y & NIBBLE_MASK;
  }

  /** Land an ALU result in A, carry and all. */
  private writeAccumulatorA(result: AluResult): void {
    this.registers.a = result.value;
    this.registers.carry = result.carry;
  }

  /**
   * Land a counter result in B: the value, and ST per flag rule 3 - 1 unless the
   * operation wrapped out of four bits.
   */
  private writeAccumulatorB(result: AluResult, wrapped: (result: AluResult) => boolean): void {
    this.registers.b = result.value;
    this.registers.status = wrapped(result) ? 0 : 1;
  }

  /**
   * Land a counter result in Y.
   *
   * Only the low four bits of the six-bit Y register address RAM, and only those
   * four take part in the arithmetic; the top two are preserved, so a pointer
   * set up through XSP survives an IY loop rather than being silently cleared.
   */
  private writePointerY(result: AluResult, wrapped: (result: AluResult) => boolean): void {
    this.registers.y = (this.registers.y & ~NIBBLE_MASK) | result.value;
    this.registers.status = wrapped(result) ? 0 : 1;
  }

  /**
   * Take a branch when ST is 1, then return ST to 1.
   *
   * The status flag is the family's single branch condition: a comparison sets
   * it, the next branch consumes it, and the flag returns to 1 so an
   * unconditional branch needs no preparation (registers.ts, isa.ts rule 4).
   */
  private branchIf(target: number): void {
    if (this.registers.status === 1) {
      this.registers.pc = target;
    }
    this.registers.status = 1;
  }

  /** As `branchIf`, pushing the address of the following instruction first. */
  private callIf(target: number): void {
    if (this.registers.status === 1) {
      this.registers.push(this.registers.pc);
      this.registers.pc = target;
    }
    this.registers.status = 1;
  }
}

/**
 * Accept a program-region-only image by zero-filling the pattern region above
 * it. Any other length falls through to `Memory`, which names both the expected
 * and the actual size in its error.
 */
function padRom(romImage: ArrayLike<number>): ArrayLike<number> {
  if (romImage.length !== ROM_PROGRAM_SIZE) {
    return romImage;
  }
  const padded = new Uint16Array(ROM_SIZE);
  padded.set(Uint16Array.from(romImage));
  return padded;
}
