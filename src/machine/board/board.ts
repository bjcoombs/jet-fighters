// The board: the CPU, the tube, the speaker, the case controls and the power
// switch, wired to each other exactly as the traces do it.
//
// Sources: the sibling device MAME emulates (Gakken Heiankyo Alien, HD38800 at
// 400 kHz) wires 10 grids on D0-D9, ~20 plates on the R ports plus D10-D13, a
// 1-bit speaker on D14, and an input matrix strobed on D0-D6 and read back on
// D15 - docs/prd/jet-fighters-v2.md (Technical Context, R4). Jet Fighter's own
// ROM was never dumped, so this topology is the sibling's, adopted deliberately.
//
// Note what D0-D6 doing double duty means: the grid strobe *is* the input
// strobe. The ROM does not scan the keyboard separately; it lights a grid and
// reads D15, and whichever contact sits on that line answers. Sweeping the tube
// and sampling the controls are the same act.
//
// The board owns no clock. `step()` advances the CPU by a cycle budget the
// caller chooses, port transitions arrive as callbacks during that execution,
// and frame boundaries fall out of the sweep. There is no timer, no requestAnimationFrame
// and no wall-clock anywhere below this line - the same property the headless
// probe and the spectral tests depend on.
//
// Pure state only: no DOM, no browser globals, no Web Audio. This module runs in
// plain Node.

import { HMCS44CPU, type CPUState } from '../cpu/cpu.js';
import { D_GRID_LAST, D_INPUT, D_SPEAKER } from '../cpu/ports.js';
import { Display, type DisplaySnapshot, type PwmFrame, type SegmentDuty } from './display.js';
import { InputMatrix, type ControlState, type LeverPosition, type SkillLevel } from './input.js';
import { PowerSwitch, type PowerState } from './power.js';
import { Speaker, type SpeakerEdge } from './speaker.js';

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
  /** False once the core has halted - power off, or a STOP instruction. */
  readonly running: boolean;
  /** The tube: driven lines, completed frames, and the last frame's duty. */
  readonly display: DisplaySnapshot;
  /** Position of the case controls. */
  readonly controls: ControlState;
  /** Current level of the D14 speaker pin. */
  readonly speakerLevel: 0 | 1;
  /** Speaker edges buffered and not yet consumed. */
  readonly speakerEdges: number;
}

/**
 * The Jet Fighters board.
 *
 * The programmatic surface is deliberately wide enough for the machine probe
 * (contract V3-V5) to drive and observe the machine with nothing else attached:
 *
 * - `step()` advances emulated time; `getLitSegments()` reads what the tube
 *   showed over the last completed frame, each segment with a real duty.
 * - `setControl()` moves a case control, and the ROM finds out about it through
 *   the strobe matrix on its next sweep - there is no path from here into game
 *   state, because there is no game state outside the machine's RAM.
 * - `takeSpeakerEdges()` drains the D14 transition stream with exact cycle
 *   timestamps, which is the only thing the audio layer is ever given.
 *
 * Edge timestamps are the cycle count at which the *writing instruction began*.
 * The CPU adds an instruction's cost after executing it, so the count a port
 * callback observes is the value at the instruction boundary. Instructions cost
 * one or two cycles, so a timestamp is exact to within the instruction that
 * produced it - the finest resolution this core's execution model exposes.
 */
export class Board {
  readonly cpu: HMCS44CPU;
  readonly display = new Display();
  readonly speaker = new Speaker();
  readonly input = new InputMatrix();
  readonly power: PowerSwitch;

  /**
   * @param romImage the assembled program - a full ROM image or the 2048-word
   *   program region alone, as `HMCS44CPU` accepts.
   */
  constructor(romImage: ArrayLike<number>, options: BoardOptions = {}) {
    this.cpu = new HMCS44CPU(romImage);
    this.cpu.ports.onDChange = (pin, value) => this.handleDChange(pin, value);
    this.cpu.ports.onRChange = (pin, value) => this.handleRChange(pin, value);

    this.power = new PowerSwitch(
      {
        cpu: this.cpu,
        display: this.display,
        speaker: this.speaker,
        onPowerChange: () => this.driveInputLine(),
      },
      options.power ?? 'on',
    );
  }

  /** Machine cycles executed since the last power-on. */
  get cycles(): number {
    return this.cpu.cycles;
  }

  /** Seconds of emulated time since the last power-on. */
  get elapsedTime(): number {
    return this.cpu.getElapsedTime();
  }

