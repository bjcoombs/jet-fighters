// The Web Audio end of the speaker: the only file in src/machine/audio/ that
// is allowed to know a browser exists.
//
// Everything upstream is pure. `edge-buffer.ts` places the D14 transitions on a
// sample timeline, `square-synth.ts` band-limits them back into a waveform, and
// `spectrum.ts` reads the result - none of them import an audio API, which is
// what lets acceptance criterion V5 reconstruct and FFT the same waveform in
// plain Node. This module adds the transport and nothing else: it drains the
// board, renders through the same `SquareSynth` the headless path uses, and
// hands the samples to whichever output the browser offers.
//
// Two transports, one render path:
//
// - `AudioWorkletNode`, preferred. The processor is a dumb ring buffer that
//   asks for more samples as it drains; synthesis stays on the main thread,
//   next to the emulator that produces the edges. The processor source is
//   built here as a string and registered from a blob URL, so there is no
//   second module to keep in step and no build-tool asset wiring.
// - `ScriptProcessorNode`, the fallback for contexts without worklet support.
//   Deprecated but universally present, and its callback already runs on the
//   main thread, so it calls the same `render()` directly.
//
// Both paths go through `render()`, so what the browser plays is byte for byte
// what the spectral tests assert against.
//
// There is no event API and no effect library. Sound exists only because the
// ROM toggled the pin; if it does not, `render()` emits the held level, which
// is silence.

import { EdgeBuffer, DEFAULT_LATENCY_MS, normaliseEdges, type EdgeInput } from './edge-buffer.js';
import { SquareSynth, DEFAULT_AMPLITUDE } from './square-synth.js';

/** Name the worklet processor registers itself under. */
export const SPEAKER_PROCESSOR_NAME = 'jet-fighters-speaker';

/**
 * Frames rendered per pass.
 *
 * 128 is the Web Audio render quantum, so the worklet consumes whole blocks and
 * the fallback's smallest legal buffer is a multiple of it.
 */
export const DEFAULT_BLOCK_FRAMES = 128;

/**
 * `ScriptProcessorNode` buffer size.
 *
 * 1024 frames is 21 ms at 48 kHz - inside the 20-50 ms latency target, and the
 * smallest size that survives a busy main thread on the fallback path.
 */
export const DEFAULT_FALLBACK_BUFFER_FRAMES = 1024;

/**
 * Milliseconds a mute or volume change is ramped over.
 *
 * A gain step lands mid-waveform and clicks. 15 ms is short enough to feel
 * instant and long enough that the step is inaudible.
 */
export const DEFAULT_FADE_MS = 15;

/** What the driver is currently using to reach the speaker. */
export type SpeakerDriverMode = 'idle' | 'worklet' | 'fallback';

/**
 * The board, as far as this module is concerned.
 *
 * Only the drain. The driver never reads machine state, never advances the
 * machine, and has no way to make a sound the ROM did not.
 */
export interface SpeakerEdgeSource {
  takeSpeakerEdges(): EdgeInput;
}

// The structural slice of Web Audio this module uses. Declared rather than
// imported from lib.dom so the driver can be exercised against a small fake:
// a test that needed a real AudioContext would need a browser, and none of
// this is worth a headless Chrome in CI.

/** An `AudioParam` - the automation methods used for the gain ramp. */
export interface AudioParamLike {
  value: number;
  cancelScheduledValues(startTime: number): void;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
}

/** An `AudioNode` - connect and disconnect only. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

/** A `GainNode`. */
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/** A `MessagePort`, as the worklet transport uses it. */
export interface MessagePortLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** An `AudioWorkletNode`. */
export interface AudioWorkletNodeLike extends AudioNodeLike {
  readonly port: MessagePortLike;
}

/** The output side of an `AudioProcessingEvent`. */
export interface AudioProcessEventLike {
  readonly outputBuffer: {
    readonly length: number;
    readonly numberOfChannels: number;
    getChannelData(channel: number): Float32Array;
  };
}

