// PWM duty-cycle accumulator for the multiplexed VFD.
//
// Sources: MAME's driver for our own ROM mask scans 9 grids against 12 plates
// (docs/research/tms1370-io.md sections 1 and 3). The counts are a caller's to
// supply - this module is handed a matrix and accumulates against it - and only
// one grid is lit at a time, so a segment's apparent brightness is the fraction of
// the frame period during which its grid and its plate were driven together -
// exactly the quantity this module accumulates, and the quantity v1 faked by
// drawing sprites at full brightness.
//
// The accumulator is deliberately geometry-agnostic: grid and plate counts are
// constructor arguments, and display.ts supplies the machine's. Nothing here
// knows what a segment looks like.
//
// Pure arithmetic only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - every method takes the cycle count at which the event happened, and
// the caller (board.ts) reads that from the CPU.

/** One segment's share of a frame period. */
export interface SegmentDuty {
  /** Display grid, driven by R0-R8. */
  readonly grid: number;
  /** Plate (anode) bit index within the grid. */
  readonly plate: number;
  /** Machine cycles this segment was lit during the frame. */
  readonly activeCycles: number;
  /** `activeCycles` over the frame period, in 0..1 inclusive. */
  readonly duty: number;
}

/** Per-segment duty over one frame period. */
export interface PwmFrame {
  /** Cycle at which the frame period opened. */
  readonly startCycle: number;
  /** Cycle at which it closed. */
  readonly endCycle: number;
  /**
   * The denominator of every duty in this frame, in machine cycles.
   *
   * `endCycle - startCycle` less any interval the display was not being scanned
   * at all - see {@link PwmAccumulator.exclude}. The two are equal for every
   * frame in which the sweep kept running, which is almost all of them.
   */
  readonly cycles: number;
  /**
   * Segments with a non-zero duty, ordered by grid then plate. Segments that
   * were never lit are absent rather than present with duty 0, so a caller can
   * treat the list as "what the tube showed".
   */
  readonly segments: readonly SegmentDuty[];
}

/** No grid selected - the blanking interval between strobes. */
export const NO_GRID = -1;

/**
 * Accumulates per-segment active time across a frame period.
 *
 * The model is interval-based, not sampled: state changes arrive with the cycle
 * at which they happened, and the time since the previous change is credited to
 * whatever was lit across that interval. Nothing is polled, so a segment lit for
 * three cycles out of a 400-cycle frame yields a duty of 0.0075 rather than
 * being rounded to on or off by a sampling grid.
 *
 * Duty is therefore genuinely fractional. That is the whole point of the module:
 * a strobed 10-grid display puts every lit segment at roughly 0.1, and the
 * acceptance contract (V3) requires at least one segment strictly between 0 and
 * 1 as proof that accumulation is real rather than a binary write.
 */
export class PwmAccumulator {
  /** Active cycles per segment, indexed `grid * plateCount + plate`. */
  private readonly active: Float64Array;

  private _gridMask = 0;
  private _plateMask = 0;
  private _frameStart = 0;
  private _lastCycle = 0;
  private _excluded = 0;

  constructor(
    readonly gridCount: number,
    readonly plateCount: number,
  ) {
    if (!Number.isInteger(gridCount) || gridCount <= 0) {
      throw new RangeError(`grid count must be a positive integer: ${gridCount}`);
    }
    if (!Number.isInteger(plateCount) || plateCount <= 0) {
      throw new RangeError(`plate count must be a positive integer: ${plateCount}`);
    }
    this.active = new Float64Array(gridCount * plateCount);
  }

  /** Grids currently driven, as a bit mask. */
  get gridMask(): number {
    return this._gridMask;
  }

  /** Plates currently driven, as a bit mask. */
  get plateMask(): number {
    return this._plateMask;
  }

  /** Cycle at which the current frame period opened. */
  get frameStart(): number {
    return this._frameStart;
  }

  /** Cycle up to which active time has been credited. */
  get lastCycle(): number {
    return this._lastCycle;
  }

  /** Cycles excluded from this frame's period. See {@link exclude}. */
  get excludedCycles(): number {
    return this._excluded;
  }

  /**
   * Take `cycles` out of this frame's period - time the display was not being
   * scanned at all.
   *
   * Duty is a segment's share of a *refresh* period, and an interval in which
   * the driver stopped refreshing is not part of one. The ROM stops: it has one
   * core and no sound hardware, so while it bit-bangs the speaker it drives no
   * grid, for as long as the note lasts (docs/evidence/vfd-appearance.md D1).
   * Left in the denominator, a 71 ms note turns the sweep either side of it into
   * a frame at 18% of its real duty, and a segment that was fully driven for its
   * whole slot reads as a dim one. Excluded, the sweeps either side of a note
   * read exactly as they would with no note at all, which is what the tube does.
   *
   * This is deliberately not a general knob for shortening periods. Ordinary
   * variation - a pass through the game logic that takes longer because there is
   * more on the tube - stays in the denominator, because the display really is
   * dimmer when the sweep is slower. Only a full stop is excluded, and
   * display.ts decides what counts as one.
   */
  exclude(cycles: number): void {
    if (!Number.isFinite(cycles) || cycles < 0) {
      throw new RangeError(`excluded cycles must be finite and non-negative: ${cycles}`);
    }
    this._excluded += cycles;
  }