  /** True while the core is executing. */
  get running(): boolean {
    return this.cpu.running;
  }

  /**
   * Run the machine for at least `cycles` machine cycles.
   *
   * Instructions are indivisible, so this overshoots by at most one
   * instruction's cost. Returns 0 immediately when the machine is off or halted,
   * so a caller draining a budget terminates rather than spinning.
   *
   * @returns cycles actually executed.
   */
  step(cycles: number): number {
    return this.cpu.run(cycles);
  }

  /** Execute exactly one instruction. Returns the cycles it cost. */
  stepInstruction(): number {
    return this.cpu.step();
  }

  /**
   * Run until the tube has completed `frames` further sweeps, or until `budget`
   * cycles have been spent without them arriving.
   *
   * The sweep is the ROM's own timebase, so this is how a caller says "one
   * display frame" without inventing a frame rate. The budget exists because a
   * halted or misbehaving ROM may never complete another sweep.
   *
   * @returns cycles executed.
   */
  runFrames(frames: number, budget = frames * 100_000): number {
    const target = this.display.frameCount + frames;
    let executed = 0;
    while (this.display.frameCount < target && executed < budget) {
      const cost = this.cpu.step();
      if (cost === 0) {
        break;
      }
      executed += cost;
    }
    return executed;
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

  /** Distinct grids the ROM has driven since power-on, ascending (V3). */
  getStrobedGrids(): number[] {
    return this.display.getStrobedGrids();
  }

  /**
   * Move a case control, as a player's hand does.
   *
   * The new position reaches the ROM only through the strobe matrix, on the next
   * sweep - nothing here writes machine state.
   *
   * @param name `fire`, `lever` or `skill`.
   * @param value see `InputMatrix.setControl`.
   */
  setControl(name: string, value?: string): void {
    this.input.setControl(name, value);
    this.driveInputLine();
  }

  /** Press or release the fire button. */
  setFire(pressed: boolean): void {
    this.input.setFire(pressed);
    this.driveInputLine();
  }

  /** Move the three-position lever to a lane. */
  setLever(position: LeverPosition): void {
    this.input.setLever(position);
    this.driveInputLine();
  }

  /** Turn the skill dial. */
  setSkill(level: SkillLevel): void {
    this.input.setSkill(level);
    this.driveInputLine();
  }

  /** Drain the buffered D14 transitions, handing them to the audio layer. */
  takeSpeakerEdges(): SpeakerEdge[] {
    return this.speaker.takeEdges();
  }

  /** Throw the power switch on: core reset, RAM cleared, tube blank. */
  powerOn(): void {
    this.power.on();
  }

  /** Throw it off: core halted, RAM invalidated, tube dark. */
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
      elapsedTime: this.cpu.getElapsedTime(),
      power: this.power.state,
      running: this.cpu.running,
      display: this.display.snapshot(),
      controls: this.input.getState(),
      speakerLevel: this.speaker.level,
      speakerEdges: this.speaker.edgeCount,
    };
  }

  /** Full CPU state, for the probe and debug tooling. */
  getCPUState(): CPUState {
    return this.cpu.getState();
  }

  /**
   * One D pin changed observable state, from any cause.
   *
   * D0-D9 are grids, and D0-D6 are simultaneously the input strobe, so a grid
   * transition re-drives the read line. D14 is the speaker. D10-D13 are the
   * sibling's remaining plate lines, unassigned in this model (see
   * `PLATE_COUNT` in display.ts). D15 is the read line the board itself drives,
   * so it is ignored here - handling it would recurse.
   */
  private handleDChange(pin: number, value: number): void {
    const cycle = this.cpu.cycles;

    if (pin <= D_GRID_LAST) {
      this.display.setGridPin(pin, value, cycle);
      this.driveInputLine();
      return;
    }

    if (pin === D_SPEAKER) {
      this.speaker.recordEdge(cycle, value);
    }
  }

  /** One R pin changed: a plate line rose or fell. */
  private handleRChange(pin: number, value: number): void {
    this.display.setPlatePin(pin, value, this.cpu.cycles);
  }

  /**
   * Put the input matrix's answer on D15.
   *
   * The read line carries whatever the currently strobed contacts say, so it is
   * re-driven whenever the strobe moves or a control does. The ROM releases D15
   * (writes 1) and reads it back, and the level it finds is this one.
   */
  private driveInputLine(): void {
    this.cpu.ports.setExternalD(D_INPUT, this.input.read(this.cpu.ports.readGrids()));
  }
}
