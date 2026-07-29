// Cycle-domain to sample-domain conversion for the R15 pin edge stream.
//
// The speaker (src/machine/board/speaker.ts) records transitions stamped with
// exact machine cycles. Audio hardware wants samples. This module is the only
// place the two clocks meet, and the conversion is the whole of it:
//
//     seconds = cycle / cyclesPerSecond          (CPU.getCyclesPerSecond())
//     sample  = seconds * sampleRate
//
// Nothing here synthesises and nothing here has a clock of its own. The caller
// runs the machine, hands over whatever `board.takeSpeakerEdges()` produced,
// and pulls blocks back out. Pure state: no AudioContext, no DOM, no timers -
// the headless spectral tests and the acceptance contract's V5 reconstruction
// both run this in plain Node.
//
// There is no event API here on purpose. If the ROM does not toggle the pin,
// nothing arrives, and the output is silence.

import { SPEAKER_REST_LEVEL, type SpeakerEdge, type SpeakerEdgePair } from '../board/speaker.js';

/**
 * Target buffer depth in milliseconds.
 *
 * Deep enough to absorb the jitter of a frame-driven emulation loop (the caller
 * pushes a burst of edges once per animation frame, ~16.7 ms apart), shallow
 * enough that the blip stays in sync with the tube. 20-50 ms is the working
 * range; below 20 ms a single late frame underruns.
 */
export const DEFAULT_LATENCY_MS = 30;

/** Shallowest useful buffer: one animation frame plus margin. */
export const MIN_LATENCY_MS = 20;

/** Deepest buffer before audio visibly trails the display. */
export const MAX_LATENCY_MS = 50;

/**
 * Edges retained before the oldest are dropped.
 *
 * A runaway producer (a caller that never drains) must not grow the heap
 * without bound. At the machine's fastest plausible toggle rate this is many
 * seconds of sound, so it is a leak guard rather than a working limit; drops
 * are counted so a caller can tell the difference.
 */
export const DEFAULT_MAX_EDGES = 1 << 16;

/** Either accepted edge encoding: the struct form or the `[cycle, level]` wire form. */
export type EdgeInput = readonly SpeakerEdge[] | readonly SpeakerEdgePair[];

/** A transition placed on the audio timeline. */
export interface SampledEdge {
  /** Position in samples. Fractional - an edge rarely lands on a sample boundary. */
  readonly sample: number;
  /** Level after the transition. */
  readonly level: 0 | 1;
}

/** One block of transitions, ready for the synthesiser. */
export interface EdgeBlock {
  /** Level the pin holds at the first sample of the block. */
  readonly startLevel: 0 | 1;
  /** Transitions inside the block, `sample` relative to the block start. */
  readonly edges: readonly SampledEdge[];
  /** Samples the block covers. */
  readonly frames: number;
}

export interface EdgeBufferOptions {
  /** Machine cycles per second - `CPU.getCyclesPerSecond()`. */
  readonly cyclesPerSecond: number;
  /** Audio sample rate in hertz. */
  readonly sampleRate: number;
  /** Target buffer depth; defaults to {@link DEFAULT_LATENCY_MS}. */
  readonly latencyMs?: number;
  /** Retention limit; defaults to {@link DEFAULT_MAX_EDGES}. */
  readonly maxEdges?: number;
}

/** Seconds of emulated time a cycle count represents. */
export function cyclesToSeconds(cycle: number, cyclesPerSecond: number): number {
  if (!(cyclesPerSecond > 0)) {
    throw new RangeError(`cyclesPerSecond must be positive: ${cyclesPerSecond}`);
  }
  return cycle / cyclesPerSecond;
}

/** Audio samples a cycle count represents, fractional and unrounded. */
export function cyclesToSamples(
  cycle: number,
  cyclesPerSecond: number,
  sampleRate: number,
): number {
  if (!(sampleRate > 0)) {
    throw new RangeError(`sampleRate must be positive: ${sampleRate}`);
  }
  return cyclesToSeconds(cycle, cyclesPerSecond) * sampleRate;
}