/** A `ScriptProcessorNode`. */
export interface ScriptProcessorNodeLike extends AudioNodeLike {
  onaudioprocess: ((event: AudioProcessEventLike) => void) | null;
}

/** The `AudioWorkletNode` constructor, injected so a fake can stand in. */
export type AudioWorkletNodeCtor = new (
  context: AudioContextLike,
  name: string,
  options?: { processorOptions?: Record<string, unknown> },
) => AudioWorkletNodeLike;

/** An `AudioContext` (or `BaseAudioContext`), structurally. */
export interface AudioContextLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly audioWorklet?: { addModule(moduleUrl: string): Promise<void> };
  createGain(): GainNodeLike;
  createScriptProcessor?(
    bufferSize: number,
    numberOfInputChannels: number,
    numberOfOutputChannels: number,
  ): ScriptProcessorNodeLike;
  resume?(): Promise<void>;
}

export interface SpeakerDriverOptions {
  /** The audio context to play through. */
  readonly context: AudioContextLike;
  /** Where edges come from - normally the `Board`. */
  readonly source: SpeakerEdgeSource;
  /** Machine cycles per second - `CPU.getCyclesPerSecond()`. */
  readonly cyclesPerSecond: number;
  /** Target buffer depth; defaults to {@link DEFAULT_LATENCY_MS}. */
  readonly latencyMs?: number;
  /** Peak sample value for a high pin; defaults to {@link DEFAULT_AMPLITUDE}. */
  readonly amplitude?: number;
  /** Frames per render pass; defaults to {@link DEFAULT_BLOCK_FRAMES}. */
  readonly blockFrames?: number;
  /** Fallback node buffer size; defaults to {@link DEFAULT_FALLBACK_BUFFER_FRAMES}. */
  readonly fallbackBufferFrames?: number;
  /** Gain when unmuted, 0 to 1; defaults to 1. */
  readonly volume?: number;
  /** Ramp length for mute and volume changes; defaults to {@link DEFAULT_FADE_MS}. */
  readonly fadeMs?: number;
  /** Start muted. Defaults to false. */
  readonly muted?: boolean;
  /** Force a transport instead of preferring the worklet. */
  readonly mode?: 'worklet' | 'fallback';
  /**
   * `AudioWorkletNode` constructor; defaults to the global one. Injected so the
   * worklet path is reachable without a browser.
   */
  readonly audioWorkletNodeCtor?: AudioWorkletNodeCtor;
  /** Blob URL factory; defaults to `URL.createObjectURL`. */
  readonly createModuleUrl?: (source: string) => string;
  /** Blob URL disposer; defaults to `URL.revokeObjectURL`. */
  readonly revokeModuleUrl?: (url: string) => void;
}

/** What the driver has done since it was constructed. */
export interface SpeakerDriverStats {
  /** Samples handed to the audio hardware. */
  readonly framesRendered: number;
  /** Edges drained from the source. */
  readonly edgesConsumed: number;
  /** Render passes that ran with no sound queued ahead of the playhead. */
  readonly underruns: number;
  /** Edges the buffer dropped because a caller stopped draining. */
  readonly dropped: number;
  /**
   * Times the edge timeline was re-anchored on the playhead.
   *
   * One at the start of every sound is normal - it is how the machine's clock
   * is introduced to the output's. A rising count during play means the
   * emulation is losing time against the audio hardware.
   */
  readonly realignments: number;
}

/**
 * Source of the worklet processor, as a module string.
 *
 * The processor is deliberately incapable of making a sound: it holds a queue
 * of already-rendered blocks, copies them out, and asks for more when the queue
 * runs shallow. Synthesis stays on the main thread with the emulator, so there
 * is exactly one implementation of the waveform and V5's headless FFT reads it.
 *
 * Written as a string rather than a sibling `.worklet.ts` because a worklet
 * module is loaded by URL into a separate global scope: a real import would
 * either be bundled twice or need build-tool-specific asset wiring, and both
 * risk the two copies drifting.
 */
