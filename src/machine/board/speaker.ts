// D14 pin edge capture - the entire sound system of the machine.
//
// Sources: the sibling device MAME emulates (Gakken Heiankyo Alien, HD38800)
// wires a 1-bit speaker to pin D14, and Jet Fighter is modelled as its twin -
// docs/prd/jet-fighters-v2.md (Technical Context, R4, R6). The ROM makes sound
// by toggling that pin in timed delay loops; there is no tone generator, no
// envelope hardware, and no sound chip. If the program does not toggle the pin,
// the machine is silent.
//
// This module records transitions and nothing else. It does not synthesise, and
// it deliberately has no dependency on Web Audio: the audio layer (R6) converts
// this edge stream into a band-limited square reconstruction, and the headless
// spectral tests FFT the same stream in plain Node with no browser present.
//
// Pure state only: no DOM, no timers, no Web APIs. Nothing here has its own
// clock - every edge carries the exact machine cycle at which it happened.

import { D_SPEAKER } from '../cpu/ports.js';

/** The speaker pin: D14. */
export const SPEAKER_PIN = D_SPEAKER;

/**
 * Level the speaker pin rests at.
 *
 * Reset leaves every D pin an output holding 0 (ports.ts), so a machine that has
 * just powered on is quiet and its first edge is a rising one.
 */
export const SPEAKER_REST_LEVEL = 0;

/** One transition of the speaker pin. */
export interface SpeakerEdge {
  /** Machine cycle at which the pin changed. */
  readonly cycle: number;
  /** Level after the transition: 1 rising, 0 falling. */
  readonly level: 0 | 1;
}

/** `[cycle, level]` pairs - the wire format the machine probe emits (V5). */
export type SpeakerEdgePair = readonly [number, number];

/** True when this edge took the pin high. */
export function isRising(edge: SpeakerEdge): boolean {
  return edge.level === 1;
}

/** True when this edge took the pin low. */
export function isFalling(edge: SpeakerEdge): boolean {
  return edge.level === 0;
}

/**
 * The 1-bit speaker, as a buffer of cycle-timestamped transitions.
 *
 * Only transitions are recorded: writing the same level twice is not an edge and
 * produces nothing, so the buffer holds exactly the waveform's corner points and
 * a consumer can reconstruct the square wave by holding each level until the
 * next entry.
 *
 * Timestamps are exact machine cycles, never wall-clock times and never
 * interpolated. The board reads the cycle count from the CPU at the instant the
 * port callback fires, which is the cycle on which the writing instruction
 * began; the audio layer and the acceptance contract's FFT both depend on that
 * being an integer cycle count rather than an approximation.
 *
 * The buffer grows until consumed. `takeEdges()` hands ownership to the audio
 * layer and empties it, which is the intended cadence: drain once per rendered
 * audio block.
 */
export class Speaker {
  private _edges: SpeakerEdge[] = [];
  private _level: 0 | 1 = SPEAKER_REST_LEVEL;
  private _lastCycle = 0;
  private _totalEdges = 0;

  /** Current pin level. */
  get level(): 0 | 1 {
    return this._level;
  }

  /** Edges buffered and not yet consumed. */
  get edgeCount(): number {
    return this._edges.length;
  }

  /** Edges recorded since the last `reset()`, consumed or not. */
  get totalEdges(): number {
    return this._totalEdges;
  }

  /** Buffered edges, oldest first. The buffer itself is not exposed. */
  get edges(): readonly SpeakerEdge[] {
    return this._edges;
  }

  /**
   * Record the speaker pin at `level` as of `cycle`.
   *
   * @returns true when this was a transition. Writing the level the pin already
   *   holds is not an edge and is dropped, so the buffer never contains a
   *   zero-length pulse the real speaker could not have produced.
   */
  recordEdge(cycle: number, level: number): boolean {
    if (!Number.isFinite(cycle)) {
      throw new RangeError(`cycle must be finite: ${cycle}`);
    }
    if (cycle < this._lastCycle) {
      throw new RangeError(`cycle moved backwards: ${cycle} < ${this._lastCycle}`);
    }

    const next: 0 | 1 = level ? 1 : 0;
    this._lastCycle = cycle;
    if (next === this._level) {
      return false;
    }

    this._level = next;
    this._edges.push({ cycle, level: next });
    this._totalEdges += 1;
    return true;
  }

  /**
   * Hand the buffered edges to the audio layer and empty the buffer.
   *
   * The pin level is untouched: consuming what has been heard so far does not
   * change what the speaker is currently doing.
   */
  takeEdges(): SpeakerEdge[] {
    const edges = this._edges;
    this._edges = [];
    return edges;
  }

  /** Buffered edges as `[cycle, level]` pairs, the probe's wire format (V5). */
  toPairs(): SpeakerEdgePair[] {
    return this._edges.map((edge) => [edge.cycle, edge.level] as SpeakerEdgePair);
  }

  /** Discard buffered edges, leaving the pin where it is. */
  clear(): void {
    this._edges = [];
  }

  /** Power-off: buffer empty, pin at rest, cycle accounting rewound. */
  reset(): void {
    this._edges = [];
    this._level = SPEAKER_REST_LEVEL;
    this._lastCycle = 0;
    this._totalEdges = 0;
  }
}
