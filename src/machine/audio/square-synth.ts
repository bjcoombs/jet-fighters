// Band-limited reconstruction of the D14 square wave from pin transitions.
//
// The speaker is a 1-bit piezo: the pin is high or it is low, and the sound is
// entirely the ROM's timing between those two states. This module turns the
// transition list back into samples and does nothing else to it - no envelope,
// no filter, no effect. Character comes from when the ROM toggles the pin, and
// anything added here would be a v2 invention rather than the machine.
//
// The one thing that is not naive is the edge shape. A transition almost never
// lands on a sample boundary, and snapping it to the nearest sample folds the
// error back into the audible band as inharmonic partials: a 1520 Hz blip
// rendered naively at 48 kHz shows energy the piezo never produced, and the
// spectral tests would read it. Each step is therefore corrected with a
// polyBLEP residual - the two-sample polynomial approximation to the difference
// between a band-limited step and a hard one - which places the discontinuity
// at its true fractional position.
//
// Pure: no AudioContext, no DOM, no timers. Acceptance criterion V5 calls
// `renderSquare` directly on a `[cycle, level]` array in plain Node.

import {
  cyclesToSamples,
  normaliseEdges,
  type EdgeBlock,
  type EdgeInput,
  type SampledEdge,
} from './edge-buffer.js';
import { SPEAKER_REST_LEVEL } from '../board/speaker.js';

/**
 * Peak sample value for a pin held high.
 *
 * Half scale leaves headroom for the polyBLEP overshoot at a transition, which
 * is a real property of a band-limited step (Gibbs ringing) and is not clipped
 * away - clipping it would put back the harmonics the band-limiting removed.
 */
export const DEFAULT_AMPLITUDE = 0.5;

export interface SquareRenderOptions {
  /** Machine cycles per second - `CPU.getCyclesPerSecond()`. */
  readonly cyclesPerSecond: number;
  /** Audio sample rate in hertz. */
  readonly sampleRate: number;
  /** Peak value for a high pin; defaults to {@link DEFAULT_AMPLITUDE}. */
  readonly amplitude?: number;
  /** Level the pin holds before the first edge; defaults to the speaker rest level. */
  readonly startLevel?: 0 | 1;
  /** Exact output length. Defaults to the span of the edges plus `tailSamples`. */
  readonly lengthSamples?: number;
  /** Samples of held level to render after the last edge. Defaults to 0. */
  readonly tailSamples?: number;
}

/**
 * The polyBLEP step residual at `x` samples from the discontinuity.
 *
 * Adding `height * residual(n - p)` to a naive step of `height` at fractional
 * position `p` band-limits it. Zero outside `(-1, 1)`, so only the two samples
 * straddling the transition are touched, and continuous at `x = 0` where both
 * branches give the half-way point.
 */
export function polyBlepResidual(x: number): number {
  if (x <= -1 || x >= 1) {
    return 0;
  }
  if (x < 0) {
    return 0.5 * x * x + x + 0.5;
  }
  return x - 0.5 * x * x - 0.5;
}

/** Sample value for a pin level: high is `+amplitude`, low is `-amplitude`. */
export function levelToValue(level: 0 | 1, amplitude: number): number {
  return level ? amplitude : -amplitude;
}

/**
 * Paint edges into `out`, band-limited.
 *
 * @returns the value held at the end of the block and the residual owed to the
 *   first sample of whatever comes next (a transition in the last sample of a
 *   block corrects the sample after it).
 */
function paint(
  out: Float32Array,
  edges: readonly SampledEdge[],
  startValue: number,
  amplitude: number,
): { endValue: number; carry: number } {
  const n = out.length;

  // Naive fill first: hold each level until the sample the next transition
  // reaches. Corrections are added afterwards so they are never overwritten.
  let value = startValue;
  let index = 0;
  for (const edge of edges) {
    const to = Math.min(n, Math.ceil(edge.sample));
    for (; index < to; index += 1) {
      out[index] = value;
    }
    value = levelToValue(edge.level, amplitude);
  }
  for (; index < n; index += 1) {
    out[index] = value;
  }

  // Band-limit each step in place.
  let carry = 0;
  let previous = startValue;
  for (const edge of edges) {
    const next = levelToValue(edge.level, amplitude);
    const height = next - previous;
    previous = next;
    if (height === 0) {
      continue;
    }
    const floor = Math.floor(edge.sample);
    const frac = edge.sample - floor;
    const before = height * polyBlepResidual(-frac);
    const after = height * polyBlepResidual(1 - frac);
    if (floor >= 0 && floor < n) {
      out[floor] += before;
    }
    if (floor + 1 < n) {
      out[floor + 1] += after;
    } else if (floor + 1 === n) {
      carry += after;
    }
  }

  return { endValue: value, carry };
}