/** True when the value is a `[cycle, level]` pair rather than a {@link SpeakerEdge}. */
function isPair(edge: SpeakerEdge | SpeakerEdgePair): edge is SpeakerEdgePair {
  return Array.isArray(edge);
}

/**
 * Accept either edge encoding and produce the struct form.
 *
 * The probe emits `[cycle, level]` pairs (V5's wire format) and the board hands
 * over {@link SpeakerEdge} objects; both describe the same transitions.
 */
export function normaliseEdges(input: EdgeInput): SpeakerEdge[] {
  const out: SpeakerEdge[] = [];
  for (const edge of input as readonly (SpeakerEdge | SpeakerEdgePair)[]) {
    if (isPair(edge)) {
      const [cycle, level] = edge;
      out.push({ cycle, level: level ? 1 : 0 });
    } else {
      out.push({ cycle: edge.cycle, level: edge.level ? 1 : 0 });
    }
  }
  return out;
}

/**
 * The R15 edge stream on an audio timeline.
 *
 * Cycle zero of the timeline is the first edge ever pushed: the machine may
 * have run silently for a long while before the ROM first touched the pin, and
 * anchoring on the first transition avoids carrying that silence as samples.
 * Every later cycle is placed relative to that anchor, so gaps between sounds
 * survive exactly as long as the ROM made them.
 *
 * Reading is block-oriented. `take(frames)` returns the transitions covering
 * the next `frames` samples together with the level held entering the block,
 * which is all {@link SquareSynth} needs to continue the waveform. The playhead
 * advances whether or not edges were available: an empty block is the pin
 * holding still, which is what silence is on a 1-bit speaker.
 */
export class EdgeBuffer {
  readonly cyclesPerSecond: number;
  readonly sampleRate: number;
  readonly latencyMs: number;
  readonly maxEdges: number;

  private _queue: SampledEdge[] = [];
  private _head = 0;
  private _originCycle: number | null = null;
  private _lastCycle = Number.NEGATIVE_INFINITY;
  private _playhead = 0;
  private _latestSample = 0;
  private _level: 0 | 1 = SPEAKER_REST_LEVEL;
  private _dropped = 0;

  constructor(options: EdgeBufferOptions) {
    const { cyclesPerSecond, sampleRate } = options;
    if (!(cyclesPerSecond > 0)) {
      throw new RangeError(`cyclesPerSecond must be positive: ${cyclesPerSecond}`);
    }
    if (!(sampleRate > 0)) {
      throw new RangeError(`sampleRate must be positive: ${sampleRate}`);
    }
    const latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
    if (!(latencyMs >= 0)) {
      throw new RangeError(`latencyMs must be non-negative: ${latencyMs}`);
    }
    this.cyclesPerSecond = cyclesPerSecond;
    this.sampleRate = sampleRate;
    this.latencyMs = latencyMs;
    this.maxEdges = options.maxEdges ?? DEFAULT_MAX_EDGES;
  }

  /** Buffer depth expressed in samples. */
  get latencySamples(): number {
    return (this.latencyMs / 1000) * this.sampleRate;
  }

  /** Transitions queued and not yet rendered. */
  get pending(): number {
    return this._queue.length - this._head;
  }

  /** Edges discarded because the queue hit {@link EdgeBufferOptions.maxEdges}. */
  get dropped(): number {
    return this._dropped;
  }

  /** Level the pin holds at the playhead. */
  get level(): 0 | 1 {
    return this._level;
  }

  /** Playhead position in samples since the first edge. */
  get playhead(): number {
    return this._playhead;
  }

  /** Samples of sound pushed but not yet rendered. Negative after an underrun. */
  get available(): number {
    return this._latestSample - this._playhead;
  }

  /** True once enough sound is queued to start rendering without underrunning. */
  get primed(): boolean {
    return this.available >= this.latencySamples;
  }

