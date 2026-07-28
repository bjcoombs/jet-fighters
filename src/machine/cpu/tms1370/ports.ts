// TMS1370 R, O and K port model - the pin budget of the real chip.
//
// Sources: MAME's `ginv` driver (Gakken Invader, TMS1370 mask MP2110 - the mask
// on our own board) and TI's *TMS 1000 Series Data Manual*, both quoted at
// length in docs/research/tms1370-io.md sections 1 and 2. Unlike the HMCS44 map
// in ../ports.ts, which was adopted from a sibling machine because our chip was
// misidentified, every allocation below is read off the driver for our exact
// ROM mask:
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
// 16 R + 8 O + 4 K, nothing spare. That the allocation is exactly full is itself
// evidence the reading is right: a wrong split would leave pins unexplained or
// overcommitted, and the board carries no second IC to take up any slack.
//
// This module defines the topology and the port file. It does not decide what
// the live board uses - ../../topology.ts owns that, and switching the default
// over is v3 task 11.3's work, not this module's.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - the machine advances by cycles driven from the core.

// --- R port -----------------------------------------------------------------

/** R-port pins: R0-R15. The TMS1300/1370's widened R port. */
export const R_PIN_COUNT = 16;

/** All 16 R pins. */
export const R_MASK = 0xffff;

/** Lowest VFD grid pin. */
export const R_GRID_FIRST = 0;

/** Highest VFD grid pin - nine grids, R0-R8. */
export const R_GRID_LAST = 8;

/** Display grids, driven by R0-R8. Nine, per MAME's `set_size(9, 12)`. */
export const GRID_COUNT = R_GRID_LAST - R_GRID_FIRST + 1;

/** R0-R8 as a bit mask - the display sweep. */
export const R_GRID_MASK = 0x01ff;

/** Lowest R pin carrying a plate line. */
export const R_PLATE_FIRST = 11;

/** Highest R pin carrying a plate line - four plates, R11-R14. */
export const R_PLATE_LAST = 14;

/** R11-R14 as a bit mask. */
export const R_PLATE_MASK = 0x7800;

/** Plates driven from the O port: the low 8. */
export const O_PLATE_COUNT = 8;

/** Plates driven from the R port: the high 4, R11-R14. */
export const R_PLATE_COUNT = R_PLATE_LAST - R_PLATE_FIRST + 1;

/**
 * Plate (anode) lines per grid: twelve, O0-O7 plus R11-R14.
 *
 * Twelve is the constant across both TMS1370 VFD machines in MAME's driver -
 * `ginv` scans 9 grids and `ginv1000` scans 10, and both drive 12 plates. That
 * is the shape of the design rather than a coincidence: plates are pinned by the
 * O port's width, and grids scale into whatever R pins are left over.
 */
export const PLATE_COUNT = O_PLATE_COUNT + R_PLATE_COUNT;

/** Plates 0-11 as a bit mask. */
export const PLATE_MASK = 0x0fff;

/**
 * Right shift taking R11-R14 down onto plates 8-11.
 *
 * MAME writes it as `m_plate = (m_plate & 0xff) | (data >> 3 & 0xf00)`; the 3 is
 * this difference, named rather than repeated.
 */
export const R_PLATE_SHIFT = R_PLATE_FIRST - O_PLATE_COUNT;

/** Lowest input strobe column. */
export const R_STROBE_FIRST = 9;

/** Highest input strobe column - two columns, R9 and R10. */
export const R_STROBE_LAST = 10;

/** R9 and R10 as a bit mask. */
export const R_STROBE_MASK = 0x0600;

/** Input strobe columns: two. */
export const STROBE_COLUMN_COUNT = R_STROBE_LAST - R_STROBE_FIRST + 1;

/** The speaker pin: R15, one of the same latches the grids come from. */
export const R_SPEAKER = 15;

/** R15 as a bit mask. */
export const R_SPEAKER_MASK = 0x8000;

// --- O port -----------------------------------------------------------------

/** O-port pins: O0-O7. */
export const O_PIN_COUNT = 8;

/** All 8 O pins. */
export const O_MASK = 0xff;

/**
 * Distinct patterns the O port can ever emit: 32.
 *
 * The O pins are not a latch the program writes. They are the output of a
 * five-bit-to-eight-bit PLA indexed by `status_latch:accumulator`, so a program
 * selects one of 32 patterns the mask defines and cannot express a
 * thirty-third (Data Manual section 2.6; MAME `op_tdo`). The table itself is a
 * design surface elsewhere in v3 - this constant is only the ceiling on it, and
 * it is why {@link Tms1370Ports.writeO} takes a resolved pattern rather than
 * offering a general 8-bit port write.
 */
export const O_PLA_INDEX_COUNT = 32;

// --- K port -----------------------------------------------------------------

/** K-input pins: K1, K2, K4, K8, read as one nibble. */
export const K_PIN_COUNT = 4;

/** All four K lines. */
export const K_MASK = 0x0f;

/** K1 - skill 1 under R9, lever up under R10. */
export const K1 = 0x1;

