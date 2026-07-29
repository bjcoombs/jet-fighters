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
//
// The two phosphors are not one material with one response. Measured against the
// owner's video, red goes on emitting roughly four times longer than cyan
// between refreshes (docs/evidence/vfd-appearance.md section 3), so the response
// constants are keyed by the atlas's colour region and a field carries one set
// per segment.

import { STROBES_PER_SWEEP } from '../board/o-pla.js';
import { STROBE_CYCLES, STROBE_DWELL_INSTRUCTIONS } from '../board/tms1370-cadence.js';
import { ATLAS_TOPOLOGY } from '../topology.js';
import type { ColorRegion } from './atlas-schema.js';

/**
 * Timing and response constants for one phosphor.
 *
 * `decayTimeMs` is derived from measurement - see {@link MEASURED_RESIDUAL} and
 * {@link PHOSPHOR}. `riseTimeMs` is not: docs/evidence/vfd-appearance.md samples
 * at 33.33 ms and states plainly that it cannot see a 2-5 ms rise, so the rise
 * is **neither confirmed nor refuted** by it and stays the brief's judgement
 * call. Do not cite that document for the rise time. `referenceDuty` and `gamma`
 * are properties of the sweep and of the eye rather than of a phosphor, and are
 * the same in both regions; they live here because the set is keyed by region.
 */
