// Phosphor persistence: per-segment brightness state with rise and decay.
//
// The board's PWM accumulator (src/machine/board/pwm.ts) yields a *duty cycle*
// per segment - the real fraction of a frame period during which that segment's
// grid and plate were driven together. Duty is not brightness. On the real tube
// the phosphor takes time to reach full emission when the anode is driven, and
// goes on emitting after it stops, so what the eye sees trails the duty rather
// than snapping to it. That lag is what makes a strobed VFD shimmer instead of
// strobing visibly, and it is what this module models.
//
// Pure arithmetic and pure state: no canvas, no DOM, no Web APIs, and no clock
// of its own - every step takes the elapsed milliseconds from its caller. The
// rest of src/machine/ is Node-importable and the acceptance contract drives it
// headlessly; only renderer.ts touches a 2D context.

/**
 * Timing and response constants for one phosphor.
 *
 * The rise and decay times are **judgement calls, not measurements**. No
 * artifact in docs/evidence/ records the tube's phosphor response; the owner's
 * gameplay video is the only visual reference and it is far too slow to resolve
 * a millisecond-scale curve. The values below are the brief's stated range
 * (rise ~2-5 ms, decay ~10-20 ms), which is in the right order for a
 * ZnO:Zn-class VFD phosphor once persistence of vision is folded in. If the
 * pending high-frame-rate reference ever lands, these are the numbers to revise.
 */
export interface PhosphorConstants {
  /** Milliseconds from dark to 90% of target when the segment is driven. */
  readonly riseTimeMs: number;
  /** Milliseconds from full to 10% of target once the segment stops being driven. */
  readonly decayTimeMs: number;
  /**
   * Duty at which a segment reads as fully lit.
   *
   * A 10-grid multiplexed display lights each grid for roughly a tenth of the
   * frame, so a segment driven for the whole of its slot accumulates a duty near
   * 0.1 - not 1.0. Perceived brightness is the fraction of *its own slot* the
   * segment was driven for, so duty is normalised against this before the
   * response curve. Nothing thresholds duty to on/off: a segment driven for half
   * its slot lands at half scale and shows it.
   *
   * @see src/machine/board/display.ts `GRID_COUNT`
   */
  readonly referenceDuty: number;
  /**
   * Exponent applied to normalised duty. Below 1 it lifts the mid range, which
   * is roughly how the eye responds to emitted light and keeps a segment at a
   * fraction of full drive clearly visible rather than crushed toward black.
   * A judgement call, tuned by eye against the reference photos.
   */
  readonly gamma: number;
}

/** Default phosphor response. See {@link PhosphorConstants} for provenance. */
export const PHOSPHOR: PhosphorConstants = {
  riseTimeMs: 4,
  decayTimeMs: 15,
  referenceDuty: 0.1,
  gamma: 0.65,
};

/**
 * Converts a 0-90% (rise) or 100-10% (decay) transition time into the time
 * constant of the exponential that produces it. Both are one decade of
 * approach, so both scale by ln(10).
 */
const DECADE = Math.LN10;

/**
 * Steady-state brightness for a duty cycle, in 0..1.
 *
 * Normalises against {@link PhosphorConstants.referenceDuty} and applies the
 * response curve. Saturating at 1 is physical: a segment cannot emit harder
 * than fully driven, however long the ROM parks its grid.
 */
export function targetBrightness(duty: number, constants: PhosphorConstants = PHOSPHOR): number {
  if (!Number.isFinite(duty) || duty <= 0) {
    return 0;
  }
  const normalised = Math.min(1, duty / constants.referenceDuty);
  return normalised ** constants.gamma;
}

/**
 * Advance one segment's brightness toward `target` over `dtMs`.
 *
 * Exponential approach with separate time constants each way: the phosphor
 * lights faster than it fades, which is why a segment that has just gone dark
 * leaves a trail behind a moving jet while one that has just lit does not lead
 * it. Pure - takes the current value and returns the next.
 */
export function stepBrightness(
  current: number,
  target: number,
  dtMs: number,
  constants: PhosphorConstants = PHOSPHOR,
): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) {
    throw new RangeError(`brightness must be finite: current=${current} target=${target}`);
  }
  if (!Number.isFinite(dtMs)) {
    throw new RangeError(`dtMs must be finite: ${dtMs}`);
  }
  if (dtMs <= 0) {
    return current;
  }

  const rising = target > current;
  const transitionMs = rising ? constants.riseTimeMs : constants.decayTimeMs;
  if (transitionMs <= 0) {
    return target;
  }

  // Exponential approach: saturating for any dt, so a multi-second delta from a
  // backgrounded tab settles at the target rather than overshooting it.
  const tau = transitionMs / DECADE;
  const step = 1 - Math.exp(-dtMs / tau);
  return current + (target - current) * step;
}

/**
 * Brightness state for a fixed set of segments, indexed by position.
 *
 * The renderer owns one of these, sized to the atlas, and indexes it by segment
 * order. Two buffers: the duty written this frame, and the brightness the
 * phosphor has actually reached. `beginFrame` clears the duty buffer, so a
 * segment the board did not report is a segment at duty 0 - fading, not held.
 */
export class PhosphorField {
  private readonly duty: Float64Array;
  private readonly level: Float64Array;

  constructor(
    readonly size: number,
    readonly constants: PhosphorConstants = PHOSPHOR,
  ) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new RangeError(`phosphor field size must be a positive integer: ${size}`);
    }
    this.duty = new Float64Array(size);
    this.level = new Float64Array(size);
  }

  /** Clear the duty buffer. Every segment is unlit until `setDuty` says otherwise. */
  beginFrame(): void {
    this.duty.fill(0);
  }

  /**
   * Record one segment's duty for this frame. Fractional throughout - the value
   * is the board's accumulated duty, never a boolean.
   */
  setDuty(index: number, duty: number): void {
    this.duty[this.checked(index)] = Number.isFinite(duty) && duty > 0 ? duty : 0;
  }

  /** Duty recorded for a segment this frame. */
  dutyAt(index: number): number {
    return this.duty[this.checked(index)];
  }

  /**
   * Integrate every segment's brightness toward the target implied by its duty,
   * over `dtMs` milliseconds of wall time.
   */
  advance(dtMs: number): void {
    for (let index = 0; index < this.size; index += 1) {
      const target = targetBrightness(this.duty[index], this.constants);
      this.level[index] = stepBrightness(this.level[index], target, dtMs, this.constants);
    }
  }

  /** Brightness a segment's phosphor has reached, in 0..1. */
  brightnessAt(index: number): number {
    return this.level[this.checked(index)];
  }

  /** Read-only view of every segment's brightness, in index order. */
  brightnesses(): Readonly<Float64Array> {
    return this.level;
  }

  /** True while any segment is emitting above `threshold`. */
  anyLit(threshold = 0): boolean {
    for (let index = 0; index < this.size; index += 1) {
      if (this.level[index] > threshold) {
        return true;
      }
    }
    return false;
  }

  /** Blank the tube instantly - the power switch going off, not a fade. */
  reset(): void {
    this.duty.fill(0);
    this.level.fill(0);
  }

  private checked(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`segment index out of range: ${index} (expected 0..${this.size - 1})`);
    }
    return index;
  }
}
