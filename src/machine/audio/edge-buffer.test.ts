import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../cpu/cpu.js';
import { Speaker, type SpeakerEdgePair } from '../board/speaker.js';
import {
  cyclesToSamples,
  cyclesToSeconds,
  DEFAULT_LATENCY_MS,
  EdgeBuffer,
  MAX_LATENCY_MS,
  MIN_LATENCY_MS,
  normaliseEdges,
} from './edge-buffer.js';

const SAMPLE_RATE = 48_000;

function buffer(overrides: Partial<{ latencyMs: number; maxEdges: number }> = {}): EdgeBuffer {
  return new EdgeBuffer({
    cyclesPerSecond: CYCLE_HZ,
    sampleRate: SAMPLE_RATE,
    ...overrides,
  });
}

/** Toggle the pin at a fixed half-period, as a ROM delay loop does. */
function togglePairs(halfPeriod: number, toggles: number, from = 0): SpeakerEdgePair[] {
  const speaker = new Speaker();
  let cycle = from;
  let level = speaker.level;
  for (let i = 0; i < toggles; i += 1) {
    level = level ? 0 : 1;
    speaker.recordEdge(cycle, level);
    cycle += halfPeriod;
  }
  return speaker.toPairs();
}

describe('cycle to time conversion', () => {
  it('divides cycles by the CPU clock rate', () => {
    expect(cyclesToSeconds(CYCLE_HZ, CYCLE_HZ)).toBe(1);
    expect(cyclesToSeconds(200_000, 400_000)).toBe(0.5);
    expect(cyclesToSeconds(0, CYCLE_HZ)).toBe(0);
  });

  it('scales seconds into samples', () => {
    expect(cyclesToSamples(CYCLE_HZ, CYCLE_HZ, SAMPLE_RATE)).toBe(SAMPLE_RATE);
    expect(cyclesToSamples(400, 400_000, 48_000)).toBeCloseTo(48, 10);
  });

  it('keeps sub-sample precision rather than rounding to a sample boundary', () => {
    // 400 kHz / 48 kHz is 8.333... cycles per sample, so most edges land between
    // samples. Rounding here would quantise every pitch to the sample grid.
    expect(cyclesToSamples(1, 400_000, 48_000)).toBeCloseTo(0.12, 10);
  });

  it('rejects a non-positive clock or sample rate', () => {
    expect(() => cyclesToSeconds(1, 0)).toThrow(RangeError);
    expect(() => cyclesToSamples(1, CYCLE_HZ, 0)).toThrow(RangeError);
  });
});

describe('normaliseEdges', () => {
  it('accepts the board struct form', () => {
    expect(normaliseEdges([{ cycle: 5, level: 1 }])).toEqual([{ cycle: 5, level: 1 }]);
  });

  it('accepts the [cycle, level] wire form the probe emits', () => {
    const pairs: SpeakerEdgePair[] = [
      [5, 1],
      [11, 0],
    ];
    expect(normaliseEdges(pairs)).toEqual([
      { cycle: 5, level: 1 },
      { cycle: 11, level: 0 },
    ]);
  });

  it('coerces any truthy level to 1', () => {
    expect(normaliseEdges([[5, 7] as SpeakerEdgePair])).toEqual([{ cycle: 5, level: 1 }]);
  });
});