/** K2 - skill 2 under R9, lever centre under R10. */
export const K2 = 0x2;

/** K4 - skill 3 under R9, lever down under R10. */
export const K4 = 0x4;

/** K8 - the fire button, wired past the strobe columns entirely. */
export const K8 = 0x8;

/** The three K lines the strobe columns return on. */
export const K_STROBED_MASK = K1 | K2 | K4;

/** The one K line that is live on every read regardless of the strobe. */
export const K_UNSTROBED_MASK = K8;

/**
 * K reads a *strobed* contact can take to be seen, worst case.
 *
 * A contact on K1/K2/K4 is only visible while its own column is the one being
 * driven, so the ROM has to come round to that column before the closure
 * reaches it - two columns, so up to two reads.
 */
export const STROBED_CONTACT_LATENCY_READS = STROBE_COLUMN_COUNT;

/**
 * K reads the *fire* contact takes to be seen: one, always.
 *
 * `read_k()` ORs the K8 port in unconditionally, so the button is live on every
 * K sample whatever R9 and R10 are doing. This is the whole practical
 * consequence of K8 being unstrobed and it is why fire is the one control whose
 * latency does not depend on where the scan loop happens to be.
 *
 * There is no input latch and no edge detector anywhere on the input side
 * (`set_cki_bus`, sampled at subcycle 0), so a contact closed and released
 * between two K reads is never seen at all. Debounce, edge detection and
 * auto-repeat are the ROM's problem on this chip.
 */
export const UNSTROBED_CONTACT_LATENCY_READS = 1;

// --- state ------------------------------------------------------------------

/** Immutable snapshot of TMS1370 port state, for tests and debug UIs. */
export interface Tms1370PortSnapshot {
  /** 16-bit R latch. */
  readonly r: number;
  /** 8-bit O register, as resolved through the output PLA. */
  readonly o: number;
  /** Grids currently driven, as a bit mask over R0-R8. */
  readonly grids: number;
  /** Plates currently driven, as a 12-bit mask: O0-O7 low, R11-R14 high. */
  readonly plates: number;
  /** Input strobe columns driven, as a 2-bit mask: bit 0 = R9, bit 1 = R10. */
  readonly inputMux: number;
  /** Level of the R15 speaker pin. */
  readonly speaker: 0 | 1;
}

/**
 * What the case contacts return to the K pins.
 *
 * Implemented by the board, which knows the wiring; the port file only knows
 * that some columns are selected and that one line bypasses them.
 */
export interface KInputSource {
  /**
   * K lines closed on one strobe column: 0 for R9, 1 for R10.
   *
   * Only K1/K2/K4 may be returned - K8 is not on a column.
   */
  readColumn(column: number): number;

  /** K lines closed regardless of the strobe. K8, the fire button. */
  readUnstrobed(): number;
}

/**
 * The TMS1370 R/O/K port file.
 *
 * Three things about it differ from the HMCS44 model in ../ports.ts, and each of
 * them is load bearing:
 *
 * 1. **There is no D port.** Grids, both input strobe columns and the speaker
 *    are all bits of the same 16-bit R latch. A caller asking "which R lines are
 *    driven" and a caller asking "which grids are driven" are asking different
 *    questions, which is why {@link readGrids} exists rather than callers
 *    masking `r` themselves.
 * 2. **R lines are set and reset one at a time**, addressed by Y (plus the top
 *    bit of X on this family) - {@link setR} and {@link resetR}, TI's SETR and
 *    RSTR. There is no port-wide R write instruction on this chip. `writeR` is
 *    offered for tests and for reset only, and says so.
 * 3. **The O port is not writable as eight bits.** It is the output of a
 *    32-entry PLA, so {@link writeO} takes the pattern the PLA produced. A
 *    caller that can hand it an arbitrary byte has modelled a chip that does not
 *    exist; the constraint is enforced where the index is chosen, not here, but
 *    the naming keeps the shape visible.
 *
 * Nothing here is open drain. The HMCS44 model resolves pin state from an output
 * latch, a direction bit and an external level because that chip's D pins are
 * bidirectional and a program reads an input by releasing a pin. This family
 * reads its inputs on four dedicated K pins instead, so an R or O pin is simply
 * the latch: what the program wrote is what the tube sees.
 *
 * Reset clears every latch - all grids and plates dark, both strobe columns low,
 * the speaker at rest. MAME's reset writes O index 0 rather than clearing the O
 * pins directly, which is why the v3 O PLA reserves slot 0 for darkness.
 */
export class Tms1370Ports {
  private _r = 0;
  private _o = 0;

  /**
   * Called on every R pin transition, whatever caused it. The board uses it to
   * timestamp grid strobes and R15 speaker edges by cycle - the same
   * cycle-stamped edge model the HMCS44 board used on D14, on a different pin.
   */
  onRChange?: (pin: number, value: number) => void;

  /** Called when the O register changes, with the resolved 8-bit pattern. */
  onOChange?: (pattern: number) => void;

  constructor() {
    this.reset();
  }