  /** Place a cycle stamp on the audio timeline. Anchors the timeline if unset. */
  cycleToSample(cycle: number): number {
    const origin = this._originCycle ?? cycle;
    return cyclesToSamples(cycle - origin, this.cyclesPerSecond, this.sampleRate);
  }

  /**
   * Queue transitions drained from the speaker.
   *
   * @returns the number of edges accepted.
   * @throws RangeError if a cycle stamp is not finite or moves backwards; the
   *   speaker never emits either, so one means the caller mixed two streams.
   */
  push(input: EdgeInput): number {
    const edges = normaliseEdges(input);
    for (const edge of edges) {
      if (!Number.isFinite(edge.cycle)) {
        throw new RangeError(`cycle must be finite: ${edge.cycle}`);
      }
      if (edge.cycle < this._lastCycle) {
        throw new RangeError(`cycle moved backwards: ${edge.cycle} < ${this._lastCycle}`);
      }
      this._lastCycle = edge.cycle;
      this._originCycle ??= edge.cycle;
      const sample = this.cycleToSample(edge.cycle);
      this._queue.push({ sample, level: edge.level });
      this._latestSample = sample;
    }
    this.trim();
    return edges.length;
  }

  /**
   * Take the next `frames` samples' worth of transitions and advance the playhead.
   *
   * Edge positions come back relative to the block start. Any edge left of the
   * playhead - only possible after {@link maxEdges} dropped something - is
   * applied to the held level rather than reported, so the waveform stays
   * continuous instead of inverting.
   */
  take(frames: number): EdgeBlock {
    if (!Number.isInteger(frames) || frames < 0) {
      throw new RangeError(`frames must be a non-negative integer: ${frames}`);
    }
    const start = this._playhead;
    const end = start + frames;
    const edges: SampledEdge[] = [];

    while (this._head < this._queue.length) {
      const edge = this._queue[this._head];
      if (edge.sample >= end) {
        break;
      }
      this._head += 1;
      if (edge.sample >= start) {
        edges.push({ sample: edge.sample - start, level: edge.level });
      } else {
        this._level = edge.level;
      }
    }

    const startLevel = this._level;
    if (edges.length > 0) {
      this._level = edges[edges.length - 1].level;
    }
    this._playhead = end;
    this.compact();
    return { startLevel, edges, frames };
  }

  /**
   * Every queued transition, positions relative to the playhead, without
   * consuming. For inspection and for the headless reconstruction path.
   */
  peekAll(): SampledEdge[] {
    const out: SampledEdge[] = [];
    for (let i = this._head; i < this._queue.length; i += 1) {
      const edge = this._queue[i];
      out.push({ sample: edge.sample - this._playhead, level: edge.level });
    }
    return out;
  }

  /** Discard queued transitions and rewind the timeline, leaving the held level. */
  clear(): void {
    this._queue = [];
    this._head = 0;
    this._playhead = 0;
    this._latestSample = 0;
    this._originCycle = null;
    this._lastCycle = Number.NEGATIVE_INFINITY;
  }

  /** Power-off: nothing queued, pin at rest, drop accounting rewound. */
  reset(): void {
    this.clear();
    this._level = SPEAKER_REST_LEVEL;
    this._dropped = 0;
  }

  /** Drop the oldest transitions once the queue exceeds its retention limit. */
  private trim(): void {
    const excess = this._queue.length - this._head - this.maxEdges;
    if (excess <= 0) {
      return;
    }
    for (let i = 0; i < excess; i += 1) {
      this._level = this._queue[this._head + i].level;
    }
    this._head += excess;
    this._dropped += excess;
    this.compact();
  }

  /** Reclaim the consumed prefix once it dominates the queue. */
  private compact(): void {
    if (this._head > 1024 && this._head * 2 > this._queue.length) {
      this._queue = this._queue.slice(this._head);
      this._head = 0;
    }
  }
}