export interface PhosphorConstants {
  /** Milliseconds from dark to 90% of target when the segment is driven. */
  readonly riseTimeMs: number;
  /** Milliseconds from full to 10% of target once the segment stops being driven. */
  readonly decayTimeMs: number;
  /**
   * Duty at which a segment reads as fully lit.
   *
   * A multiplexed display lights each grid for a fraction of the refresh period,
   * so a segment driven for the whole of the slot the sweep gives it accumulates
   * a duty far below 1.0. Perceived brightness is the fraction of *its own slot*
   * the segment was driven for, so duty is normalised against this before the
   * response curve. Nothing thresholds duty to on/off: a segment driven for half
   * its slot lands at half scale and shows it.
   *
   * @see {@link LIT_DUTY} for the figure and {@link REFERENCE_DUTY} for the grid
   *   share it starts from.
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

/** One `PhosphorConstants` per phosphor region of the tube. */
export type PhosphorSet = Readonly<Record<ColorRegion, PhosphorConstants>>;

/**
 * Converts a 0-90% (rise) or 100-10% (decay) transition time into the time
 * constant of the exponential that produces it. Both are one decade of
 * approach, so both scale by ln(10).
 */
const DECADE = Math.LN10;

/**
 * Light still emitted between refreshes, as a fraction of the driven level.
 *
 * **This is the measured quantity.** docs/evidence/vfd-appearance.md section 3
 * takes frames where an element is still being driven by the ROM but the camera
 * missed its grid slot, and normalises the light left in them against the driven
 * level, over four independently sampled 600-frame windows:
 *
 * | window  | red   | cyan               |
 * | ------- | ----- | ------------------ |
 * | t=25 s  | 14.7% | 4.5%               |
 * | t=120 s | 14.4% | (1 element - none) |
 * | t=210 s | 20.7% | 3.2%               |
 * | t=340 s | 13.4% | 3.3%               |
 *
 * Cyan 3.2-4.5% from 1,300-1,500 samples per window; red 13-21% from 200+.
 * Reproduced in every window that had the data. The midpoints are taken here.
 * Red persisting ~4x longer than cyan is the finding - one decay constant cannot
 * express it, which is why this set is keyed by region.
 */
export const MEASURED_RESIDUAL: Readonly<Record<ColorRegion, number>> = {
  cyan: 0.035,
  red: 0.155,
};

/**
 * Milliseconds a grid spends unlit between its own slots - the interval the
 * residual is measured across.
 *
 * **This is an assumption, not a measurement, and it is the only one the decay
 * times rest on.**
 *
 *     T_off = T_sweep * (1 - grid duty)
 *
 * Section 3 takes T_sweep ~= 13.5 ms from the 70.6-72.5 Hz bracket that survives
 * the video's aliasing (section 2), against the ten-grid ~10% duty that
 * display.ts and ports.ts implement, and gets ~12 ms. That is the figure used
 * here, so these constants reproduce the tau the document publishes.
 *
 * **This is the number to change if the sweep moves, and the only one.** The
 * residuals are ratios and do not move with it; the decay times do, which is why
 * they are inverted from the residuals in code rather than pasted in as two
 * literals. Since the exponential term is negligible at these ratios the
 * relationship is simply `decayTimeMs = ln(10) * residual * T_off`, i.e. linear
 * - worked here so the next person does not have to:
 *
 * | T_off   | cyan decay | red decay | where it comes from                     |
 * | ------- | ---------- | --------- | --------------------------------------- |
 * | 14.0 ms | 1.13 ms    | 5.00 ms   | the ROM's current 64.5 Hz sweep         |
 * | 12.6 ms | 1.02 ms    | 4.50 ms   | 71.5 Hz, the centre of D4's target band |
 * | 12.0 ms | 0.97 ms    | 4.29 ms   | section 3's own figure - what ships      |
 *
 * D4 moves the ROM into 70.6-72.5 Hz on a separate branch, which shortens the
 * off-time by about a tenth and lengthens both decay times by about a twentieth.
 * Editing this constant is the whole change: the tests assert the residuals, and
 * one of them re-derives the constants across a range of off-times to hold that
 * true.
 */
export const REFRESH_OFF_TIME_MS = 12;

/**
 * Mean brightness across an off-interval of `offTimeMs`, for a phosphor whose
 * decay time is `decayTimeMs`, starting from a fully driven segment.
 *
 * The camera integrates the decay over its exposure rather than sampling an
 * instant, so what section 3 measured is this average and not `e^(-T/tau)`:
 *
 *     residual = (tau / T_off) * (1 - e^(-T_off / tau)),  tau = decayTimeMs / ln 10
 */
export function residualAfterOffTime(decayTimeMs: number, offTimeMs: number): number {
  if (!Number.isFinite(decayTimeMs) || !Number.isFinite(offTimeMs) || offTimeMs <= 0) {
    throw new RangeError(`residualAfterOffTime needs finite ms and a positive off-time: ${decayTimeMs}, ${offTimeMs}`);
  }
  if (decayTimeMs <= 0) {
    return 0;
  }
  const tau = decayTimeMs / DECADE;
  return (tau / offTimeMs) * (1 - Math.exp(-offTimeMs / tau));
}

/**
 * The inverse: the decay time that produces a measured `residual` across
 * `offTimeMs`.
 *
 * `residualAfterOffTime` is strictly increasing in the decay time and has no
 * closed-form inverse, so this bisects. Pure and deterministic - the same inputs
 * give the same bits on every run, which is what lets the constants below be
 * computed at module load rather than hand-copied.
 */
export function decayTimeForResidual(residual: number, offTimeMs: number): number {
  if (!Number.isFinite(residual) || residual <= 0 || residual >= 1) {
    throw new RangeError(`residual must be a fraction strictly inside (0, 1): ${residual}`);
  }
  let low = 0;
  let high = offTimeMs * 64;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (residualAfterOffTime(mid, offTimeMs) < residual) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

/**
 * Milliseconds from dark to 90% once a segment is driven.
 *
 * Unchanged and **unverified**: 33.33 ms video sampling cannot resolve a 2-5 ms
 * rise, so the reference neither confirms nor refutes it (vfd-appearance.md D8).
 * The brief's ~2-5 ms remains the only source. Same value in both regions
 * because nothing measures a difference, not because a difference was ruled out.
 */
const RISE_TIME_MS = 4;

/**
 * One grid's share of a sweep: 1/9 on this tube.
 *
 * This is the *grid* duty, and on the TMS1370 it is the only one of the three
 * factors below that the glass decides - nine grids, so a ninth of the refresh
 * period each. `docs/contract/v3.contract.md` criterion V14 pins it at 1/9 and
 * it is derived from the topology rather than written as a fraction, so a
 * re-addressing moves it rather than leaving it asserting a tube we no longer
 * have.
 *
 * It was 0.1 and documented as `1/GRID_COUNT` while that count was the v2 core's
 * ten. See src/machine/topology.ts for why there are two answers to that.
 */
export const REFERENCE_DUTY = 1 / ATLAS_TOPOLOGY.gridCount;

/**
 * Strobes the sweep issues per grid: 24 across 9 grids, so 8/3.
 *
 * The **second, independent multiplier** on {@link REFERENCE_DUTY}, and the one
 * `docs/research/pla-design.md` flags: a grid cannot be drawn in one `TDO`, so
 * the sweep makes four passes and a segment is lit in only the pass its family
 * belongs to. Its share of the sweep is therefore a 24th, not a ninth.
 */
export const STROBES_PER_GRID = STROBES_PER_SWEEP / ATLAS_TOPOLOGY.gridCount;

/**
 * The fraction of a strobe's slot the ROM actually holds the grid high.
 *
 * The **third** multiplier, and the one no plan on paper can supply: a strobe
 * gets ~37 instructions of the sweep and spends seven of them with its grid up.
 * Measured off the running machine - see
 * `src/machine/board/tms1370-cadence.ts` `STROBE_DWELL_INSTRUCTIONS`, which
 * `tools/probe/tms1370-timing.test.ts` holds to the ROM.
 */
export const STROBE_DUTY = STROBE_DWELL_INSTRUCTIONS / STROBE_CYCLES;

/**
 * Duty a segment reaches when the ROM is driving it as hard as it can.
 *
 * The product of the three factors above, which is what a segment lit in one
 * pass measures out at over a sweep: about 1/127. Brightness is normalised
 * against *this* rather than against {@link REFERENCE_DUTY}, and the difference
 * is not cosmetic - normalising a 1/127 duty against 1/9 renders the tube at
 * 18% of the brightness it should have, and against the sweep plan's 1/24 at
 * 34%. Both are the same mistake at different depths: counting grids, or
 * counting strobes, instead of counting the time a grid is up.
 */
export const LIT_DUTY = (REFERENCE_DUTY / STROBES_PER_GRID) * STROBE_DUTY;

/** Duty response exponent - see {@link PhosphorConstants.gamma}. */
const GAMMA = 0.65;

function phosphorFor(region: ColorRegion): PhosphorConstants {
  return {
    riseTimeMs: RISE_TIME_MS,
    decayTimeMs: decayTimeForResidual(MEASURED_RESIDUAL[region], REFRESH_OFF_TIME_MS),
    referenceDuty: LIT_DUTY,
    gamma: GAMMA,
  };
}

/**
 * The tube's two phosphors.
 *
 * The decay times are computed, not chosen: `decayTimeForResidual` inverts the
 * measured {@link MEASURED_RESIDUAL} over the assumed {@link REFRESH_OFF_TIME_MS}.
 * At 12 ms off-time that lands at
 *
 *     cyan  3.5% residual -> tau ~= 0.42 ms -> decayTimeMs ~= 0.97
 *     red  15.5% residual -> tau ~= 1.86 ms -> decayTimeMs ~= 4.29
 *
 * which is the "~1.0 ms" and "~4.4 ms" to 10% that vfd-appearance.md quotes.
 * The single 15 ms this module used before returns a 46% residual over the same
 * interval - 3x too slow for red and 15x too slow for cyan - and, being single,
 * could not have been right for both regions at once whatever value it took.
 */
export const PHOSPHOR: PhosphorSet = {
  cyan: phosphorFor('cyan'),
  red: phosphorFor('red'),
};

/**
 * Steady-state brightness for a duty cycle, in 0..1.
 *
 * Normalises against {@link PhosphorConstants.referenceDuty} and applies the
 * response curve. Saturating at 1 is physical: a segment cannot emit harder
 * than fully driven, however long the ROM parks its grid.
 */
export function targetBrightness(duty: number, constants: PhosphorConstants): number {
  if (!Number.isFinite(duty) || duty <= 0) {
    return 0;
  }
  const normalised = Math.min(1, duty / constants.referenceDuty);
  return normalised ** constants.gamma;
}

/**
 * Brightness at which a frame reads as a lit tube rather than a fading one.
 *
 * Re-derived from {@link REFERENCE_DUTY} through {@link LIT_DUTY}, which is what
 * `docs/contract/v3.contract.md` criterion V14 asks for, rather than being the
 * hand-set 0.8 the v2 probe suites carried. The anchor is half drive: a segment
 * held for half the strobe the sweep gives it is the boundary
 * {@link PhosphorConstants.referenceDuty} already draws - "a segment driven for
 * half its slot lands at half scale and shows it" - and the gamma lifts that to
 * about 0.64 of full emission.
 *
 * Above it, a tube is being refreshed. Below it, either the sweep has stopped
 * and the phosphor is on its way down, or a frame period closed around a stall
 * and every duty in it collapsed. Both are what the assertions using this exist
 * to separate from a normally lit tube, and neither survives the threshold.
 *
 * `referenceDuty` and `gamma` are the same in both regions, so cyan's constants
 * stand for the pair here.
 */
export const LIT_BRIGHTNESS = targetBrightness(LIT_DUTY / 2, PHOSPHOR.cyan);

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
  constants: PhosphorConstants,
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
 *
 * Constructed from the segments' colour regions rather than from a count,
 * because each segment integrates on its own phosphor's constants: a red segment
 * and a cyan one that stop being driven in the same frame do not fade together.
 */
export class PhosphorField {
  /** Segment count - one entry per colour region handed to the constructor. */
  readonly size: number;
  private readonly duty: Float64Array;
  private readonly level: Float64Array;
  /** Response constants per segment, resolved once from its colour region. */
  private readonly response: readonly PhosphorConstants[];

  constructor(
    readonly regions: readonly ColorRegion[],
    readonly constants: PhosphorSet = PHOSPHOR,
  ) {
    if (regions.length === 0) {
      throw new RangeError('phosphor field needs at least one segment');
    }
    this.size = regions.length;
    this.response = regions.map((region) => {
      const response = constants[region];
      if (!response) {
        throw new RangeError(`no phosphor constants for colour region '${region}'`);
      }
      return response;
    });
    this.duty = new Float64Array(this.size);
    this.level = new Float64Array(this.size);
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
      const response = this.response[index];
      const target = targetBrightness(this.duty[index], response);
      this.level[index] = stepBrightness(this.level[index], target, dtMs, response);
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
