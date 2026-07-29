// TMS1370 (TMS1100 core) execution engine: fetch, decode, execute, one
// instruction per instruction cycle.
//
// Sources are `docs/research/tms1370-architecture.md` throughout - §2 for ROM
// paging and the branch/call rules, §3 for RAM addressing, §4 for the register
// set, §5 for instruction semantics, §6 for timing, §7 for reset. Where a
// behaviour is settled by both MAME and TI's Dec 1976 manual the research
// document says so, and those are the claims this engine leans on hardest.
//
// What this file does *not* own, and deliberately imports instead:
//
//   - `registers.ts` - the register file, the LFSR program counter, and the
//     `CA:PA:PC` address composition. The one-level return state is a method
//     pair there (`saveReturnState`/`restoreReturnState`) precisely so the
//     "a CALL inside a subroutine saves no return address" rule is a capability
//     of the register file rather than an `if` in this switch.
//   - `ram.ts` - the 128x4 data RAM, whose `reset()` is a documented no-op.
//   - `memory.ts` - the 2048x8 program ROM.
//   - `isa.ts` / `decoder.ts` - the opcode table and its decode cache.
//   - `opla.ts` - the 32-slot output PLA, and with it the fact that this core's
//     O state is a 5-bit index and never an 8-bit mask.
//   - `ports.ts` - the pin budget: which R lines are grids, strobes, plates and
//     speaker, and how wide K is. The engine drives pins by index and takes no
//     position on what they are wired to; `Tms1370Ports` is what a board adapts
//     {@link Tms1370Pins} to, and cpu.test.ts drives one to show they compose
//     rather than compete.
//   - `timing.ts` - the oscillator frequency and the divide-by-six. **No rate
//     appears in this file.** `runOscillatorPulses` divides by
//     {@link OSCILLATOR_PULSES_PER_INSTRUCTION}, which is `CLOCK_DIVIDER`, so
//     refining the oscillator constant moves this engine without touching it.
//
// Pure state only: no DOM, no timers, no Web APIs. The engine has no clock of
// its own - it advances only when stepped.

import { decode, type Instruction } from './decoder.js';
import { CYCLES_PER_INSTRUCTION, Mnemonic } from './isa.js';
import {
  DARK_OUTPUT_PLA,
  O_RESET_INDEX,
  Tms1370OutputPla,
  type Tms1370OutputSink,
} from './opla.js';
import { K_MASK } from './ports.js';
import { Tms1370Ram } from './ram.js';
import { Tms1370Rom } from './memory.js';
import {
  NIBBLE_MASK,
  R_OUTPUT_COUNT,
  Tms1370Registers,
  X_MASK,
  type Tms1370RegisterSnapshot,
} from './registers.js';
import { CLOCK_DIVIDER } from './timing.js';

/**
 * Oscillator pulses one instruction costs.
 *
 * `CLOCK_DIVIDER` from timing.ts, under the name this engine's callers use.
 * "Six oscillator pulses constitute one instruction cycle. All instructions are
 * executed in one instruction cycle" (S3 §2.8, research doc §6) - the one timing
 * figure confirmed three independent ways. It is re-exported rather than
 * restated so there is exactly one six in the tree, and no instruction rate at
 * all: a cycles-per-second figure is the caller's to derive from `CYCLE_HZ`.
 */
export const OSCILLATOR_PULSES_PER_INSTRUCTION = CLOCK_DIVIDER;

/**
 * Mask of the K input port, from the port file's pin budget.
 *
 * Re-exported rather than restated: `ports.ts` owns which pins exist and what
 * they are wired to, and this engine only samples them.
 */
export { K_MASK, K_PIN_COUNT } from './ports.js';

/**
 * Bit of X that SETR/RSTR use as a fifth R-index bit.
 *
 * MAME's TMS1100-family override computes `index = BIT(X, 2) << 4 | Y` (S1
 * `tms1100.cpp:77-92`, research doc §3), while TI states the programmer must
 * keep X below four when setting or resetting an R output (S3 §3.3). On a
 * 16-output part the two are consistent - every R line is reachable with X < 4 -
 * but the consequence is that **X is not free at the moment an R output is
 * written**, and a display sweep keeping its state in file 4-7 addresses an R
 * line that does not exist. The register file drops out-of-range indices, so
 * that mistake goes nowhere rather than wrapping onto a real output.
 */
