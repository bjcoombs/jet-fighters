import { describe, it, expect, beforeEach } from 'vitest';
import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { Speaker, type SpeakerEdgePair } from '../board/speaker.js';
import { DEFAULT_LATENCY_MS, type EdgeInput } from './edge-buffer.js';
import { DEFAULT_AMPLITUDE } from './square-synth.js';
import {
  DEFAULT_BLOCK_FRAMES,
  DEFAULT_FADE_MS,
  DEFAULT_FALLBACK_BUFFER_FRAMES,
  SPEAKER_PROCESSOR_NAME,
  SPEAKER_WORKLET_SOURCE,
  SpeakerDriver,
  supportsWorklet,
  type AudioNodeLike,
  type AudioProcessEventLike,
  type AudioParamLike,
  type AudioContextLike,
  type AudioWorkletNodeCtor,
  type AudioWorkletNodeLike,
  type GainNodeLike,
  type MessagePortLike,
  type ScriptProcessorNodeLike,
  type SpeakerDriverOptions,
  type SpeakerEdgeSource,
} from './driver.js';

const SAMPLE_RATE = 48_000;

// Fakes for the structural slice of Web Audio the driver declares. A real
// AudioContext would need a browser; none of what this file asserts is about
// the browser, it is about what the driver does with the edges.

class FakeNode implements AudioNodeLike {
  readonly connections: AudioNodeLike[] = [];
  disconnects = 0;

  connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnects += 1;
  }
}

interface ParamEvent {
  readonly type: 'cancel' | 'set' | 'ramp';
  readonly value?: number;
  readonly time: number;
}

class FakeParam implements AudioParamLike {
  value = 1;
  readonly events: ParamEvent[] = [];

  cancelScheduledValues(startTime: number): void {
    this.events.push({ type: 'cancel', time: startTime });
  }

