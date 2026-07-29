// The board: the CPU, the tube, the speaker, the case controls and the power
// switch, wired to each other exactly as the traces do it.
//
// Sources: MAME's `ginv` driver for our own ROM mask (Gakken Invader, TMS1370
// mask MP2110) and TI's *TMS 1000 Series Data Manual*, quoted at length in
// docs/research/tms1370-io.md sections 1 and 2. Every allocation below is read
// off the driver for our exact mask rather than borrowed from a sibling
// machine, which is what the v2 board had to do:
//
//   | Pins       | Count | Role                                    |
//   | ---------- | ----- | --------------------------------------- |
//   | R0-R8      | 9     | VFD grids - the display scan            |
//   | R9, R10    | 2     | Input strobe columns                    |
//   | R11-R14    | 4     | VFD plates, the high 4 of 12            |
//   | R15        | 1     | Speaker, 1 bit                          |
//   | O0-O7      | 8     | VFD plates, the low 8 of 12             |
//   | K1, K2, K4 | 3     | Strobed control returns                 |
//   | K8         | 1     | Fire button, read directly, not strobed |
//
// Note what that costs and what it buys. There is no D port on this chip: grids,
// strobe columns and the speaker are all bits of one 16-bit R latch, so this
// module is the only layer in the tree that knows which bit is which. In
// exchange the inputs get four pins of their own, so the display sweep and the
// control scan are separate acts here - on the v2 machine the grid strobe *was*
// the input strobe and they could not be told apart.
//
// The board owns no clock. `step()` advances the core by a cycle budget the
// caller chooses, pin transitions arrive as callbacks during that execution, and
// frame boundaries fall out of the sweep. There is no timer, no
// requestAnimationFrame and no wall-clock anywhere below this line - the same
// property the headless probe and the spectral tests depend on.
//
// Pure state only: no DOM, no browser globals, no Web Audio. This module runs in
// plain Node.

import { Tms1370Cpu, type Tms1370CpuSnapshot } from '../cpu/tms1370/cpu.js';
import { Tms1370Rom } from '../cpu/tms1370/memory.js';
import { Tms1370OutputPla } from '../cpu/tms1370/opla.js';
import {
  K_STROBED_MASK,
  O_MASK,
  R_GRID_LAST,
  R_PLATE_FIRST,
  R_PLATE_LAST,
  R_PLATE_MASK,
  R_PLATE_SHIFT,
  R_SPEAKER,
  R_STROBE_FIRST,
  R_STROBE_LAST,
  R_STROBE_MASK,
  STROBE_COLUMN_COUNT,
  PLATE_MASK,
} from '../cpu/tms1370/ports.js';
import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { Display, type DisplaySnapshot, type PwmFrame, type SegmentDuty } from './display.js';
import type { ControlState, LeverPosition, SkillLevel } from './input.js';
import { PowerSwitch, type PowerState } from './power.js';
import { Speaker, type SpeakerEdge } from './speaker.js';
import { KInputMatrix } from './tms1370-input.js';

/** The machine image a board runs: the program ROM and the mask's output PLA. */
export interface MachineImage {
  /** 2048 eight-bit program words, as `Tms1370Rom` wants them. */
  readonly rom: ArrayLike<number>;
  /**
   * The 32-slot O output PLA.
   *
   * Mask-programmed data rather than executed words, which is why it arrives
   * beside the ROM rather than inside it: the core's O state is a 5-bit index
   * and the plate pattern is this table's to produce.
   */
  readonly opla: ArrayLike<number>;
}

/** Construction options. */
export interface BoardOptions {
  /**
   * Position the power switch starts in. Defaults to `on`: a board is built in
   * order to be run, and the caller that wants a dark machine to switch on
   * itself can say so.
   */
  readonly power?: PowerState;
}

/** Everything an outside observer can see of the machine at an instant. */
export interface BoardState {
  /** Machine cycles executed since the last power-on. */
  readonly cycles: number;
  /** Seconds of emulated time since the last power-on. */
  readonly elapsedTime: number;
  /** Position of the power switch. */
  readonly power: PowerState;
  /** False once the machine has stopped - which, on this core, is power off. */
  readonly running: boolean;
  /** The tube: driven lines, completed frames, and the last frame's duty. */
  readonly display: DisplaySnapshot;
  /** Position of the case controls. */
  readonly controls: ControlState;
  /** Current level of the R15 speaker pin. */
  readonly speakerLevel: 0 | 1;
  /** Speaker edges buffered and not yet consumed. */
  readonly speakerEdges: number;
}