/**
 * Reconstruct the whole edge stream as samples.
 *
 * This is the headless path: give it a `[cycle, level]` array and a clock rate
 * and it returns the waveform, with no audio API anywhere. Acceptance criterion
 * V5 renders the probe's `speakerEdges` through here and takes the FFT of the
 * result.
 *
 * The timeline is anchored on the first edge, so the array starts at the moment
 * the ROM first moved the pin rather than at machine reset.
 */
export function renderSquare(edges: EdgeInput, options: SquareRenderOptions): Float32Array {
  const { cyclesPerSecond, sampleRate } = options;
  const amplitude = options.amplitude ?? DEFAULT_AMPLITUDE;
  const startLevel = options.startLevel ?? SPEAKER_REST_LEVEL;
  const list = normaliseEdges(edges);

  const origin = list.length > 0 ? list[0].cycle : 0;
  const placed: SampledEdge[] = list.map((edge) => ({
    sample: cyclesToSamples(edge.cycle - origin, cyclesPerSecond, sampleRate),
    level: edge.level,
  }));

  const span = placed.length > 0 ? placed[placed.length - 1].sample : 0;
  const tail = options.tailSamples ?? 0;
  const length = options.lengthSamples ?? Math.ceil(span) + tail;
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`lengthSamples must be a non-negative integer: ${length}`);
  }

  const out = new Float32Array(length);
  paint(out, placed, levelToValue(startLevel, amplitude), amplitude);
  return out;
}

/** Emulated milliseconds spanned by an edge stream, first transition to last. */
export function edgeSpanMs(edges: EdgeInput, cyclesPerSecond: number): number {
  const list = normaliseEdges(edges);
  if (list.length < 2) {
    return 0;
  }
  const span = list[list.length - 1].cycle - list[0].cycle;
  return (span / cyclesPerSecond) * 1000;
}

export interface SquareSynthOptions {
  /** Peak value for a high pin; defaults to {@link DEFAULT_AMPLITUDE}. */
  readonly amplitude?: number;
  /** Level the pin holds before the first block; defaults to the speaker rest level. */
  readonly startLevel?: 0 | 1;
}

/**
 * Block-at-a-time reconstruction, for the real-time path.
 *
 * Holds only what has to survive a block boundary: the level the pin is sitting
 * at, and the polyBLEP residual owed to the next block by a transition in the
 * last sample of this one. Dropping that residual would leave a per-block
 * discontinuity - a faint buzz at the block rate that no amount of buffering
 * removes.
 *
 * It has no clock. The driver hands it blocks; it renders them.
 */
export class SquareSynth {
  readonly amplitude: number;

  private _level: 0 | 1;
  private _carry = 0;

  constructor(options: SquareSynthOptions = {}) {
    this.amplitude = options.amplitude ?? DEFAULT_AMPLITUDE;
    this._level = options.startLevel ?? SPEAKER_REST_LEVEL;
  }

  /** Level the pin holds at the next sample to be rendered. */
  get level(): 0 | 1 {
    return this._level;
  }

  /** Residual owed to the first sample of the next block. */
  get carry(): number {
    return this._carry;
  }

  /**
   * Render one block.
   *
   * `block.startLevel` is ignored in favour of the synth's own held level: the
   * synth is the authority on what the last sample it emitted was, and trusting
   * the buffer's view instead would let a dropped block flip the waveform.
   *
   * @param out optional destination, reused to avoid an allocation per callback.
   */
  render(block: EdgeBlock, out?: Float32Array): Float32Array {
    const target = out && out.length === block.frames ? out : new Float32Array(block.frames);
    const { carry } = paint(
      target,
      block.edges,
      levelToValue(this._level, this.amplitude),
      this.amplitude,
    );
    if (target.length > 0) {
      target[0] += this._carry;
    }
    this._carry = carry;
    if (block.edges.length > 0) {
      this._level = block.edges[block.edges.length - 1].level;
    }
    return target;
  }

  /** Return to the speaker rest level with nothing owed. */
  reset(level: 0 | 1 = SPEAKER_REST_LEVEL): void {
    this._level = level;
    this._carry = 0;
  }
}