describe('EdgeBuffer - construction', () => {
  it('defaults to a latency inside the 20-50 ms working range', () => {
    expect(DEFAULT_LATENCY_MS).toBeGreaterThanOrEqual(MIN_LATENCY_MS);
    expect(DEFAULT_LATENCY_MS).toBeLessThanOrEqual(MAX_LATENCY_MS);
    expect(buffer().latencyMs).toBe(DEFAULT_LATENCY_MS);
  });

  it('expresses its latency in samples', () => {
    expect(buffer({ latencyMs: 25 }).latencySamples).toBeCloseTo(1200, 10);
  });

  it('rejects a nonsensical clock, rate or latency', () => {
    expect(() => new EdgeBuffer({ cyclesPerSecond: 0, sampleRate: SAMPLE_RATE })).toThrow(
      RangeError,
    );
    expect(() => new EdgeBuffer({ cyclesPerSecond: CYCLE_HZ, sampleRate: -1 })).toThrow(RangeError);
    expect(
      () => new EdgeBuffer({ cyclesPerSecond: CYCLE_HZ, sampleRate: SAMPLE_RATE, latencyMs: -1 }),
    ).toThrow(RangeError);
  });

  it('starts empty, at the speaker rest level', () => {
    const buf = buffer();
    expect(buf.pending).toBe(0);
    expect(buf.level).toBe(0);
    expect(buf.playhead).toBe(0);
    expect(buf.primed).toBe(false);
  });
});

describe('EdgeBuffer - placing edges on the audio timeline', () => {
  it('anchors the timeline on the first edge, not on cycle zero', () => {
    // The ROM runs silently for a long while before it first touches the pin.
    // Carrying that silence as samples would mean a huge dead prefix.
    const buf = buffer();
    buf.push([[200_000, 1]] as SpeakerEdgePair[]);
    expect(buf.peekAll()[0].sample).toBe(0);
  });

  it('places later edges relative to the anchor', () => {
    const buf = buffer();
    buf.push([
      [200_000, 1],
      [200_000 + CYCLE_HZ, 0],
    ] as SpeakerEdgePair[]);
    expect(buf.peekAll()[1].sample).toBeCloseTo(SAMPLE_RATE, 6);
  });

  it('keeps the anchor across separate pushes so gaps survive', () => {
    const buf = buffer();
    buf.push([[0, 1]] as SpeakerEdgePair[]);
    buf.push([[CYCLE_HZ / 2, 0]] as SpeakerEdgePair[]);
    expect(buf.peekAll()[1].sample).toBeCloseTo(SAMPLE_RATE / 2, 6);
  });

  it('takes edges straight from the speaker buffer', () => {
    const speaker = new Speaker();
    speaker.recordEdge(0, 1);
    speaker.recordEdge(100, 0);
    const buf = buffer();
    expect(buf.push(speaker.takeEdges())).toBe(2);
    expect(buf.pending).toBe(2);
  });

  it('rejects a stream whose cycles move backwards', () => {
    const buf = buffer();
    buf.push([[100, 1]] as SpeakerEdgePair[]);
    expect(() => buf.push([[50, 0]] as SpeakerEdgePair[])).toThrow(RangeError);
  });

  it('rejects a non-finite cycle stamp', () => {
    expect(() => buffer().push([[Number.NaN, 1]] as SpeakerEdgePair[])).toThrow(RangeError);
  });
});

describe('EdgeBuffer - priming', () => {
  it('is unprimed until a full latency of sound is queued', () => {
    const buf = buffer({ latencyMs: 20 });
    // 20 ms of emulated time at 400 kHz is 8000 cycles.
    buf.push(togglePairs(1000, 5));
    expect(buf.primed).toBe(false);
    buf.push([
      [8000, 0],
      [9000, 1],
    ] as SpeakerEdgePair[]);
    expect(buf.primed).toBe(true);
  });

  it('reports the samples of sound queued ahead of the playhead', () => {
    const buf = buffer();
    buf.push([
      [0, 1],
      [CYCLE_HZ / 100, 0],
    ] as SpeakerEdgePair[]);
    expect(buf.available).toBeCloseTo(SAMPLE_RATE / 100, 6);
  });

  it('reports a negative reserve once the playhead has run past the sound', () => {
    const buf = buffer();
    buf.push([
      [0, 1],
      [400, 0],
    ] as SpeakerEdgePair[]);
    buf.take(1024);
    expect(buf.available).toBeLessThan(0);
  });
});