  /** 16-bit R latch. */
  get r(): number {
    return this._r;
  }

  /** 8-bit O register, as resolved through the output PLA. */
  get o(): number {
    return this._o;
  }

  /** Power-on state: every latch cleared. Nothing lit, the speaker low. */
  reset(): void {
    this._r = 0;
    this._o = 0;
  }

  // --- R port ---------------------------------------------------------------

  /** Level of one R pin, 0 or 1. */
  readR(pin: number): 0 | 1 {
    assertPin(pin, R_PIN_COUNT, 'R');
    return ((this._r >>> pin) & 1) as 0 | 1;
  }

  /** SETR: drive one R line high. `index` is the 5-bit `X:Y` the core forms. */
  setR(index: number): void {
    assertPin(index, R_PIN_COUNT, 'R');
    this.updateR(this._r | (1 << index));
  }

  /** RSTR: drive one R line low. */
  resetR(index: number): void {
    assertPin(index, R_PIN_COUNT, 'R');
    this.updateR(this._r & ~(1 << index));
  }

  /**
   * Write the whole R latch.
   *
   * The chip has no such instruction - a program moves one line at a time with
   * SETR/RSTR. This exists so a test can put the port in a state in one step and
   * so reset can clear it; a core reaching for it is a core that has lost the
   * one-line-at-a-time constraint.
   */
  writeR(value: number): void {
    this.updateR(value & R_MASK);
  }

  /** Grids currently driven, as a bit mask over R0-R8. */
  readGrids(): number {
    return this._r & R_GRID_MASK;
  }

  /** Level of the R15 speaker pin. */
  readSpeaker(): 0 | 1 {
    return this.readR(R_SPEAKER);
  }

  // --- O port ---------------------------------------------------------------

  /**
   * Present the pattern the output PLA resolved for the current index.
   *
   * Named for what it is rather than as a port write: the value is a table
   * lookup's result, and only 32 of the 256 byte values are reachable on any
   * given mask.
   */
  writeO(pattern: number): void {
    const next = pattern & O_MASK;
    if (next === this._o) {
      return;
    }
    this._o = next;
    this.onOChange?.(next);
  }

  // --- the display matrix ---------------------------------------------------

  /**
   * Plates currently driven, as a 12-bit mask.
   *
   * O0-O7 are plates 0-7 and R11-R14 are plates 8-11, which is MAME's
   * `(m_plate & 0xff) | (data >> 3 & 0xf00)` with the shift named.
   */
  readPlates(): number {
    return ((this._o & O_MASK) | ((this._r & R_PLATE_MASK) >>> R_PLATE_SHIFT)) & PLATE_MASK;
  }

  // --- the input matrix -----------------------------------------------------

  /** Strobe columns driven, as a 2-bit mask: bit 0 = R9, bit 1 = R10. */
  readInputMux(): number {
    return (this._r & R_STROBE_MASK) >>> R_STROBE_FIRST;
  }

  /** How many strobe columns are driven right now. One, or the ROM has a bug. */
  strobeColumnsDriven(): number {
    const mux = this.readInputMux();
    let count = 0;
    for (let column = 0; column < STROBE_COLUMN_COUNT; column += 1) {
      count += (mux >>> column) & 1;
    }
    return count;
  }

  /**
   * True when both R9 and R10 are high, which the ROM must never allow.
   *
   * `read_inputs` is a plain wired-OR over the selected columns
   * (`hh_tms1k.cpp`), so with both up the program gets the skill switch and the
   * lever superimposed on the same three K lines and cannot tell them apart. The
   * hardware does not object - it returns the OR and carries on - so this is an
   * observation surface for a test rather than a guard that throws. A model that
   * threw here would be asserting the chip does something it does not.
   */
  hasSuperimposedStrobe(): boolean {
    return this.strobeColumnsDriven() > 1;
  }

  /**
   * Sample the four K pins: the wired-OR of every driven column, plus K8.
   *
   * K8 is ORed in unconditionally, which is the whole of what "unstrobed" means
   * here - see {@link UNSTROBED_CONTACT_LATENCY_READS}.
   */
  readK(source: KInputSource): number {
    let value = source.readUnstrobed() & K_UNSTROBED_MASK;
    const mux = this.readInputMux();
    for (let column = 0; column < STROBE_COLUMN_COUNT; column += 1) {
      if ((mux >>> column) & 1) {
        value |= source.readColumn(column) & K_STROBED_MASK;
      }
    }
    return value & K_MASK;
  }

  /** Immutable snapshot for tests, `CPUState`, and future debug tooling. */
  snapshot(): Tms1370PortSnapshot {
    return {
      r: this._r,
      o: this._o,
      grids: this.readGrids(),
      plates: this.readPlates(),
      inputMux: this.readInputMux(),
      speaker: this.readSpeaker(),
    };
  }

  /** Apply a new R latch and report every pin whose level moved. */
  private updateR(next: number): void {
    const before = this._r;
    this._r = next & R_MASK;
    notify(before, this._r, R_PIN_COUNT, this.onRChange);
  }
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