export const SPEAKER_WORKLET_SOURCE = `
registerProcessor(${JSON.stringify(SPEAKER_PROCESSOR_NAME)}, class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.targetFrames = settings.targetFrames || 1440;
    this.blocks = [];
    this.offset = 0;
    this.depth = 0;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'samples') {
        const samples = message.samples;
        if (samples && samples.length) {
          this.blocks.push(samples);
          this.depth += samples.length;
        }
      } else if (message.type === 'flush') {
        this.blocks.length = 0;
        this.offset = 0;
        this.depth = 0;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel = output && output[0];
    if (!channel) return true;

    let written = 0;
    while (written < channel.length && this.blocks.length > 0) {
      const block = this.blocks[0];
      const take = Math.min(channel.length - written, block.length - this.offset);
      channel.set(block.subarray(this.offset, this.offset + take), written);
      written += take;
      this.offset += take;
      this.depth -= take;
      if (this.offset >= block.length) {
        this.blocks.shift();
        this.offset = 0;
      }
    }
    // Underrun holds silence rather than repeating the last block: a 1-bit
    // speaker that is not being toggled is not making a sound.
    for (let i = written; i < channel.length; i += 1) channel[i] = 0;
    for (let c = 1; c < output.length; c += 1) output[c].set(channel);

    if (this.depth < this.targetFrames) {
      this.port.postMessage({ type: 'pull', frames: this.targetFrames - this.depth });
    }
    return true;
  }
});
`;

/** True when this context can host an `AudioWorkletNode`. */
export function supportsWorklet(
  context: AudioContextLike,
  ctor: AudioWorkletNodeCtor | undefined,
): boolean {
  return typeof context.audioWorklet?.addModule === 'function' && typeof ctor === 'function';
}

/** The global `AudioWorkletNode`, or undefined outside a browser. */
function globalWorkletNodeCtor(): AudioWorkletNodeCtor | undefined {
  const ctor = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  return typeof ctor === 'function' ? (ctor as AudioWorkletNodeCtor) : undefined;
}

/**
 * The speaker, wired to Web Audio.
 *
 * Timing is entirely the machine's. Edges arrive stamped in CPU cycles and are
 * converted with `cycles / cyclesPerSecond` inside {@link EdgeBuffer}; the
 * driver adds a buffer of {@link SpeakerDriverOptions.latencyMs} to absorb the
 * jitter of a frame-driven emulation loop and holds no clock of its own. The
 * caller runs the machine; the output pulls samples.
 *
 * Mute is a gain ramp, never a teardown. Stopping and restarting the node would
 * lose the edges buffered across the gap and cost a context state change on
 * every toggle, so the graph keeps running silently and the ROM's timing stays
 * intact underneath it.
 */
export class SpeakerDriver {
  readonly context: AudioContextLike;
  readonly buffer: EdgeBuffer;
  readonly synth: SquareSynth;
  readonly blockFrames: number;
  readonly fallbackBufferFrames: number;
  readonly fadeMs: number;

  private readonly _source: SpeakerEdgeSource;
  private readonly _preferred?: 'worklet' | 'fallback';
  private readonly _workletNodeCtor?: AudioWorkletNodeCtor;
  private readonly _createModuleUrl: (source: string) => string;
  private readonly _revokeModuleUrl: (url: string) => void;

  private _mode: SpeakerDriverMode = 'idle';
  private _gain: GainNodeLike | null = null;
  private _worklet: AudioWorkletNodeLike | null = null;
  private _fallback: ScriptProcessorNodeLike | null = null;
  private _moduleUrl: string | null = null;
  private _starting: Promise<SpeakerDriverMode> | null = null;

  private _volume: number;
  private _muted: boolean;
  private _framesRendered = 0;
  private _edgesConsumed = 0;
  private _underruns = 0;
  private _realignments = 0;
  private _held = 0;