  setValueAtTime(value: number, startTime: number): void {
    this.events.push({ type: 'set', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.events.push({ type: 'ramp', value, time: endTime });
    // Real automation walks the value over the ramp; landing on the target is
    // enough to assert where the gain ends up.
    this.value = value;
  }

  get ramps(): ParamEvent[] {
    return this.events.filter((event) => event.type === 'ramp');
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
}

class FakePort implements MessagePortLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly messages: unknown[] = [];
  readonly transfers: unknown[][] = [];

  postMessage(message: unknown, transfer?: unknown[]): void {
    this.messages.push(message);
    this.transfers.push(transfer ?? []);
  }

  /** Deliver a message to whoever is listening, as the processor would. */
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
}

class FakeWorkletNode extends FakeNode implements AudioWorkletNodeLike {
  static instances: FakeWorkletNode[] = [];

  readonly port = new FakePort();

  constructor(
    readonly context: AudioContextLike,
    readonly processorName: string,
    readonly options?: { processorOptions?: Record<string, unknown> },
  ) {
    super();
    FakeWorkletNode.instances.push(this);
  }
}

class FakeScriptProcessor extends FakeNode implements ScriptProcessorNodeLike {
  onaudioprocess: ((event: AudioProcessEventLike) => void) | null = null;

  constructor(
    readonly bufferSize: number,
    readonly channelCount: number,
  ) {
    super();
  }

  /** Run one audio callback and return the channels the driver filled. */
  process(): Float32Array[] {
    const buffer = new FakeOutputBuffer(this.bufferSize, this.channelCount);
    this.onaudioprocess?.({ outputBuffer: buffer });
    return buffer.channels;
  }
}

class FakeOutputBuffer {
  readonly channels: Float32Array[];

  constructor(
    readonly length: number,
    readonly numberOfChannels: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

interface FakeContextOptions {
  readonly sampleRate?: number;
  /** Advertise `audioWorklet`. Defaults to true. */
  readonly worklet?: boolean;
  /** Advertise `createScriptProcessor`. Defaults to true. */
  readonly scriptProcessor?: boolean;
  /** Advertise `resume`. Defaults to true. */
  readonly resume?: boolean;
  /** Make `resume()` reject, as a context still awaiting a user gesture does. */
  readonly resumeRejects?: boolean;
  /** Make `addModule()` reject, as a blocked blob URL does. */
  readonly addModuleRejects?: boolean;
}

class FakeContext implements AudioContextLike {
  readonly sampleRate: number;
  currentTime = 0;
  readonly destination = new FakeNode();
  readonly audioWorklet?: { addModule(moduleUrl: string): Promise<void> };
  createScriptProcessor?: (
    bufferSize: number,
    numberOfInputChannels: number,
    numberOfOutputChannels: number,
  ) => ScriptProcessorNodeLike;
  resume?: () => Promise<void>;

  readonly gains: FakeGain[] = [];
  readonly modules: string[] = [];
  readonly processors: FakeScriptProcessor[] = [];
  resumes = 0;

  constructor(options: FakeContextOptions = {}) {
    this.sampleRate = options.sampleRate ?? SAMPLE_RATE;

    if (options.worklet !== false) {
      this.audioWorklet = {
        addModule: (moduleUrl: string) => {
          this.modules.push(moduleUrl);
          return options.addModuleRejects
            ? Promise.reject(new Error('blocked by CSP'))
            : Promise.resolve();
        },
      };
    }

    if (options.scriptProcessor !== false) {
      this.createScriptProcessor = (bufferSize, _inputs, outputs) => {
        const node = new FakeScriptProcessor(bufferSize, outputs);
        this.processors.push(node);
        return node;
      };
    }

    if (options.resume !== false) {
      this.resume = () => {
        this.resumes += 1;
        return options.resumeRejects
          ? Promise.reject(new Error('not allowed to start'))
          : Promise.resolve();
      };
    }
  }

  createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

/** The board, reduced to the one method the driver is allowed to call. */
class FakeSource implements SpeakerEdgeSource {
  readonly queue: SpeakerEdgePair[][] = [];
  takes = 0;

  takeSpeakerEdges(): EdgeInput {
    this.takes += 1;
    return this.queue.shift() ?? [];
  }

  push(edges: SpeakerEdgePair[]): void {
    this.queue.push(edges);
  }
}

interface Harness {
  readonly context: FakeContext;
  readonly source: FakeSource;
  readonly driver: SpeakerDriver;
  readonly created: string[];
  readonly revoked: string[];
}

function setup(
  overrides: Partial<SpeakerDriverOptions> = {},
  contextOptions: FakeContextOptions = {},
): Harness {
  const context = new FakeContext(contextOptions);
  const source = new FakeSource();
  const created: string[] = [];
  const revoked: string[] = [];
  const driver = new SpeakerDriver({
    context,
    source,
    cyclesPerSecond: CYCLE_HZ,
    audioWorkletNodeCtor: FakeWorkletNode as unknown as AudioWorkletNodeCtor,
    createModuleUrl: (moduleSource) => {
      created.push(moduleSource);
      return `blob:speaker-${created.length}`;
    },
    revokeModuleUrl: (url) => {
      revoked.push(url);
    },
    ...overrides,
  });
  return { context, source, driver, created, revoked };
}

/** The transitions of a `hz` square wave lasting `ms`, as a ROM delay loop makes it. */
function toneEdges(hz: number, ms: number, cyclesPerSecond = CYCLE_HZ): SpeakerEdgePair[] {
  const halfPeriod = cyclesPerSecond / (2 * hz);
  const toggles = Math.max(2, Math.round((ms / 1000) * cyclesPerSecond / halfPeriod));
  const speaker = new Speaker();
  let level: 0 | 1 = 0;
  for (let i = 0; i < toggles; i += 1) {
    level = level ? 0 : 1;
    speaker.recordEdge(Math.round(i * halfPeriod), level);
  }
  return speaker.toPairs();
}

interface SampleMessage {
  readonly type: 'samples';
  readonly samples: Float32Array;
}

function isSampleMessage(message: unknown): message is SampleMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'samples'
  );
}

function sampleBlocks(port: FakePort): Float32Array[] {
  return port.messages.filter(isSampleMessage).map((message) => message.samples);
}

function totalFrames(port: FakePort): number {
  return sampleBlocks(port).reduce((sum, block) => sum + block.length, 0);
}

function messageTypes(port: FakePort): string[] {
  return port.messages.map((message) =>
    typeof message === 'object' && message !== null
      ? String((message as { type?: unknown }).type)
      : String(message),
  );
}

beforeEach(() => {
  FakeWorkletNode.instances = [];
});

describe('supportsWorklet', () => {
  it('requires both a context that can add a module and a node constructor', () => {
    const context = new FakeContext();
    expect(supportsWorklet(context, FakeWorkletNode as unknown as AudioWorkletNodeCtor)).toBe(true);
    expect(supportsWorklet(context, undefined)).toBe(false);
    expect(
      supportsWorklet(
        new FakeContext({ worklet: false }),
        FakeWorkletNode as unknown as AudioWorkletNodeCtor,
      ),
    ).toBe(false);
  });
});

describe('SpeakerDriver - transport selection', () => {
  it('prefers the worklet when the context can host one', async () => {
    const { driver, context } = setup();
    await expect(driver.start()).resolves.toBe('worklet');

    expect(driver.mode).toBe('worklet');
    expect(driver.running).toBe(true);
    expect(context.modules).toEqual(['blob:speaker-1']);
    expect(context.processors).toHaveLength(0);

    const node = FakeWorkletNode.instances[0];
    expect(node.processorName).toBe(SPEAKER_PROCESSOR_NAME);
    expect(node.options?.processorOptions).toEqual({ targetFrames: driver.targetFrames });
    expect(node.connections).toEqual([context.gains[0]]);
    expect(context.gains[0].connections).toEqual([context.destination]);
  });

  it('builds the worklet module from the source in this file, not a build asset', async () => {
    const { driver, created } = setup();
    await driver.start();
    expect(created).toEqual([SPEAKER_WORKLET_SOURCE]);
  });

  it('falls back to a ScriptProcessorNode when the context has no worklet', async () => {
    const { driver, context } = setup({}, { worklet: false });
    await expect(driver.start()).resolves.toBe('fallback');

    expect(driver.mode).toBe('fallback');
    expect(FakeWorkletNode.instances).toHaveLength(0);
    expect(context.processors).toHaveLength(1);
    expect(context.processors[0].bufferSize).toBe(DEFAULT_FALLBACK_BUFFER_FRAMES);
    expect(context.processors[0].connections).toEqual([context.gains[0]]);
  });

  it('falls back when the worklet module fails to load', async () => {
    // A blocked blob URL must not leave the machine silent.
    const { driver, context } = setup({}, { addModuleRejects: true });
    await expect(driver.start()).resolves.toBe('fallback');
    expect(context.processors).toHaveLength(1);
  });

  it('honours a forced fallback even where the worklet is available', async () => {
    const { driver, context } = setup({ mode: 'fallback' });
    await expect(driver.start()).resolves.toBe('fallback');
    expect(context.modules).toEqual([]);
    expect(FakeWorkletNode.instances).toHaveLength(0);
  });

  it('rejects rather than silently downgrading when the worklet is forced and absent', async () => {
    // Forcing the mode and getting the deprecated node back anyway is the one
    // outcome the caller cannot detect afterwards.
    const { driver, context } = setup({ mode: 'worklet' }, { worklet: false });
    await expect(driver.start()).rejects.toThrow(/AudioWorklet is not available/);

    expect(driver.mode).toBe('idle');
    expect(context.processors).toHaveLength(0);
    expect(context.gains[0].disconnects).toBe(1);
  });

  it('rejects when the worklet is forced and its module fails to load', async () => {
    const { driver, context, revoked } = setup({ mode: 'worklet' }, { addModuleRejects: true });
    await expect(driver.start()).rejects.toThrow(/blocked by CSP/);

    expect(driver.mode).toBe('idle');
    expect(context.processors).toHaveLength(0);
    expect(context.gains[0].disconnects).toBe(1);
    expect(revoked).toEqual(['blob:speaker-1']);
  });

  it('throws and leaves nothing connected when the context offers neither transport', async () => {
    const { driver, context } = setup({}, { worklet: false, scriptProcessor: false });
    await expect(driver.start()).rejects.toThrow(/neither AudioWorklet nor ScriptProcessorNode/);

    expect(driver.mode).toBe('idle');
    expect(context.gains[0].disconnects).toBe(1);
  });

  it('shares one in-flight start between concurrent callers', async () => {
    const { driver, context } = setup();
    const [a, b] = await Promise.all([driver.start(), driver.start()]);
    expect(a).toBe('worklet');
    expect(b).toBe('worklet');
    expect(context.gains).toHaveLength(1);
    expect(FakeWorkletNode.instances).toHaveLength(1);
  });

  it('is a no-op once running', async () => {
    const { driver, context } = setup();
    await driver.start();
    await expect(driver.start()).resolves.toBe('worklet');
    expect(context.gains).toHaveLength(1);
  });

  it('resumes a suspended context before building the graph', async () => {
    const { driver, context } = setup();
    await driver.start();
    expect(context.resumes).toBe(1);
  });

  it('still builds the graph when resume is refused for want of a user gesture', async () => {
    const { driver, context } = setup({}, { resumeRejects: true });
    await expect(driver.start()).resolves.toBe('worklet');
    expect(context.resumes).toBe(1);
  });

  it('starts against a context with no resume at all', async () => {
    const { driver } = setup({}, { resume: false });
    await expect(driver.start()).resolves.toBe('worklet');
  });
});

describe('SpeakerDriver - cycle to sample conversion', () => {
  it('places an edge using the CPU clock rate, not a clock of its own', () => {
    // Ten milliseconds of emulated time is 480 samples at 48 kHz, whatever the
    // machine's cycle rate is - which is the property being asserted. The rate
    // is supplied rather than assumed, so it is stated here rather than taken
    // from the machine.
    const cyclesPerSecond = 400_000;
    const { driver, source } = setup({ cyclesPerSecond });
    source.push([
      [0, 1],
      [cyclesPerSecond / 100, 0],
    ]);

    const samples = driver.render(600);
    expect(samples[200]).toBeCloseTo(DEFAULT_AMPLITUDE, 5);
    expect(samples[500]).toBeCloseTo(-DEFAULT_AMPLITUDE, 5);
  });

  it('rescales the same edges when the clock rate changes', () => {
    const edges: SpeakerEdgePair[] = [
      [0, 1],
      [4000, 0],
    ];
    const fast = setup({ cyclesPerSecond: 800_000 });
    fast.source.push(edges);
    const samples = fast.driver.render(600);

    // Twice the clock rate halves the emulated time, so the fall lands at 240.
    expect(samples[200]).toBeCloseTo(DEFAULT_AMPLITUDE, 5);
    expect(samples[300]).toBeCloseTo(-DEFAULT_AMPLITUDE, 5);
  });

  it('reports the target buffer depth in samples from the latency setting', () => {
    const { driver } = setup();
    expect(driver.targetFrames).toBe((DEFAULT_LATENCY_MS / 1000) * SAMPLE_RATE);
    expect(setup({ latencyMs: 20 }).driver.targetFrames).toBe(960);
  });
});

describe('SpeakerDriver - rendering', () => {
  it('drains the source once per render pass and turns the edges into samples', () => {
    const { driver, source } = setup();
    source.push(toneEdges(1520, 30));

    const samples = driver.render(512);
    expect(source.takes).toBe(1);
    expect(driver.stats.edgesConsumed).toBeGreaterThan(0);
    expect(driver.stats.framesRendered).toBe(512);

    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.4);

    driver.render(512);
    expect(source.takes).toBe(2);
  });

  it('holds the level and counts an underrun when nothing is queued', () => {
    // Silence on a 1-bit speaker is the pin not moving, not a special case.
    const { driver, source } = setup();
    const samples = driver.render(DEFAULT_BLOCK_FRAMES);

    expect(source.takes).toBe(1);
    expect(driver.stats.underruns).toBe(1);
    expect(samples).toHaveLength(DEFAULT_BLOCK_FRAMES);
    for (const value of samples) {
      expect(value).toBe(-DEFAULT_AMPLITUDE);
    }
  });

  it('keeps rendering silence indefinitely without a source of edges', () => {
    const { driver } = setup();
    for (let i = 0; i < 32; i += 1) {
      const samples = driver.render(128);
      expect(samples.every(Number.isFinite)).toBe(true);
    }
    expect(driver.stats.underruns).toBe(32);
    expect(driver.stats.framesRendered).toBe(32 * 128);
  });

  it('writes into a caller-supplied buffer rather than allocating per callback', () => {
    const { driver } = setup();
    const scratch = new Float32Array(128);
    expect(driver.render(128, scratch)).toBe(scratch);
  });

  it('survives an overrun by dropping the oldest edges and staying continuous', () => {
    // A caller that stops draining must not grow the heap without bound. The
    // dropped edges are still applied to the held level, so the wave does not
    // invert.
    const { driver, source } = setup();
    const flood: SpeakerEdgePair[] = Array.from(
      { length: 70_000 },
      (_, i) => [i * 100, (i % 2 ? 1 : 0)] as SpeakerEdgePair,
    );
    source.push(flood);

    expect(driver.pump()).toBe(70_000);
    expect(driver.stats.edgesConsumed).toBe(70_000);
    expect(driver.stats.dropped).toBeGreaterThan(0);

    const samples = driver.render(256);
    expect(samples.every(Number.isFinite)).toBe(true);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('rejects a block size that is not a positive whole number of frames', () => {
    expect(() => setup({ blockFrames: 0 })).toThrow(RangeError);
    expect(() => setup({ blockFrames: 12.5 })).toThrow(RangeError);
  });
});

// The wiring between the machine's clock and the browser's, which is where the
// silent-speaker bug lived. Everything either side of it - the ROM's edges, the
// band-limited reconstruction - was correct and tested; what was not tested was
// that the two clocks ever meet. The output pulls samples from the moment the
// graph is connected, and a cold machine runs the best part of a second before
// the ROM first touches D14, so by the time an edge exists the playhead is tens
// of thousands of samples past where the edge timeline anchors it.
describe('SpeakerDriver - keeping the machine in step with the output', () => {
  /** Samples the output pulls before the ROM's first D14 edge, on a cold machine. */
  const SILENT_BLOCKS = 293; // 37,504 frames: 0.78 s at 48 kHz

  /** Peak-to-peak swing of a block. Zero is a pin that never moved. */
  function swing(samples: Float32Array): number {
    let min = Infinity;
    let max = -Infinity;
    for (const value of samples) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return max - min;
  }

  /** `toneEdges`, shifted to the cycle the machine actually reached. */
  function toneAt(cycle: number, hz: number, ms: number): SpeakerEdgePair[] {
    return toneEdges(hz, ms).map(([at, level]) => [at + cycle, level] as SpeakerEdgePair);
  }

  /**
   * The cycle the machine has reached when it first makes a sound.
   *
   * Roughly three quarters of a second of emulated time, derived rather than
   * written down: under v2 this was the literal 311893, which meant "0.78 s"
   * only at 400 kHz. Nothing here depends on the exact figure - it exists so
   * the first edge does not arrive at cycle 0, which is the case the
   * realignment logic has to handle.
   */
  const FIRST_SOUND_CYCLE = Math.round(0.78 * CYCLE_HZ);

  /** Render `blocks` blocks and return the loudest swing any of them had. */
  function play(driver: SpeakerDriver, blocks: number): number {
    let loudest = 0;
    for (let i = 0; i < blocks; i += 1) {
      loudest = Math.max(loudest, swing(driver.render(DEFAULT_BLOCK_FRAMES)));
    }
    return loudest;
  }

  it('plays a sound the ROM makes after the output has been running for a while', () => {
    const { driver, source } = setup();

    // The machine is powered but quiet: the output pulls, and the pin holds.
    expect(play(driver, SILENT_BLOCKS)).toBe(0);

    // The ROM finally toggles R15 - a blip shorter than the buffer's own depth,
    // so this also holds the cushion refill to something a blip can survive.
    source.push(toneAt(FIRST_SOUND_CYCLE, 1520, 20));

    expect(play(driver, 64)).toBeGreaterThan(DEFAULT_AMPLITUDE);
    expect(driver.stats.realignments).toBe(1);
  });

  it('re-anchors once and then stays anchored while the machine keeps playing', () => {
    // Guards the fix against degenerating into a re-anchor per frame, which
    // would drop a sliver of waveform 60 times a second and buzz.
    const { driver, source } = setup();
    play(driver, SILENT_BLOCKS);

    // The frame driver's cadence: one animation frame of edges, then one
    // animation frame of samples, for a second of continuous tone.
    const FRAME_MS = 16;
    const FRAME_CYCLES = (FRAME_MS / 1000) * CYCLE_HZ;
    const FRAME_BLOCKS = Math.round(((FRAME_MS / 1000) * SAMPLE_RATE) / DEFAULT_BLOCK_FRAMES);
    let loudest = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      source.push(toneAt(FIRST_SOUND_CYCLE + frame * FRAME_CYCLES, 1520, FRAME_MS));
      loudest = Math.max(loudest, play(driver, FRAME_BLOCKS));
    }

    expect(loudest).toBeGreaterThan(DEFAULT_AMPLITUDE);
    expect(driver.stats.realignments).toBe(1);
  });

  it('recovers when the emulation loses enough time to fall behind the output', () => {
    // A backgrounded tab, or a frame the machine could not afford to simulate:
    // main.ts drops the time rather than sprinting, so the ROM's cycle stamps
    // come back behind the playhead. The speaker has to find them again.
    const { driver, source } = setup();
    play(driver, SILENT_BLOCKS);
    source.push(toneAt(FIRST_SOUND_CYCLE, 1520, 20));
    play(driver, 64);
    expect(driver.stats.realignments).toBe(1);

    // Half a second of output with the machine stalled, then it resumes having
    // advanced only a fifth of a second: the cycle stamps come back well behind
    // the playhead, which is the condition under test.
    const STALL_SECONDS = 0.5;
    const ADVANCED_SECONDS = 0.2;
    play(driver, Math.round((STALL_SECONDS * SAMPLE_RATE) / DEFAULT_BLOCK_FRAMES));
    source.push(toneAt(FIRST_SOUND_CYCLE + Math.round(ADVANCED_SECONDS * CYCLE_HZ), 1520, 20));

    expect(play(driver, 64)).toBeGreaterThan(DEFAULT_AMPLITUDE);
    expect(driver.stats.realignments).toBe(2);
  });
});

describe('SpeakerDriver - worklet transport', () => {
  it('primes the ring in block-sized chunks before the first process call', async () => {
    const { driver } = setup();
    await driver.start();

    const port = FakeWorkletNode.instances[0].port;
    const blocks = sampleBlocks(port);
    expect(blocks.length).toBeGreaterThan(1);
    expect(Math.max(...blocks.map((block) => block.length))).toBe(DEFAULT_BLOCK_FRAMES);
    expect(totalFrames(port)).toBe(driver.targetFrames);
    expect(driver.stats.framesRendered).toBe(driver.targetFrames);
  });

  it('transfers each block rather than copying it', async () => {
    const { driver } = setup();
    await driver.start();
    const port = FakeWorkletNode.instances[0].port;
    expect(port.transfers[0]).toHaveLength(1);
  });

  it('renders more samples when the processor asks for them', async () => {
    const { driver, source } = setup();
    await driver.start();
    const port = FakeWorkletNode.instances[0].port;
    const before = totalFrames(port);

    source.push(toneEdges(1520, 30));
    port.emit({ type: 'pull', frames: 256 });

    expect(totalFrames(port) - before).toBe(256);
    expect(driver.stats.edgesConsumed).toBeGreaterThan(0);
  });

  it('ignores messages that are not a pull', async () => {
    const { driver } = setup();
    await driver.start();
    const port = FakeWorkletNode.instances[0].port;
    const before = totalFrames(port);

    port.emit(null);
    port.emit({ type: 'something-else' });
    expect(totalFrames(port)).toBe(before);
  });

  it('falls back to the block size when a pull names no frame count', async () => {
    const { driver } = setup();
    await driver.start();
    const port = FakeWorkletNode.instances[0].port;
    const before = totalFrames(port);

    port.emit({ type: 'pull' });
    expect(totalFrames(port) - before).toBe(DEFAULT_BLOCK_FRAMES);
  });
});

describe('SpeakerDriver - fallback transport', () => {
  it('fills the output channel from the edge stream inside the audio callback', async () => {
    const { driver, source, context } = setup({ fallbackBufferFrames: 512 }, { worklet: false });
    await driver.start();
    source.push(toneEdges(1520, 30));

    const [rendered] = context.processors[0].process();

    expect(source.takes).toBe(1);
    expect(rendered).toHaveLength(512);
    const peak = rendered.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.4);
    expect(driver.stats.framesRendered).toBe(512);
  });

  it('copies the mono waveform to every output channel', async () => {
    const context = new FakeContext({ worklet: false });
    const source = new FakeSource();
    const driver = new SpeakerDriver({ context, source, cyclesPerSecond: CYCLE_HZ });
    await driver.start();
    source.push(toneEdges(1520, 30));

    const processor = context.processors[0];
    // The driver asks for one channel; a context that hands back more must not
    // leave the extra ones empty.
    const buffer = new FakeOutputBuffer(processor.bufferSize, 2);
    processor.onaudioprocess?.({ outputBuffer: buffer });
    expect(Array.from(buffer.channels[1])).toEqual(Array.from(buffer.channels[0]));
  });
});

describe('SpeakerDriver - mute and volume', () => {
  it('ramps to silence without disconnecting the worklet', async () => {
    const { driver, context } = setup();
    await driver.start();
    const node = FakeWorkletNode.instances[0];
    const before = totalFrames(node.port);

    driver.mute();

    expect(driver.muted).toBe(true);
    expect(driver.mode).toBe('worklet');
    expect(node.disconnects).toBe(0);
    expect(context.gains[0].disconnects).toBe(0);
    expect(context.gains[0].gain.ramps.at(-1)?.value).toBe(0);

    // The transport keeps pulling: muting is a gain change, not a teardown, so
    // the ROM's timing underneath it is untouched.
    node.port.emit({ type: 'pull', frames: 128 });
    expect(totalFrames(node.port) - before).toBe(128);
  });

  it('ramps back to the configured volume on unmute', async () => {
    const { driver, context } = setup({ volume: 0.6 });
    await driver.start();

    driver.mute();
    driver.unmute();

    expect(driver.muted).toBe(false);
    expect(context.gains[0].gain.ramps.map((event) => event.value)).toEqual([0, 0.6]);
  });

  it('ramps over about 15 ms instead of stepping the gain', async () => {
    // A gain step lands mid-waveform and clicks.
    expect(DEFAULT_FADE_MS).toBe(15);
    const { driver, context } = setup();
    await driver.start();
    context.currentTime = 4;

    driver.mute();

    const events = context.gains[0].gain.events;
    expect(events.map((event) => event.type)).toEqual(['cancel', 'set', 'ramp']);
    expect(events[0].time).toBe(4);
    expect(events[1]).toEqual({ type: 'set', value: 1, time: 4 });
    expect(events[2].time).toBeCloseTo(4.015, 9);
  });

  it('honours a custom fade length', async () => {
    const { driver, context } = setup({ fadeMs: 40 });
    await driver.start();
    driver.mute();
    expect(context.gains[0].gain.events.at(-1)?.time).toBeCloseTo(0.04, 9);
  });

  it('anchors the ramp at the value the gain currently holds', async () => {
    const { driver, context } = setup();
    await driver.start();
    driver.mute();
    driver.unmute();

    // The second ramp starts from 0, where the first one left the gain, rather
    // than from the nominal volume.
    const sets = context.gains[0].gain.events.filter((event) => event.type === 'set');
    expect(sets.map((event) => event.value)).toEqual([1, 0]);
  });

  it('starts silent when constructed muted', async () => {
    const { driver, context } = setup({ muted: true, volume: 0.5 });
    await driver.start();
    expect(context.gains[0].gain.value).toBe(0);
  });

  it('applies the volume set before start once the graph exists', async () => {
    const { driver, context } = setup();
    driver.setVolume(0.25);
    expect(driver.volume).toBe(0.25);
    await driver.start();
    expect(context.gains[0].gain.value).toBe(0.25);
  });

  it('keeps a volume change silent while muted', async () => {
    const { driver, context } = setup({ muted: true });
    await driver.start();
    driver.setVolume(0.75);
    expect(driver.volume).toBe(0.75);
    expect(context.gains[0].gain.ramps.at(-1)?.value).toBe(0);
  });

  it('rejects a volume outside unity', () => {
    const { driver } = setup();
    expect(() => driver.setVolume(-0.1)).toThrow(RangeError);
    expect(() => driver.setVolume(1.5)).toThrow(RangeError);
    expect(() => setup({ volume: 2 })).toThrow(RangeError);
  });
});

describe('SpeakerDriver - stop, reset and dispose', () => {
  it('disconnects the graph, flushes the processor and revokes the module url', async () => {
    const { driver, context, revoked } = setup();
    await driver.start();
    const node = FakeWorkletNode.instances[0];

    driver.stop();

    expect(driver.mode).toBe('idle');
    expect(driver.running).toBe(false);
    expect(node.disconnects).toBe(1);
    expect(node.port.onmessage).toBeNull();
    expect(messageTypes(node.port).at(-1)).toBe('flush');
    expect(context.gains[0].disconnects).toBe(1);
    expect(revoked).toEqual(['blob:speaker-1']);
  });

  it('disconnects the fallback node and clears its callback', async () => {
    const { driver, context } = setup({}, { worklet: false });
    await driver.start();

    driver.stop();

    expect(context.processors[0].disconnects).toBe(1);
    expect(context.processors[0].onaudioprocess).toBeNull();
  });

  it('can be started again after a stop', async () => {
    const { driver, context } = setup();
    await driver.start();
    driver.stop();
    await expect(driver.start()).resolves.toBe('worklet');
    expect(context.gains).toHaveLength(2);
  });

  it('is inert when stopped twice', async () => {
    const { driver } = setup();
    await driver.start();
    driver.stop();
    expect(() => driver.stop()).not.toThrow();
  });

  it('reset() drops queued sound and rewinds the counters without stopping', async () => {
    const { driver, source } = setup();
    await driver.start();
    source.push(toneEdges(1520, 30));
    driver.render(128);
    expect(driver.stats.framesRendered).toBeGreaterThan(0);

    driver.reset();

    expect(driver.mode).toBe('worklet');
    expect(driver.bufferedFrames).toBe(0);
    expect(driver.stats).toEqual({
      framesRendered: 0,
      edgesConsumed: 0,
      underruns: 0,
      dropped: 0,
      realignments: 0,
    });
    expect(messageTypes(FakeWorkletNode.instances[0].port)).toContain('flush');
  });

  it('dispose() tears the graph down', async () => {
    const { driver, context } = setup();
    await driver.start();
    driver.dispose();
    expect(driver.mode).toBe('idle');
    expect(context.gains[0].disconnects).toBe(1);
  });
});

// The processor is loaded by URL into a separate global scope, so it ships as a
// string. Evaluating it here is the only way to hold it to anything.
describe('SPEAKER_WORKLET_SOURCE', () => {
  interface Processor {
    port: FakePort;
    process(inputs: unknown, outputs: Float32Array[][]): boolean;
  }
  type ProcessorCtor = new (options?: {
    processorOptions?: Record<string, unknown>;
  }) => Processor;

  class FakeAudioWorkletProcessor {
    readonly port = new FakePort();
  }

  function load(): { name: string; Ctor: ProcessorCtor } {
    let name = '';
    let Ctor: ProcessorCtor | null = null;
    const register = (registeredName: string, registeredCtor: ProcessorCtor): void => {
      name = registeredName;
      Ctor = registeredCtor;
    };
    const evaluate = new Function(
      'registerProcessor',
      'AudioWorkletProcessor',
      SPEAKER_WORKLET_SOURCE,
    ) as (register: unknown, base: unknown) => void;
    evaluate(register, FakeAudioWorkletProcessor);
    if (!Ctor) {
      throw new Error('processor did not register');
    }
    return { name, Ctor };
  }

  function outputs(frames: number, channels = 1): Float32Array[][] {
    return [Array.from({ length: channels }, () => new Float32Array(frames))];
  }

  it('registers under the name the driver constructs the node with', () => {
    expect(load().name).toBe(SPEAKER_PROCESSOR_NAME);
  });

  it('copies queued blocks into the output and asks for more', () => {
    const { Ctor } = load();
    const processor = new Ctor({ processorOptions: { targetFrames: 256 } });
    processor.port.emit({ type: 'samples', samples: Float32Array.from({ length: 4 }, () => 0.5) });

    const out = outputs(4);
    expect(processor.process([], out)).toBe(true);
    expect(Array.from(out[0][0])).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(processor.port.messages).toEqual([{ type: 'pull', frames: 256 }]);
  });

  it('spans block boundaries rather than dropping a partial block', () => {
    const { Ctor } = load();
    const processor = new Ctor({ processorOptions: { targetFrames: 0 } });
    processor.port.emit({ type: 'samples', samples: Float32Array.from([1, 2]) });
    processor.port.emit({ type: 'samples', samples: Float32Array.from([3, 4]) });

    const out = outputs(3);
    processor.process([], out);
    expect(Array.from(out[0][0])).toEqual([1, 2, 3]);

    const next = outputs(1);
    processor.process([], next);
    expect(Array.from(next[0][0])).toEqual([4]);
  });

  it('holds silence on an underrun rather than repeating the last block', () => {
    // A speaker nobody is toggling is not making a sound.
    const { Ctor } = load();
    const processor = new Ctor({ processorOptions: { targetFrames: 0 } });
    processor.port.emit({ type: 'samples', samples: Float32Array.from([0.5, 0.5]) });

    const out = outputs(4);
    processor.process([], out);
    expect(Array.from(out[0][0])).toEqual([0.5, 0.5, 0, 0]);
  });

  it('mirrors the mono waveform to every output channel', () => {
    const { Ctor } = load();
    const processor = new Ctor({ processorOptions: { targetFrames: 0 } });
    processor.port.emit({ type: 'samples', samples: Float32Array.from([0.5, -0.5]) });

    const out = outputs(2, 2);
    processor.process([], out);
    expect(Array.from(out[0][1])).toEqual([0.5, -0.5]);
  });

  it('discards everything queued on a flush', () => {
    const { Ctor } = load();
    const processor = new Ctor({ processorOptions: { targetFrames: 0 } });
    processor.port.emit({ type: 'samples', samples: Float32Array.from([0.5, 0.5]) });
    processor.port.emit({ type: 'flush' });

    const out = outputs(2);
    processor.process([], out);
    expect(Array.from(out[0][0])).toEqual([0, 0]);
  });
});
