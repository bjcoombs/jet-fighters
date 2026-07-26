// HMCS44 (Hitachi HD38800) R and D port model.
//
// Sources: the HD38800's high-voltage open-drain R/D ports drive the VFD
// directly, and the sibling device MAME emulates (Gakken Heiankyo Alien,
// HD38800 at 400 kHz) wires them as 10 grids on D0-D9, ~20 plates on the R
// ports plus D10-D13, a 1-bit speaker on D14, and the input matrix strobed on
// D0-D6 and read back on D15. See docs/prd/jet-fighters-v2.md (Technical
// Context, R1, R4). Jet Fighter's own ROM was never dumped, so this pin map is
// the sibling's, adopted deliberately rather than measured from the unit.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the machine advances by cycles driven from cpu.ts.

/** D-port pins: D0-D15. */
export const D_PIN_COUNT = 16;

/** All 16 D pins. */
export const D_MASK = 0xffff;

/** Lowest VFD grid pin. */
export const D_GRID_FIRST = 0;

/** Highest VFD grid pin - ten grids, D0-D9. */
export const D_GRID_LAST = 9;

/** D0-D9, the display sweep the board watches for grid strobes (V3). */
export const D_GRID_MASK = 0x03ff;

/** D10-D13, general purpose - wired to plates on the sibling hardware. */
export const D_GENERAL_MASK = 0x3c00;

/** D14 drives the 1-bit speaker; its edges are the entire sound system (R6). */
export const D_SPEAKER = 14;

/** D15 reads the input matrix strobed out on D0-D6 (R4). */
export const D_INPUT = 15;

/**
 * R-port pins, modelled as five 4-bit ports R0-R4.
 *
 * The research fixes the plate count at "~20 plates (R ports + D10-D13)"; the
 * exact number of R ports the HD38800A variant in this unit bonds out is not
 * confirmed without a teardown, so 20 is this model's stated assumption rather
 * than a measured fact.
 */
export const R_PIN_COUNT = 20;

/** All 20 R pins. */
export const R_MASK = 0xfffff;

/** Bits per R port - the width of a single RAM nibble transfer. */
export const R_PORT_WIDTH = 4;

/** R0-R4. */
export const R_PORT_COUNT = R_PIN_COUNT / R_PORT_WIDTH;

/**
 * Level an undriven pin floats to.
 *
 * These are open-drain pins: the on-chip transistor can only pull a pin down.
 * With nothing pulling it, a pin sits at the level its external circuit
 * establishes, which this model treats as 1 unless the board says otherwise via
 * `setExternalD` / `setExternalR`. Consequence, and the idiom the input matrix
 * relies on: writing 1 to a pin releases it so a read returns the external
 * state, while writing 0 pulls it down regardless of what is out there.
 */
export const PIN_FLOAT_LEVEL = 1;

/** Immutable snapshot of port state, for tests and debug UIs. */
export interface PortSnapshot {
  /** 16-bit D output latch. */
  readonly dOutput: number;
  /** 16-bit D direction register: 1 = output. */
  readonly dDirection: number;
  /** 16-bit external level driven onto the D pins by the board. */
  readonly dExternal: number;
  /** Observable state of the 16 D pins after open-drain resolution. */
  readonly dPins: number;
  /** 20-bit R output latch. */
  readonly rOutput: number;
  /** 20-bit R direction register: 1 = output. */
  readonly rDirection: number;
  /** 20-bit external level driven onto the R pins by the board. */
  readonly rExternal: number;
  /** Observable state of the 20 R pins after open-drain resolution. */
  readonly rPins: number;
}

/**
 * The HMCS44 R/D port file.
 *
 * Pin state is *resolved*, not stored: `readD(pin)` computes what an observer
 * on the board would see from the output latch, the direction bit, and whatever
 * the board is driving externally. Three cases, and only three:
 *
 * | direction | latch | observable pin           |
 * |-----------|-------|--------------------------|
 * | output    | 0     | 0 - actively pulled down |
 * | output    | 1     | external (floats)        |
 * | input     | -     | external (floats)        |
 *
 * That middle row is the open-drain part, and it is why a direction register is
 * a modelling convenience here rather than a hardware register: the real HMCS40
 * D pins are bidirectional with no separate direction latch, and a program
 * reads an input by writing 1 to the pin (releasing it) and then reading it
 * back. Both idioms work against this model and produce the same pin states, so
 * the ROM can use whichever the assembler expresses more clearly. Nothing here
 * models voltages - the resolved pin state is the whole observable contract.
 *
 * Reset leaves every pin an output holding 0: all grids and plates dark, the
 * speaker at rest. That matches a device coming out of power-on with its port
 * latches cleared, and it means nothing lights up until the ROM drives it.
 */
export class Ports {
  private _dOutput = 0;
  private _dDirection = D_MASK;
  private _dExternal = D_MASK;
  private _rOutput = 0;
  private _rDirection = R_MASK;
  private _rExternal = R_MASK;