/**
 * The Jet Fighters board.
 *
 * The programmatic surface is deliberately wide enough for the machine probe
 * (contract V5, V7 and V8) to drive and observe the machine with nothing else
 * attached:
 *
 * - `step()` advances emulated time; `getLitSegments()` reads what the tube
 *   showed over the last completed sweep, each segment with a real duty.
 * - `setControl()` moves a case control, and the ROM finds out about it on its
 *   next K sample - there is no path from here into game state, because there is
 *   no game state outside the machine's RAM.
 * - `takeSpeakerEdges()` drains the R15 transition stream with exact cycle
 *   timestamps, which is the only thing the audio layer is ever given.
 *
 * Edge timestamps are the cycle count at which the *writing instruction began*.
 * The core adds an instruction's cost after executing it, so the count a pin
 * callback observes is the value at the instruction boundary. Every instruction
 * on this core costs exactly one cycle, so a timestamp is exact to the
 * instruction that produced it - one cycle, where the v2 core's two-cycle
 * instructions left it exact only to within the instruction.
 */
export class Board {
  readonly cpu: Tms1370Cpu;
  readonly display = new Display();
  readonly speaker = new Speaker();
  readonly input = new KInputMatrix();
  readonly power: PowerSwitch;

  /**
   * The mask's output PLA, held here as well as on the core.
   *
   * The core's constructor resets, and reset writes the O register, so a pin
   * callback fires before `this.cpu` has been assigned. Reading the table
   * through this field rather than through the core is what makes that window
   * survivable rather than a crash waiting for the first machine that resets
   * into a lit slot.
   */
  private readonly outputPla: Tms1370OutputPla;

  /** True while the core's own constructor is still running. See {@link now}. */
  private booting = true;

  /** The 16 R latches as this board last saw them, R0 in bit 0. */
  private r = 0;
  /** The 8 O lines the output PLA last resolved. */
  private o = 0;
  /** Cycles at which more than one of R9/R10 was high. The ROM must not. */
  private readonly _superimposedStrobes: number[] = [];

  /** @param image the assembled machine: the program ROM and the output PLA. */
  constructor(image: MachineImage, options: BoardOptions = {}) {
    this.outputPla = new Tms1370OutputPla(image.opla);
    this.cpu = new Tms1370Cpu({
      rom: new Tms1370Rom(image.rom),
      outputPla: this.outputPla,
      pins: {
        readK: () => this.readK(),
        writeOIndex: (index) => this.handleOIndex(index),
        writeR: (index, on) => this.handleRChange(index, on),
      },
    });
    this.booting = false;

    this.power = new PowerSwitch(
      {
        cpu: this.cpu,
        display: this.display,
        speaker: this.speaker,
        onPowerChange: () => this.forgetPinState(),
      },
      options.power ?? 'on',
    );
  }

  /**
   * The cycle a pin transition happened on.
   *
   * Zero while the core's constructor is still running: it resets, reset moves
   * pins, and the pin callbacks are bound to a board whose `cpu` field has not
   * been assigned yet. Nothing has executed at that point, so zero is the true
   * answer rather than a placeholder.
   */
  private now(): number {
    return this.booting ? 0 : this.cpu.cycles;
  }

  /** Machine cycles executed since the last power-on. */
  get cycles(): number {
    return this.cpu.cycles;
  }

  /**
   * Seconds of emulated time since the last power-on.
   *
   * The instruction rate, not the oscillator's: `CYCLE_HZ` is the oscillator
   * frequency already divided by the architectural divide-by-six, and it carries
   * that figure's stated tolerance with it. See
   * src/machine/cpu/tms1370/timing.ts.
   */
  get elapsedTime(): number {
    return this.cpu.cycles / CYCLE_HZ;
  }

  /**
   * True while the machine is executing.
   *
   * On this core that is exactly "the power switch is on". The TMS1000 family
   * has no STOP instruction and no low-power halt, so there is no way for a
   * program to stop the machine and no state between running and unpowered.
   */
  get running(): boolean {
    return this.power.isOn;
  }