export const R_INDEX_X_BIT = 2;

/** The bit of X that COMX complements. Only the MSB, on this core (research doc §5). */
export const X_MSB = (X_MASK + 1) >> 1;

/** Pins the core drives and samples. Every member is optional; a bare core runs headless. */
export interface Tms1370Pins extends Partial<Tms1370OutputSink> {
  /** Sample the 4-bit K input port. `KNEZ` and `TKA` read it. */
  readK?(): number;
  /** One R output latch changed. Reset clears all sixteen and reports each. */
  writeR?(index: number, on: boolean): void;
}

/** Construction options. Every part is optional and defaults to an empty one. */
export interface Tms1370CpuOptions {
  /** The 2048x8 program ROM. Defaults to an all-`MNEA` image. */
  rom?: Tms1370Rom;
  /** The 128x4 data RAM. Defaults to a fresh one, which reset never clears. */
  ram?: Tms1370Ram;
  /** The 32-slot output PLA. Defaults to {@link DARK_OUTPUT_PLA}. */
  outputPla?: Tms1370OutputPla;
  /** Where O and R writes go, and where K is read from. */
  pins?: Tms1370Pins;
}

/** Immutable snapshot of the whole core, for tests and debug UIs. */
export interface Tms1370CpuSnapshot {
  readonly registers: Tms1370RegisterSnapshot;
  /** Instruction cycles executed since the last reset. */
  readonly cycles: number;
  /** The 5-bit index last written to the O register. Never a plate mask. */
  readonly oIndex: number;
  /** The opcode most recently executed, or `null` before the first step. */
  readonly lastOpcode: number | null;
}

/**
 * The TMS1370 core.
 *
 * One instruction per instruction cycle, always. Fetch reads `CA:PA:PC`, the
 * program counter steps along its LFSR sequence, and only then does the
 * instruction execute - which is why a CALL saves the *following* word as its
 * return address without any special case.
 *
 * Status handling reproduces the pipeline the family's branch rule depends on
 * (research doc §5, "Status semantics"). A branch or call tests the status the
 * **previous** instruction left; status is then re-armed to 1 and this
 * instruction may clear it. That ordering is what makes TI's rule true - "if an
 * instruction that does not affect status is placed between an instruction that
 * does affect status and a branch [...] then the branch is always successful"
 * (S3 §2.9) - and getting it backwards would make every branch unconditional.
 */
export class Tms1370Cpu {
  readonly registers = new Tms1370Registers();
  readonly rom: Tms1370Rom;
  readonly ram: Tms1370Ram;
  readonly outputPla: Tms1370OutputPla;

  private readonly pins: Tms1370Pins;
  private _cycles = 0;
  private _oIndex = O_RESET_INDEX;
  private _lastOpcode: number | null = null;
  private pulseResidue = 0;

  constructor(options: Tms1370CpuOptions = {}) {
    this.rom = options.rom ?? new Tms1370Rom();
    this.ram = options.ram ?? new Tms1370Ram();
    this.outputPla = options.outputPla ?? DARK_OUTPUT_PLA;
    this.pins = options.pins ?? {};
    this.reset();
  }

  /** Instruction cycles executed since the last reset. */
  get cycles(): number {
    return this._cycles;
  }

  /**
   * The 5-bit `status_latch:accumulator` index last written to the O register.
   *
   * This is the core's entire O state. There is no 8-bit field behind it: the
   * plate pattern is {@link outputPla}'s to produce and it can only produce one
   * of its own 32 slots.
   */
  get oIndex(): number {
    return this._oIndex;
  }

  /** The eight O lines the output PLA decodes {@link oIndex} to. */
  get oLines(): number {
    return this.outputPla.decode(this._oIndex);
  }

  /** The 16 R output latches as a bit field, R0 in bit 0. */
  get r(): number {
    return this.registers.r;
  }