  /**
   * Called on every observable D pin transition, whatever caused it - a write,
   * a direction change, or the board changing the external level. The board
   * uses it to timestamp grid strobes and D14 speaker edges by cycle.
   */
  onDChange?: (pin: number, value: number) => void;

  /** R-port equivalent of `onDChange` - plate transitions. */
  onRChange?: (pin: number, value: number) => void;

  constructor() {
    this.reset();
  }

  /** 16-bit D output latch. */
  get dOutput(): number {
    return this._dOutput;
  }

  /** 16-bit D direction register: 1 = output, 0 = input. */
  get dDirection(): number {
    return this._dDirection;
  }

  /** 16-bit external level the board drives onto the D pins. */
  get dExternal(): number {
    return this._dExternal;
  }

  /** 20-bit R output latch. */
  get rOutput(): number {
    return this._rOutput;
  }

  /** 20-bit R direction register: 1 = output, 0 = input. */
  get rDirection(): number {
    return this._rDirection;
  }

  /** 20-bit external level the board drives onto the R pins. */
  get rExternal(): number {
    return this._rExternal;
  }

  /**
   * Power-on state: latches cleared, every pin an output, external levels at
   * the floating level. Nothing is lit and the speaker sits low.
   */
  reset(): void {
    this._dOutput = 0;
    this._dDirection = D_MASK;
    this._dExternal = D_MASK;
    this._rOutput = 0;
    this._rDirection = R_MASK;
    this._rExternal = R_MASK;
  }

  // --- D ports -------------------------------------------------------------

  /** Observable state of one D pin, 0 or 1. */
  readD(pin: number): number {
    assertPin(pin, D_PIN_COUNT, 'D');
    return (this.readDPort() >>> pin) & 1;
  }

  /** Set one D pin's output latch. Any non-zero value writes a 1. */
  writeD(pin: number, value: number): void {
    assertPin(pin, D_PIN_COUNT, 'D');
    this.updateD(setBit(this._dOutput, pin, value), this._dDirection, this._dExternal);
  }

  /** Make one D pin an output (`true`) or an input (`false`). */
  setDDirection(pin: number, output: boolean): void {
    assertPin(pin, D_PIN_COUNT, 'D');
    this.updateD(this._dOutput, setBit(this._dDirection, pin, output ? 1 : 0), this._dExternal);
  }

  /** Drive one D pin's external level - the board's side of the wire. */
  setExternalD(pin: number, value: number): void {
    assertPin(pin, D_PIN_COUNT, 'D');
    this.updateD(this._dOutput, this._dDirection, setBit(this._dExternal, pin, value));
  }

  /** Observable state of all 16 D pins after open-drain resolution. */
  readDPort(): number {
    return resolve(this._dOutput, this._dDirection, this._dExternal, D_MASK);
  }

  /** Write the D output latch through a bit mask, leaving other pins alone. */
  writeDPort(mask: number, value: number): void {
    const selected = mask & D_MASK;
    this.updateD(
      (this._dOutput & ~selected & D_MASK) | (value & selected),
      this._dDirection,
      this._dExternal,
    );
  }

  /** Set the direction of several D pins at once; 1 bits become outputs. */
  setDDirectionPort(mask: number, value: number): void {
    const selected = mask & D_MASK;
    this.updateD(
      this._dOutput,
      (this._dDirection & ~selected & D_MASK) | (value & selected),
      this._dExternal,
    );
  }

  /** Drive several D pins' external levels at once. */
  setExternalDPort(mask: number, value: number): void {
    const selected = mask & D_MASK;
    this.updateD(
      this._dOutput,
      this._dDirection,
      (this._dExternal & ~selected & D_MASK) | (value & selected),
    );
  }

  /** True when nothing on-chip is pulling this D pin down. */
  isDFloating(pin: number): boolean {
    assertPin(pin, D_PIN_COUNT, 'D');
    const driving = (this._dDirection >>> pin) & 1 & ~(this._dOutput >>> pin);
    return driving === 0;
  }

  /** Which of D0-D9 are currently strobed, as a 10-bit mask (V3). */
  readGrids(): number {
    return this.readDPort() & D_GRID_MASK;
  }

  /** Observable level of the D14 speaker pin (V5). */
  readSpeaker(): number {
    return this.readD(D_SPEAKER);
  }

  // --- R ports -------------------------------------------------------------

  /** Observable state of one R pin, 0 or 1. */
  readR(pin: number): number {
    assertPin(pin, R_PIN_COUNT, 'R');
    return (this.readRPort() >>> pin) & 1;
  }

  /** Set one R pin's output latch. Any non-zero value writes a 1. */
  writeR(pin: number, value: number): void {
    assertPin(pin, R_PIN_COUNT, 'R');
    this.updateR(setBit(this._rOutput, pin, value), this._rDirection, this._rExternal);
  }

  /** Make one R pin an output (`true`) or an input (`false`). */
  setRDirection(pin: number, output: boolean): void {
    assertPin(pin, R_PIN_COUNT, 'R');
    this.updateR(this._rOutput, setBit(this._rDirection, pin, output ? 1 : 0), this._rExternal);
  }