describe('EdgeBuffer - taking blocks', () => {
  it('reports the level held entering the block', () => {
    const buf = buffer();
    buf.push([[0, 1]] as SpeakerEdgePair[]);
    expect(buf.take(128).startLevel).toBe(0);
    expect(buf.take(128).startLevel).toBe(1);
  });

  it('returns edge positions relative to the block start', () => {
    const buf = buffer();
    // 4167 cycles is ~500 samples at 400 kHz / 48 kHz.
    buf.push([
      [0, 1],
      [5000, 0],
    ] as SpeakerEdgePair[]);
    const first = buf.take(128);
    expect(first.edges).toEqual([{ sample: 0, level: 1 }]);
    const second = buf.take(1024);
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0].sample).toBeCloseTo(600 - 128, 6);
  });

  it('leaves edges beyond the block queued', () => {
    const buf = buffer();
    buf.push(togglePairs(4000, 10));
    buf.take(64);
    expect(buf.pending).toBeGreaterThan(0);
  });

  it('advances the playhead even when no edge falls in the block', () => {
    // Silence on a 1-bit speaker is the pin holding still, not an absence of time.
    const buf = buffer();
    buf.push([[0, 1]] as SpeakerEdgePair[]);
    buf.take(128);
    const quiet = buf.take(256);
    expect(quiet.edges).toEqual([]);
    expect(quiet.startLevel).toBe(1);
    expect(buf.playhead).toBe(384);
  });

  it('carries the held level across blocks', () => {
    const buf = buffer();
    buf.push([
      [0, 1],
      [100_000, 0],
    ] as SpeakerEdgePair[]);
    buf.take(128);
    expect(buf.level).toBe(1);
    buf.take(96_000);
    expect(buf.level).toBe(0);
  });

  it('reports the block width it was asked for', () => {
    expect(buffer().take(128).frames).toBe(128);
  });

  it('rejects a fractional or negative block width', () => {
    expect(() => buffer().take(1.5)).toThrow(RangeError);
    expect(() => buffer().take(-1)).toThrow(RangeError);
  });

  it('emits every queued edge exactly once across successive blocks', () => {
    const buf = buffer();
    const pairs = togglePairs(400, 200);
    buf.push(pairs);
    let seen = 0;
    for (let i = 0; i < 100; i += 1) {
      seen += buf.take(128).edges.length;
    }
    expect(seen).toBe(pairs.length);
    expect(buf.pending).toBe(0);
  });
});

describe('EdgeBuffer - overflow', () => {
  it('drops the oldest edges past its retention limit and counts them', () => {
    const buf = buffer({ maxEdges: 16 });
    buf.push(togglePairs(400, 40));
    expect(buf.pending).toBe(16);
    expect(buf.dropped).toBe(24);
  });

  it('advances the held level through dropped edges so the wave does not invert', () => {
    const buf = buffer({ maxEdges: 3 });
    buf.push(togglePairs(400, 10));
    // Toggles 1-7 are dropped; the 7th took the pin high, so the level entering
    // the first block is high even though no edge survives to say so.
    expect(buf.dropped).toBe(7);
    expect(buf.take(1).startLevel).toBe(1);
  });
});

describe('EdgeBuffer - reset', () => {
  it('clear() empties the queue and rewinds the timeline', () => {
    const buf = buffer();
    buf.push(togglePairs(400, 8));
    buf.take(64);
    buf.clear();
    expect(buf.pending).toBe(0);
    expect(buf.playhead).toBe(0);
    expect(buf.available).toBe(0);
  });

  it('clear() re-anchors on the next edge pushed', () => {
    const buf = buffer();
    buf.push([[1_000_000, 1]] as SpeakerEdgePair[]);
    buf.clear();
    buf.push([[9_000_000, 0]] as SpeakerEdgePair[]);
    expect(buf.peekAll()[0].sample).toBe(0);
  });

  it('reset() returns the pin to its rest level', () => {
    const buf = buffer();
    buf.push([[0, 1]] as SpeakerEdgePair[]);
    buf.take(128);
    expect(buf.level).toBe(1);
    buf.reset();
    expect(buf.level).toBe(0);
    expect(buf.dropped).toBe(0);
  });
});