  /** The opcode most recently executed, or `null` before the first step. */
  get lastOpcode(): number | null {
    return this._lastOpcode;
  }

  /** The physical ROM address the next fetch will read. */
  get romAddress(): number {
    return this.registers.romAddress;
  }

  /**
   * INIT reset (research doc §7).
   *
   * Chapter 0, page 15, PC 0; R outputs cleared; the O register written with
   * index 0; status 0; call latch clear. **RAM is not cleared** - `ram.reset()`
   * is called and is a documented no-op, so that the property is a call site
   * with a defined behaviour rather than an argument from a missing line. The
   * ROM's own clear routine costs real instruction time before the first display
   * sweep, and that cost is a power-on behaviour the machine actually has.
   */
  reset(): void {
    this.registers.reset();
    this.ram.reset();
    this._cycles = 0;
    this._lastOpcode = null;
    this.pulseResidue = 0;
    for (let index = 0; index < R_OUTPUT_COUNT; index += 1) {
      this.pins.writeR?.(index, false);
    }
    this.writeO(O_RESET_INDEX);
  }

  /**
   * Execute one instruction.
   *
   * Returns its cost in instruction cycles, which is always
   * {@link CYCLES_PER_INSTRUCTION} on this core - returned rather than assumed
   * so a caller accumulating cycles reads the same number the engine counted.
   */
  step(): number {
    const registers = this.registers;
    const opcode = this.rom.readAt(registers.ca, registers.pa, registers.pc);
    const instruction = decode(opcode);

    // Fetch has happened; the program counter now addresses the following word.
    // A CALL executed below therefore saves the return address without knowing
    // it is one.
    registers.stepPc();

    // The branch condition is the status the previous instruction left. Re-arm
    // afterwards: status is 1 unless this instruction clears it.
    const branchCondition = registers.status;
    registers.status = 1;

    this.execute(instruction, branchCondition);

    this._lastOpcode = opcode;
    this._cycles += CYCLES_PER_INSTRUCTION;
    return CYCLES_PER_INSTRUCTION;
  }

  /** Execute `count` instructions. Returns the instruction cycles consumed. */
  run(count: number): number {
    let consumed = 0;
    for (let executed = 0; executed < count; executed += 1) {
      consumed += this.step();
    }
    return consumed;
  }

  /**
   * Advance the core by a number of oscillator pulses, executing one instruction
   * per {@link OSCILLATOR_PULSES_PER_INSTRUCTION}. Returns instructions executed.
   *
   * The leftover pulses are carried, so a caller stepping the machine in
   * arbitrary slices gets the same instruction count as one stepping it in
   * multiples of six. This is the divide-by-six expressed as machinery rather
   * than as a comment, and it is the only place the two rates meet.
   */
  runOscillatorPulses(pulses: number): number {
    this.pulseResidue += pulses;
    let executed = 0;
    while (this.pulseResidue >= OSCILLATOR_PULSES_PER_INSTRUCTION) {
      this.pulseResidue -= OSCILLATOR_PULSES_PER_INSTRUCTION;
      this.step();
      executed += 1;
    }
    return executed;
  }

  /** Immutable snapshot of the whole core. */
  snapshot(): Tms1370CpuSnapshot {
    return Object.freeze({
      registers: this.registers.snapshot(),
      cycles: this._cycles,
      oIndex: this._oIndex,
      lastOpcode: this._lastOpcode,
    });
  }

  /** The RAM nibble the core currently addresses, at `X:Y`. */
  private readRam(): number {
    return this.ram.read(this.registers.x, this.registers.y);
  }

  /** Write the RAM nibble the core currently addresses, at `X:Y`. */
  private writeRam(value: number): void {
    this.ram.write(this.registers.x, this.registers.y, value);
  }

  /**
   * Write the O register.
   *
   * The only O write path there is, and its parameter is an index. The value is
   * masked by the register file's `oIndex` composition and again by the PLA's
   * decode, so no caller and no instruction can name an output the table does
   * not hold (contract V4).
   */
  private writeO(index: number): void {
    this._oIndex = index;
    this.pins.writeOIndex?.(index);
  }