  /** Cycles at which more than one of R9/R10 was high, since power-on (V7). */
  get superimposedStrobes(): readonly number[] {
    return this._superimposedStrobes;
  }

  /**
   * Run the machine for at least `cycles` machine cycles.
   *
   * Instructions are indivisible, so this overshoots by at most one
   * instruction's cost. Returns 0 immediately when the machine is off, so a
   * caller draining a budget terminates rather than spinning.
   *
   * @returns cycles actually executed.
   */
  step(cycles: number): number {
    if (!this.running) {
      return 0;
    }
    const from = this.cpu.cycles;
    const until = from + Math.max(0, cycles);
    while (this.cpu.cycles < until) {
      this.cpu.step();
    }
    return this.cpu.cycles - from;
  }

  /** Execute exactly one instruction. Returns the cycles it cost. */
  stepInstruction(): number {
    if (!this.running) {
      return 0;
    }
    return this.cpu.step();
  }

  /**
   * Run until the tube has completed `frames` further sweeps, or until `budget`
   * cycles have been spent without them arriving.
   *
   * The sweep is the ROM's own timebase, so this is how a caller says "one
   * display frame" without inventing a frame rate. The budget exists because a
   * ROM that has stopped sweeping - which this one does for the whole of every
   * sound, and for good once the game ends - may never complete another.
   *
   * @returns cycles executed.
   */
  runFrames(frames: number, budget = frames * 100_000): number {
    const target = this.display.frameCount + frames;
    const from = this.cpu.cycles;
    while (this.display.frameCount < target && this.cpu.cycles - from < budget) {
      if (this.stepInstruction() === 0) {
        break;
      }
    }
    return this.cpu.cycles - from;
  }

  /** Per-segment duty over the most recently completed frame period. */
  getFrame(): PwmFrame {
    return this.display.getFrame();
  }

  /**
   * What is on the tube now, each segment with its duty - what a renderer draws.
   *
   * Two cases where the last completed frame period is not the answer, and both
   * are answered the same way: by looking at the tube rather than at the last
   * period it finished.
   *
   * Before the first sweep has wrapped there is no completed period at all, so a
   * caller that reads too early gets a live sample rather than an empty list
   * that looks like a dark machine.
   *
   * Once the sweep has *stopped* - which the ROM does on every sound, because it
   * bit-bangs the speaker in a delay loop and cannot strobe the grids at the
   * same time - no period closes either, and the last completed one goes on
   * reporting a fully lit tube for as long as the silence of the grids lasts.
   * `Display.getObservedFrame` reports that tube dark, because it is: nothing is
   * driving a grid. See docs/evidence/vfd-appearance.md D1.
   */
  getLitSegments(): readonly SegmentDuty[] {
    if (this.display.frameCount === 0) {
      return this.sampleFrame().segments;
    }
    return this.display.getObservedFrame(this.cpu.cycles).segments;
  }

  /** Duty accrued so far in the frame in progress, without closing it. */
  sampleFrame(): PwmFrame {
    return this.display.sample(this.cpu.cycles);
  }

  /**
   * Distinct display grids the ROM has driven since power-on, ascending (V5).
   *
   * Display grids only - R0-R8. The R9/R10 input columns and the R15 speaker are
   * bits of the same latch, and a board reporting "R lines driven" would return
   * them alongside the grids and turn a nine-grid sweep into a twelve-line one.
   */
  getStrobedGrids(): number[] {
    return this.display.getStrobedGrids();
  }

  /**
   * Move a case control, as a player's hand does.
   *
   * The new position reaches the ROM only through the K matrix, on its next
   * sample - nothing here writes machine state.
   *
   * @param name `fire`, `lever` or `skill`.
   * @param value see `KInputMatrix.setControl`.
   */
  setControl(name: string, value?: string): void {
    this.input.setControl(name, value);
  }

  /** Press or release the fire button. */
  setFire(pressed: boolean): void {
    this.input.setFire(pressed);
  }

  /** Move the three-position lever to a lane. */
  setLever(position: LeverPosition): void {
    this.input.setLever(position);
  }

  /** Turn the skill dial. */
  setSkill(level: SkillLevel): void {
    this.input.setSkill(level);
  }

  /** Drain the buffered R15 transitions, handing them to the audio layer. */
  takeSpeakerEdges(): SpeakerEdge[] {
    return this.speaker.takeEdges();
  }

