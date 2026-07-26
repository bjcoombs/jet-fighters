// HMCS44 (Hitachi HD38800) CPU core: fetch, decode, execute.
//
// Sources: the register set, memory sizes, port topology and ~400 kHz on-chip
// oscillator are the documented HD38800 configuration summarised in
// docs/prd/jet-fighters-v2.md (R1). The subsystems this class wires together -
// registers.ts, memory.ts, ports.ts - each carry their own provenance notes,
// and the opcode encoding is decoder.ts's stated convention.
//
// Scope. This is the execution *pipeline*: fetch, two-word fetch, decode,
// dispatch, cycle accounting and the program counter rules. A representative
// instruction from each category is implemented so the pipeline is exercised
// end to end; the rest decode correctly and are counted as unimplemented
// rather than silently doing nothing plausible. The full instruction set lands
// on top of this seam without reshaping it.
//
// Pure logic only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - `step()` advances the machine by cycles and the caller decides how
// many to run.

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
import { PC_MASK, Registers, type RegisterSnapshot } from './registers.js';

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

/** Complete machine state at an instant, for tests, probes and debug UIs. */
export interface CPUState {
  /** Machine cycles executed since reset. */
  readonly cycles: number;
  /** False once STOP or SBY has executed; only `reset()` clears it. */
  readonly running: boolean;
  /** Seconds of emulated time elapsed since reset. */
  readonly elapsedTime: number;
  /** Unassigned opcodes executed since reset. */
  readonly illegalOpcodes: number;
  /** Valid opcodes with no handler yet, executed since reset. */
  readonly unimplementedOpcodes: number;
  readonly registers: RegisterSnapshot;
  readonly memory: MemorySnapshot;
  readonly ports: PortSnapshot;
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
 * - An unassigned opcode costs one cycle, advances the counter, and increments
 *   `illegalOpcodes`. It does not throw: a runaway counter is something the
 *   real device does, and a ROM under test must be able to exhibit it.
 */
export class HMCS44CPU {
  readonly registers = new Registers();
  readonly memory: Memory;
  readonly ports = new Ports();

  private _cycles = 0;
  private _running = true;
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

  /** False once STOP or SBY has executed. */
  get running(): boolean {
    return this._running;
  }

  /** Unassigned opcodes executed since reset. */
  get illegalOpcodes(): number {
    return this._illegalOpcodes;
  }

  /** Valid opcodes reached before their handler exists. Zero once R1 is done. */
  get unimplementedOpcodes(): number {
    return this._unimplementedOpcodes;
  }

  /**
   * Power-on reset.
   *
   * Registers and ports clear, the program counter goes to 0, and RAM returns
   * to the undefined power-on fill rather than to zeroes - the real unit's only
   * reset is the power switch cutting the battery, and the game program is
   * expected to clear what it uses (PRD R4, memory.ts).
   */
  reset(): void {
    this.registers.reset();
    this.ports.reset();
    this.memory.powerOn();
    this._cycles = 0;
    this._running = true;
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
   * Fetch, decode and execute one instruction.
   *
   * @returns the machine cycles consumed - two for a long jump or call, one
   *   otherwise - or 0 when the core is halted, so a caller draining a cycle
   *   budget terminates instead of spinning.
   */
  step(): number {
    if (!this._running) {
      return 0;
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
      elapsedTime: this.getElapsedTime(),
      illegalOpcodes: this._illegalOpcodes,
      unimplementedOpcodes: this._unimplementedOpcodes,
      registers: this.registers.snapshot(),
      memory: this.memory.snapshot(),
      ports: this.ports.snapshot(),
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

      case InstructionType.STOP:
      case InstructionType.SBY:
        // SBY stops the CPU clock while the oscillator and timer keep running,
        // so on hardware a timer interrupt resumes it. This core has no timer
        // yet (R1), so both instructions halt until reset, and `running` says
        // so rather than the core spinning through NOPs it cannot leave.
        this._running = false;
        break;

      // --- ALU and carry -----------------------------------------------
      case InstructionType.AM:
        this.addToA(this.readM());
        break;

      case InstructionType.AI:
        this.addToA(operand);
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

      case InstructionType.IY:
        regs.y = regs.y + 1;
        break;

      case InstructionType.DY:
        regs.y = regs.y - 1;
        break;

      case InstructionType.ALEI:
        regs.status = regs.a <= operand ? 1 : 0;
        break;

      // --- Loads --------------------------------------------------------
      case InstructionType.LAI:
        regs.a = operand;
        break;

      case InstructionType.LBI:
        regs.b = operand;
        break;

      case InstructionType.LXI:
        regs.x = operand;
        break;

      case InstructionType.LYI:
        regs.y = operand;
        break;

      case InstructionType.LAB:
        regs.a = regs.b;
        break;

      case InstructionType.LBA:
        regs.b = regs.a;
        break;

      case InstructionType.LAM:
        regs.a = this.readM();
        break;

      // --- Stores -------------------------------------------------------
      case InstructionType.LMAIY:
        this.writeM(regs.a);
        regs.y = regs.y + 1;
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

      case InstructionType.RTN:
        regs.pc = regs.pop();
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

      case InstructionType.LRA:
        this.ports.writeRNibble(operand, regs.a);
        break;

      // --- Not executable --------------------------------------------------
      case InstructionType.UNKNOWN:
        this._illegalOpcodes += 1;
        break;

      default:
        // Decoded correctly, no handler yet. Counted rather than ignored, so a
        // ROM running against a partial core cannot quietly appear to work.
        this._unimplementedOpcodes += 1;
        break;
    }
  }

  /**
   * A + `value` -> A, carrying out of bit 3.
   *
   * The carry flag takes the carry-out. Whether the family's plain adds also
   * land in ST is not settled by our source material, so this core leaves ST to
   * the comparison instructions, which exist precisely to set it. That is a
   * stated convention: our own assembler and ROM are written against it.
   */
  private addToA(value: number): void {
    const sum = this.registers.a + value;
    this.registers.carry = sum > 0x0f;
    this.registers.a = sum;
  }

  /**
   * Take a branch when ST is 1, then return ST to 1.
   *
   * The status flag is the family's single branch condition: a comparison sets
   * it, the next branch consumes it, and the flag returns to 1 so an
   * unconditional branch needs no preparation (registers.ts).
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