  /** Set or reset one R output latch, reporting the change to the pins. */
  private setR(index: number, on: boolean): void {
    this.registers.setR(index, on);
    if (index >= 0 && index < R_OUTPUT_COUNT) {
      this.pins.writeR?.(index, on);
    }
  }

  /**
   * The R output SETR/RSTR address.
   *
   * `BIT(X, 2) << 4 | Y` - see {@link R_INDEX_X_BIT}. With X < 4, as the
   * programmer is required to keep it, this is simply Y.
   */
  private rOutputIndex(): number {
    return (((this.registers.x >> R_INDEX_X_BIT) & 1) << 4) | this.registers.y;
  }

  /** Sample the K input port. */
  private readK(): number {
    return (this.pins.readK?.() ?? 0) & K_MASK;
  }

  /**
   * Four-bit adder, as every arithmetic instruction on this core uses it.
   *
   * Subtraction is addition of the complement: `M - A` is `M + ~A + 1`, and
   * `Y - 1` is `Y + 15`. The carry out is what reaches status, which is why
   * "borrow" never appears in this engine - the family's own documentation
   * states these as adds, and stating them any other way inverts the status
   * sense on exactly the instructions that are hardest to test by inspection.
   */
  private static add(left: number, right: number, carryIn = 0): { sum: number; carry: number } {
    const total = (left & NIBBLE_MASK) + (right & NIBBLE_MASK) + carryIn;
    return { sum: total & NIBBLE_MASK, carry: total > NIBBLE_MASK ? 1 : 0 };
  }