  /** Throw the power switch on: core reset, RAM undefined, tube blank. */
  powerOn(): void {
    this.power.on();
  }

  /** Throw it off: the core stops, RAM dies, the tube goes dark. */
  powerOff(): void {
    this.power.off();
  }

  /** Off then on - the only restart the machine has. */
  powerCycle(): void {
    this.power.cycle();
  }

  /** Everything an outside observer can see, in one immutable object. */
  getState(): BoardState {
    return {
      cycles: this.cpu.cycles,
      elapsedTime: this.elapsedTime,
      power: this.power.state,
      running: this.running,
      display: this.display.snapshot(),
      controls: this.input.getState(),
      speakerLevel: this.speaker.level,
      speakerEdges: this.speaker.edgeCount,
    };
  }

  /** Full core state, for the probe and debug tooling. */
  getCPUState(): Tms1370CpuSnapshot {
    return this.cpu.snapshot();
  }

  /**
   * The twelve plate lines, resolved from the two ports that drive them.
   *
   * O0-O7 are plates 0-7 and R11-R14 are plates 8-11, which is MAME's
   * `(m_plate & 0xff) | (data >> 3 & 0xf00)` with the shift named. This is the
   * one place the split is applied: `Display` addresses plates 0-11 and takes no
   * position on which pin each came from (contract V4).
   */
  private plateMask(): number {
    return ((this.o & O_MASK) | ((this.r & R_PLATE_MASK) >>> R_PLATE_SHIFT)) & PLATE_MASK;
  }

  /**
   * Sample the four K pins: the wired-OR of every driven column, plus K8.
   *
   * K8 is ORed in unconditionally, which is the whole of what "unstrobed" means:
   * the fire button is live on every K read the ROM executes, whichever column
   * is up and even when neither is.
   */
  private readK(): number {
    let value = this.input.readUnstrobed();
    const mux = (this.r & R_STROBE_MASK) >>> R_STROBE_FIRST;
    for (let column = 0; column < STROBE_COLUMN_COUNT; column += 1) {
      if ((mux >>> column) & 1) {
        value |= this.input.readColumn(column) & K_STROBED_MASK;
      }
    }
    return value;
  }

  /**
   * The output PLA resolved a new index: the low eight plate lines moved.
   *
   * The core hands over the index rather than a mask, and the table decides what
   * the pins do - a board that could write an arbitrary byte here would have
   * modelled a chip that does not exist.
   */
  private handleOIndex(index: number): void {
    const next = this.outputPla.decode(index) & O_MASK;
    if (next === this.o) {
      return;
    }
    this.o = next;
    this.display.setPlates(this.plateMask(), this.now());
  }

  /**
   * One R latch changed: a grid, a strobe column, a plate or the speaker.
   *
   * All four live in the same 16-bit latch, so this is the only place in the
   * tree that knows which bit is which.
   */
  private handleRChange(index: number, on: boolean): void {
    const before = this.r;
    this.r = on ? this.r | (1 << index) : this.r & ~(1 << index);
    if (this.r === before) {
      return;
    }
    const cycle = this.now();

    if (index === R_SPEAKER) {
      this.speaker.recordEdge(cycle, on ? 1 : 0);
      return;
    }
    if (index >= R_STROBE_FIRST && index <= R_STROBE_LAST) {
      // The ROM must never drive both columns: `read_inputs` is a plain wired-OR
      // over the selected ones, so with both up the skill switch and the lever
      // arrive superimposed on the same three K lines and cannot be told apart.
      // The hardware does not object, so neither does this - the cycle is
      // recorded and contract V7 asserts the list stays empty.
      if (((this.r & R_STROBE_MASK) >>> R_STROBE_FIRST) === 0b11) {
        this._superimposedStrobes.push(cycle);
      }
      return;
    }
    if (index >= R_PLATE_FIRST && index <= R_PLATE_LAST) {
      this.display.setPlates(this.plateMask(), cycle);
      return;
    }
    if (index > R_GRID_LAST) {
      return;
    }
    this.display.setGridPin(index, on ? 1 : 0, cycle);
  }

  /** A reset cleared every latch, so the board's view of the pins goes with it. */
  private forgetPinState(): void {
    this.r = 0;
    this.o = 0;
    this._superimposedStrobes.length = 0;
  }
}