  /**
   * Open a frame period at `cycle`, discarding any accumulated active time.
   *
   * The driven state carries across: closing a frame does not turn the tube off,
   * and the grid that was lit when the sweep wrapped goes on being lit into the
   * new period.
   */
  startFrame(cycle: number): void {
    this.assertForward(cycle);
    this.active.fill(0);
    this._frameStart = cycle;
    this._lastCycle = cycle;
    this._excluded = 0;
  }

  /**
   * Record the complete driven state at `cycle`: which grids and which plates.
   *
   * Time since the previous event is credited first, so the *old* state owns the
   * interval that just ended. Multiple grid bits are permitted - the ROM strobes
   * one grid at a time, but two are briefly high while a sweep steps from one to
   * the next, and pretending otherwise would silently drop those cycles.
   */
  recordState(gridMask: number, plateMask: number, cycle: number): void {
    this.credit(cycle);
    this._gridMask = gridMask >>> 0;
    this._plateMask = plateMask >>> 0;
  }

  /**
   * Record one grid's plate pattern at `cycle`.
   *
   * Convenience over `recordState` for the common strobed case. Pass `NO_GRID`
   * for the blanking interval where no grid is driven.
   */
  recordGridPlate(grid: number, plates: number, cycle: number): void {
    if (grid !== NO_GRID && (!Number.isInteger(grid) || grid < 0 || grid >= this.gridCount)) {
      throw new RangeError(`grid out of range: ${grid} (expected 0..${this.gridCount - 1})`);
    }
    this.recordState(grid === NO_GRID ? 0 : 1 << grid, plates, cycle);
  }

  /**
   * Duty of every segment as of `cycle`, without closing the frame.
   *
   * Credits time up to `cycle` first, so sampling mid-frame reports the duty
   * actually accrued so far rather than the duty as of the last port write. The
   * accumulated totals survive - this is a read, and the probe uses it to
   * snapshot the tube at an arbitrary cycle.
   */
  sample(cycle: number): PwmFrame {
    this.credit(cycle);
    const period = Math.max(0, cycle - this._frameStart - this._excluded);
    const segments: SegmentDuty[] = [];

    for (let index = 0; index < this.active.length; index += 1) {
      const activeCycles = this.active[index];
      if (activeCycles <= 0) {
        continue;
      }
      segments.push({
        grid: Math.floor(index / this.plateCount),
        plate: index % this.plateCount,
        activeCycles,
        duty: period > 0 ? Math.min(1, activeCycles / period) : 0,
      });
    }

    return { startCycle: this._frameStart, endCycle: cycle, cycles: period, segments };
  }

  /**
   * Close the frame at `cycle` and open the next one there.
   *
   * @returns the duty of every lit segment over the period that just ended.
   */
  endFrame(cycle: number): PwmFrame {
    const frame = this.sample(cycle);
    this.active.fill(0);
    this._frameStart = cycle;
    this._excluded = 0;
    return frame;
  }

  /** Active cycles credited to one segment so far this frame. */
  getActiveCycles(grid: number, plate: number): number {
    return this.active[this.index(grid, plate)];
  }

  /**
   * Blank the tube and restart accounting at `cycle`.
   *
   * Unlike `startFrame`, this drops the driven state as well - the power switch
   * going off, not a sweep wrapping.
   */
  clear(cycle = 0): void {
    this.active.fill(0);
    this._gridMask = 0;
    this._plateMask = 0;
    this._frameStart = cycle;
    this._lastCycle = cycle;
    this._excluded = 0;
  }

  /** Credit the interval ending at `cycle` to whatever is currently lit. */
  private credit(cycle: number): void {
    this.assertForward(cycle);
    const elapsed = cycle - this._lastCycle;
    this._lastCycle = cycle;

    if (elapsed <= 0 || this._gridMask === 0 || this._plateMask === 0) {
      return;
    }

    for (let grid = 0; grid < this.gridCount; grid += 1) {
      if (((this._gridMask >>> grid) & 1) === 0) {
        continue;
      }
      const base = grid * this.plateCount;
      for (let plate = 0; plate < this.plateCount; plate += 1) {
        if ((this._plateMask >>> plate) & 1) {
          this.active[base + plate] += elapsed;
        }
      }
    }
  }

  private index(grid: number, plate: number): number {
    if (!Number.isInteger(grid) || grid < 0 || grid >= this.gridCount) {
      throw new RangeError(`grid out of range: ${grid} (expected 0..${this.gridCount - 1})`);
    }
    if (!Number.isInteger(plate) || plate < 0 || plate >= this.plateCount) {
      throw new RangeError(`plate out of range: ${plate} (expected 0..${this.plateCount - 1})`);
    }
    return grid * this.plateCount + plate;
  }

  /**
   * Reject a cycle count that moves backwards.
   *
   * Emulated time only ever advances, so a backwards timestamp means the caller
   * is wired wrong - reading a stale cycle count, or feeding a reset machine's
   * counter into a live accumulator. Failing here beats silently crediting
   * negative time and producing a plausible-looking duty.
   */
  private assertForward(cycle: number): void {
    if (!Number.isFinite(cycle)) {
      throw new RangeError(`cycle must be finite: ${cycle}`);
    }
    if (cycle < this._lastCycle) {
      throw new RangeError(`cycle moved backwards: ${cycle} < ${this._lastCycle}`);
    }
  }
}