  constructor(options: SpeakerDriverOptions) {
    const { context, source, cyclesPerSecond } = options;
    this.context = context;
    this._source = source;
    this.buffer = new EdgeBuffer({
      cyclesPerSecond,
      sampleRate: context.sampleRate,
      latencyMs: options.latencyMs ?? DEFAULT_LATENCY_MS,
    });
    this.synth = new SquareSynth({ amplitude: options.amplitude ?? DEFAULT_AMPLITUDE });

    const blockFrames = options.blockFrames ?? DEFAULT_BLOCK_FRAMES;
    if (!Number.isInteger(blockFrames) || blockFrames <= 0) {
      throw new RangeError(`blockFrames must be a positive integer: ${blockFrames}`);
    }
    this.blockFrames = blockFrames;
    this.fallbackBufferFrames = options.fallbackBufferFrames ?? DEFAULT_FALLBACK_BUFFER_FRAMES;
    this.fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;

    const volume = options.volume ?? 1;
    if (!(volume >= 0 && volume <= 1)) {
      throw new RangeError(`volume must be between 0 and 1: ${volume}`);
    }
    this._volume = volume;
    this._muted = options.muted ?? false;

    this._preferred = options.mode;
    this._workletNodeCtor = options.audioWorkletNodeCtor ?? globalWorkletNodeCtor();
    this._createModuleUrl =
      options.createModuleUrl ??
      ((src) => URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    this._revokeModuleUrl = options.revokeModuleUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  /** Transport in use; `idle` until {@link start} resolves. */
  get mode(): SpeakerDriverMode {
    return this._mode;
  }

  /** True once a node is connected and pulling samples. */
  get running(): boolean {
    return this._mode !== 'idle';
  }

  /** True while the gain is ramped to zero. The graph keeps running regardless. */
  get muted(): boolean {
    return this._muted;
  }

  /** Gain applied when unmuted. */
  get volume(): number {
    return this._volume;
  }

  /** Samples the buffer holds ahead of the playhead. */
  get bufferedFrames(): number {
    return this.buffer.available;
  }

  /** Target buffer depth in samples. */
  get targetFrames(): number {
    return Math.ceil(this.buffer.latencySamples);
  }

  get stats(): SpeakerDriverStats {
    return {
      framesRendered: this._framesRendered,
      edgesConsumed: this._edgesConsumed,
      underruns: this._underruns,
      dropped: this.buffer.dropped,
      realignments: this._realignments,
    };
  }

  /**
   * Build the graph and start pulling samples.
   *
   * Prefers the worklet and falls back to `ScriptProcessorNode` if the context
   * has no worklet support or the module fails to load. Idempotent: concurrent
   * calls share the one in-flight start.
   */
  start(): Promise<SpeakerDriverMode> {
    if (this._mode !== 'idle') {
      return Promise.resolve(this._mode);
    }
    this._starting ??= this.open().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  /**
   * Disconnect the graph, leaving buffered edges and the pin level alone.
   *
   * Restarting resumes the waveform where it stopped rather than re-anchoring
   * the timeline, so a pause does not put a step into the output.
   */
  stop(): void {
    if (this._worklet) {
      this._worklet.port.onmessage = null;
      this._worklet.port.postMessage({ type: 'flush' });
      this._worklet.disconnect();
      this._worklet = null;
    }
    if (this._fallback) {
      this._fallback.onaudioprocess = null;
      this._fallback.disconnect();
      this._fallback = null;
    }
    if (this._gain) {
      this._gain.disconnect();
      this._gain = null;
    }
    if (this._moduleUrl) {
      this._revokeModuleUrl(this._moduleUrl);
      this._moduleUrl = null;
    }
    this._mode = 'idle';
  }

  /**
   * Drain the source into the edge buffer.
   *
   * Safe to call from anywhere at any rate - the render path calls it before
   * every block, and a caller running the machine on a frame timer may call it
   * as well to keep the queue shallow.
   *
   * @returns edges accepted.
   */
  pump(): number {
    const edges = normaliseEdges(this._source.takeSpeakerEdges());
    if (edges.length === 0) {
      return 0;
    }
    this.realign(edges[0].cycle);
    const accepted = this.buffer.push(edges);
    this._edgesConsumed += accepted;
    return accepted;
  }

  /**
   * Introduce the machine's clock to the output's, and keep them introduced.
   *
   * The two clocks start life unrelated. {@link EdgeBuffer} anchors sample zero
   * on the first edge it is ever handed, but the playhead has been advancing
   * since the graph was connected - including through every render pass that
   * ran before the ROM first touched the pin, which on a cold machine is the
   * best part of a second. An edge that arrives behind the playhead is in the
   * past: `take()` folds it into the held level rather than reporting it, and
   * because the offset never closes, so is every edge after it. The output sits
   * at the rest level forever, which is precisely what silence sounds like.
   *
   * So when the machine hands over sound the playhead has already gone past,
   * rewind the timeline onto the playhead and withhold a latency's worth of
   * frames while the buffer refills. Withholding is what builds the cushion:
   * the machine keeps producing during the hold, so play resumes with the ROM
   * running the buffer's depth ahead of the output and jitter has somewhere to
   * go. The hold is bounded, so a blip shorter than the cushion still plays.
   *
   * This is a resynchronisation, not a correction to the waveform. Nothing is
   * stretched or resampled - the edges keep their exact cycle spacing, and only
   * sound the output has already run past is dropped.
   */
  private realign(cycle: number): void {
    if (this.buffer.cycleToSample(cycle) >= this.buffer.playhead) {
      return;
    }
    this.buffer.clear();
    this._held = Math.ceil(this.buffer.latencySamples);
    this._realignments += 1;
  }

  /**
   * Render one block: drain, place on the sample timeline, band-limit, emit.
   *
   * The single render path. The worklet transport calls it on the main thread
   * when the processor asks for samples, the fallback calls it inside
   * `onaudioprocess`, and the spectral tests reach the same synthesis through
   * `renderSquare`.
   *
   * @param out optional destination of exactly `frames` samples, written in
   *   place to avoid an allocation per callback.
   */
  render(frames: number, out?: Float32Array): Float32Array {
    this.pump();
    if (this._held > 0) {
      // Holding the playhead still after a realign while the machine fills the
      // buffer. The pin is not moving during a hold, so the block is the level
      // it is sitting at - the synth is the authority on which.
      this._held -= frames;
      const samples = this.synth.render({ startLevel: this.buffer.level, edges: [], frames }, out);
      this._framesRendered += frames;
      return samples;
    }
    if (this.buffer.available <= 0) {
      this._underruns += 1;
    }
    const samples = this.synth.render(this.buffer.take(frames), out);
    this._framesRendered += frames;
    return samples;
  }

  /** Ramp to silence without stopping the node. */
  mute(): void {
    this.setMuted(true);
  }

  /** Ramp back to {@link volume}. */
  unmute(): void {
    this.setMuted(false);
  }

  /** Set the mute state, ramping the gain rather than stepping it. */
  setMuted(muted: boolean): void {
    this._muted = muted;
    this.applyGain();
  }

  /** Set the unmuted gain. Applied immediately unless muted. */
  setVolume(volume: number): void {
    if (!(volume >= 0 && volume <= 1)) {
      throw new RangeError(`volume must be between 0 and 1: ${volume}`);
    }
    this._volume = volume;
    this.applyGain();
  }

  /** Discard queued sound and return the synth to the pin's rest level. */
  reset(): void {
    this.buffer.reset();
    this.synth.reset();
    this._worklet?.port.postMessage({ type: 'flush' });
    this._framesRendered = 0;
    this._edgesConsumed = 0;
    this._underruns = 0;
    this._realignments = 0;
    this._held = 0;
  }

  /** Stop and release everything. The driver is not restartable afterwards. */
  dispose(): void {
    this.stop();
    this.buffer.reset();
    this.synth.reset();
  }

  /** Build the graph, preferring the worklet. */
  private async open(): Promise<SpeakerDriverMode> {
    // A context constructed before the user gesture starts suspended, and a
    // suspended context connects the graph and then never pulls a sample. A
    // rejection means the gesture has not happened yet: build the graph anyway
    // so no edges are lost, and let the caller start() again once it has.
    try {
      await this.context.resume?.();
    } catch {
      // Still suspended. Nothing is lost - the buffer holds the edges.
    }

    const gain = this.context.createGain();
    gain.gain.value = this._muted ? 0 : this._volume;
    gain.connect(this.context.destination);
    this._gain = gain;

    const forced = this._preferred === 'worklet';
    if (this._preferred !== 'fallback') {
      if (supportsWorklet(this.context, this._workletNodeCtor)) {
        try {
          await this.openWorklet(gain);
          this._mode = 'worklet';
          return this._mode;
        } catch (error) {
          // A blocked blob URL or a context that reports worklet support without
          // honouring it must not leave the machine silent - the fallback path is
          // deprecated, not broken.
          if (forced) {
            this.abandon(gain);
            throw error;
          }
        }
      } else if (forced) {
        // Asking for the worklet and silently getting the deprecated node back
        // is the one outcome a caller that forced the mode cannot detect.
        this.abandon(gain);
        throw new Error('AudioWorklet is not available in this context');
      }
    }

    try {
      this.openFallback(gain);
    } catch (error) {
      this.abandon(gain);
      throw error;
    }
    this._mode = 'fallback';
    return this._mode;
  }

  /** Tear down a half-built graph so a failed start leaves nothing connected. */
  private abandon(gain: GainNodeLike): void {
    if (this._worklet) {
      this._worklet.port.onmessage = null;
      this._worklet.disconnect();
      this._worklet = null;
    }
    gain.disconnect();
    this._gain = null;
    if (this._moduleUrl) {
      this._revokeModuleUrl(this._moduleUrl);
      this._moduleUrl = null;
    }
  }

  private async openWorklet(gain: GainNodeLike): Promise<void> {
    const Ctor = this._workletNodeCtor;
    const worklet = this.context.audioWorklet;
    if (!Ctor || !worklet) {
      throw new Error('AudioWorklet is not available in this context');
    }
    const url = this._createModuleUrl(SPEAKER_WORKLET_SOURCE);
    this._moduleUrl = url;
    await worklet.addModule(url);

    const node = new Ctor(this.context, SPEAKER_PROCESSOR_NAME, {
      processorOptions: { targetFrames: this.targetFrames },
    });
    node.port.onmessage = (event) => {
      const message = event.data as { type?: string; frames?: number } | null;
      if (message?.type === 'pull') {
        this.pushSamples(message.frames ?? this.blockFrames);
      }
    };
    node.connect(gain);
    this._worklet = node;

    // Prime the ring before the first process() call so the opening blip is not
    // clipped by an underrun on the very first quantum.
    this.pushSamples(this.targetFrames);
  }

  private openFallback(gain: GainNodeLike): void {
    if (typeof this.context.createScriptProcessor !== 'function') {
      throw new Error('AudioContext supports neither AudioWorklet nor ScriptProcessorNode');
    }
    const node = this.context.createScriptProcessor(this.fallbackBufferFrames, 0, 1);
    node.onaudioprocess = (event) => {
      const { outputBuffer } = event;
      const channel = outputBuffer.getChannelData(0);
      this.render(channel.length, channel);
      for (let c = 1; c < outputBuffer.numberOfChannels; c += 1) {
        outputBuffer.getChannelData(c).set(channel);
      }
    };
    node.connect(gain);
    this._fallback = node;
  }

  /** Render `frames` in `blockFrames` chunks and post them to the processor. */
  private pushSamples(frames: number): void {
    const port = this._worklet?.port;
    if (!port || frames <= 0) {
      return;
    }
    let remaining = Math.ceil(frames);
    while (remaining > 0) {
      const size = Math.min(this.blockFrames, remaining);
      const samples = this.render(size);
      port.postMessage({ type: 'samples', samples }, [samples.buffer]);
      remaining -= size;
    }
  }

  /** Ramp the gain to whatever mute and volume currently imply. */
  private applyGain(): void {
    const gain = this._gain;
    if (!gain) {
      return;
    }
    const target = this._muted ? 0 : this._volume;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + this.fadeMs / 1000);
  }
}