  /** Drive one R pin's external level - the board's side of the wire. */
  setExternalR(pin: number, value: number): void {
    assertPin(pin, R_PIN_COUNT, 'R');
    this.updateR(this._rOutput, this._rDirection, setBit(this._rExternal, pin, value));
  }

  /** Observable state of all 20 R pins after open-drain resolution. */
  readRPort(): number {
    return resolve(this._rOutput, this._rDirection, this._rExternal, R_MASK);
  }

  /** Write the R output latch through a bit mask, leaving other pins alone. */
  writeRPort(mask: number, value: number): void {
    const selected = mask & R_MASK;
    this.updateR(
      (this._rOutput & ~selected & R_MASK) | (value & selected),
      this._rDirection,
      this._rExternal,
    );
  }

  /** Set the direction of several R pins at once; 1 bits become outputs. */
  setRDirectionPort(mask: number, value: number): void {
    const selected = mask & R_MASK;
    this.updateR(
      this._rOutput,
      (this._rDirection & ~selected & R_MASK) | (value & selected),
      this._rExternal,
    );
  }

  /** Drive several R pins' external levels at once. */
  setExternalRPort(mask: number, value: number): void {
    const selected = mask & R_MASK;
    this.updateR(
      this._rOutput,
      this._rDirection,
      (this._rExternal & ~selected & R_MASK) | (value & selected),
    );
  }

  /** True when nothing on-chip is pulling this R pin down. */
  isRFloating(pin: number): boolean {
    assertPin(pin, R_PIN_COUNT, 'R');
    const driving = (this._rDirection >>> pin) & 1 & ~(this._rOutput >>> pin);
    return driving === 0;
  }

  /** Read one 4-bit R port, R0-R4 - the width the CPU transfers in one go. */
  readRNibble(port: number): number {
    assertPin(port, R_PORT_COUNT, 'R port');
    return (this.readRPort() >>> (port * R_PORT_WIDTH)) & 0x0f;
  }

  /** Write one 4-bit R port, R0-R4. */
  writeRNibble(port: number, value: number): void {
    assertPin(port, R_PORT_COUNT, 'R port');
    const shift = port * R_PORT_WIDTH;
    this.writeRPort(0x0f << shift, (value & 0x0f) << shift);
  }

  /** Immutable snapshot for tests, `CPUState`, and future debug tooling. */
  snapshot(): PortSnapshot {
    return {
      dOutput: this._dOutput,
      dDirection: this._dDirection,
      dExternal: this._dExternal,
      dPins: this.readDPort(),
      rOutput: this._rOutput,
      rDirection: this._rDirection,
      rExternal: this._rExternal,
      rPins: this.readRPort(),
    };
  }

  /**
   * Apply new D registers and report any pin whose observable state moved.
   *
   * Every D mutation funnels through here so `onDChange` fires on transitions
   * only, regardless of which register changed - the board must not have to
   * distinguish "the ROM wrote the pin" from "the ROM released the pin and the
   * external level showed through".
   */
  private updateD(output: number, direction: number, external: number): void {
    const before = this.readDPort();
    this._dOutput = output & D_MASK;
    this._dDirection = direction & D_MASK;
    this._dExternal = external & D_MASK;
    const after = this.readDPort();
    notify(before, after, D_PIN_COUNT, this.onDChange);
  }

  /** R-port counterpart of `updateD`. */
  private updateR(output: number, direction: number, external: number): void {
    const before = this.readRPort();
    this._rOutput = output & R_MASK;
    this._rDirection = direction & R_MASK;
    this._rExternal = external & R_MASK;
    const after = this.readRPort();
    notify(before, after, R_PIN_COUNT, this.onRChange);
  }
}

/**
 * Resolve observable pin state from the three registers.
 *
 * A pin reads 0 only where it is an output holding 0 - the one case where the
 * chip is pulling it down. Everywhere else it floats and reads the external
 * level.
 */
function resolve(output: number, direction: number, external: number, mask: number): number {
  const pulledLow = direction & ~output & mask;
  return external & ~pulledLow & mask;
}

/** Set or clear bit `index` of `word`; any non-zero `value` sets it. */
function setBit(word: number, index: number, value: number): number {
  const bit = 1 << index;
  return value ? word | bit : word & ~bit;
}

/** Emit one callback per pin whose state differs between `before` and `after`. */
function notify(
  before: number,
  after: number,
  pinCount: number,
  callback?: (pin: number, value: number) => void,
): void {
  if (!callback) {
    return;
  }
  let changed = before ^ after;
  for (let pin = 0; changed !== 0 && pin < pinCount; pin += 1) {
    if ((changed >>> pin) & 1) {
      callback(pin, (after >>> pin) & 1);
      changed &= ~(1 << pin);
    }
  }
}

function assertPin(pin: number, count: number, label: string): void {
  if (!Number.isInteger(pin) || pin < 0 || pin >= count) {
    throw new RangeError(`${label} pin out of range: ${pin} (expected 0..${count - 1})`);
  }
}