  private execute(instruction: Instruction, branchCondition: number): void {
    const registers = this.registers;
    const value = instruction.value;

    switch (instruction.mnemonic) {
      // --- Compare: status only -------------------------------------------
      case Mnemonic.MNEA:
        registers.status = this.readRam() !== registers.a ? 1 : 0;
        break;
      case Mnemonic.MNEZ:
        registers.status = this.readRam() !== 0 ? 1 : 0;
        break;
      case Mnemonic.ALEM: {
        // A <= M, through the same M + ~A + 1 adder SAMAN uses.
        const { carry } = Tms1370Cpu.add(this.readRam(), ~registers.a, 1);
        registers.status = carry;
        break;
      }
      case Mnemonic.YNEA:
        // The one instruction that loads the status latch, and therefore the
        // only way the fifth bit of the O index is ever set. Standard-set
        // semantics: MP2110's own microinstruction PLA is the artifact contract
        // V13 is recorded `undriven` for, and nothing here claims otherwise.
        registers.status = registers.y !== registers.a ? 1 : 0;
        registers.statusLatch = registers.status;
        break;
      case Mnemonic.YNEC:
        registers.status = registers.y !== value ? 1 : 0;
        break;
      case Mnemonic.TBIT:
        registers.status = this.ram.readBit(registers.x, registers.y, value) ? 1 : 0;
        break;

      // --- Register and memory transfer ------------------------------------
      case Mnemonic.TAY:
        registers.y = registers.a;
        break;
      case Mnemonic.TYA:
        registers.a = registers.y;
        break;
      case Mnemonic.CLA:
        registers.a = 0;
        break;
      case Mnemonic.TMA:
        registers.a = this.readRam();
        break;
      case Mnemonic.TMY:
        registers.y = this.readRam();
        break;
      case Mnemonic.TAM:
        this.writeRam(registers.a);
        break;
      case Mnemonic.TAMZA:
        this.writeRam(registers.a);
        registers.a = 0;
        break;
      case Mnemonic.XMA: {
        const memory = this.readRam();
        this.writeRam(registers.a);
        registers.a = memory;
        break;
      }
      case Mnemonic.TCY:
        registers.y = value;
        break;
      case Mnemonic.TCMIY: {
        this.writeRam(value);
        // Y + 1 with no carry into status: unlike IYC, this instruction carries
        // no status microinstruction.
        registers.y = Tms1370Cpu.add(registers.y, 1).sum;
        break;
      }

      // --- Arithmetic -------------------------------------------------------
      case Mnemonic.AMAAC: {
        const { sum, carry } = Tms1370Cpu.add(registers.a, this.readRam());
        registers.a = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.SAMAN: {
        const { sum, carry } = Tms1370Cpu.add(this.readRam(), ~registers.a, 1);
        registers.a = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.IMAC: {
        const { sum, carry } = Tms1370Cpu.add(this.readRam(), 1);
        registers.a = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.DMAN: {
        const { sum, carry } = Tms1370Cpu.add(this.readRam(), NIBBLE_MASK);
        registers.a = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.ANAAC: {
        const { sum, carry } = Tms1370Cpu.add(registers.a, value);
        registers.a = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.CPAIZ: {
        const { sum, carry } = Tms1370Cpu.add(~registers.a, 0, 1);
        registers.a = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.IYC: {
        const { sum, carry } = Tms1370Cpu.add(registers.y, 1);
        registers.y = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.DYN: {
        const { sum, carry } = Tms1370Cpu.add(registers.y, NIBBLE_MASK);
        registers.y = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.TAMIYC: {
        this.writeRam(registers.a);
        const { sum, carry } = Tms1370Cpu.add(registers.y, 1);
        registers.y = sum;
        registers.status = carry;
        break;
      }
      case Mnemonic.TAMDYN: {
        this.writeRam(registers.a);
        const { sum, carry } = Tms1370Cpu.add(registers.y, NIBBLE_MASK);
        registers.y = sum;
        registers.status = carry;
        break;
      }

      // --- Bit -------------------------------------------------------------
      case Mnemonic.SBIT:
        this.ram.writeBit(registers.x, registers.y, value, true);
        break;
      case Mnemonic.RBIT:
        this.ram.writeBit(registers.x, registers.y, value, false);
        break;

      // --- RAM X addressing -------------------------------------------------
      case Mnemonic.LDX:
        registers.x = value;
        break;
      case Mnemonic.COMX:
        // The MSB only. On the TMS1000 this complements all of X; getting it
        // wrong here moves a display sweep four RAM files sideways.
        registers.x = registers.x ^ X_MSB;
        break;

      // --- Input ------------------------------------------------------------
      case Mnemonic.TKA:
        registers.a = this.readK();
        break;
      case Mnemonic.KNEZ:
        registers.status = this.readK() !== 0 ? 1 : 0;
        break;

      // --- Output -----------------------------------------------------------
      case Mnemonic.TDO:
        // `status_latch << 4 | A`, composed by the register file. There is no
        // CLO on this core: clearing O is TDO with A = 0 and the latch clear.
        this.writeO(registers.oIndex);
        break;
      case Mnemonic.SETR:
        this.setR(this.rOutputIndex(), true);
        break;
      case Mnemonic.RSTR:
        this.setR(this.rOutputIndex(), false);
        break;

      // --- ROM addressing ---------------------------------------------------
      case Mnemonic.LDP:
        // Also destroys the return page when executed inside a subroutine: PB
        // is the same four bits of silicon (research doc §4).
        registers.pb = value;
        break;
      case Mnemonic.COMC:
        registers.cb = registers.cb ^ 1;
        break;
      case Mnemonic.BR:
        if (branchCondition === 1) {
          if (!registers.inSubroutine) {
            // Inside a subroutine PA is *not* reloaded, so a branch cannot
            // change page - but the chapter still can, which is what gives a
            // subroutine 128 words across two chapters (research doc §2).
            registers.pa = registers.pb;
          }
          registers.ca = registers.cb;
          registers.pc = value;
        }
        break;
      case Mnemonic.CALL:
        if (branchCondition === 1) {
          // Returns false when already inside a subroutine, and saves nothing.
          // One level of return, and nesting loses the outer address silently
          // rather than overflowing a stack that does not exist.
          registers.saveReturnState(registers.pc);
          registers.ca = registers.cb;
          const callerPage = registers.pa;
          registers.pa = registers.pb;
          registers.pb = callerPage;
          registers.pc = value;
        }
        break;
      case Mnemonic.RETN:
        // Restores PC and CA only when inside a subroutine; `PA = PB` happens
        // either way, which is how the swap CALL performed gets undone.
        registers.restoreReturnState();
        registers.pa = registers.pb;
        break;
    }
  }
}
