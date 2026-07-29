import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { Speaker, type SpeakerEdgePair } from '../board/speaker.js';
import { EdgeBuffer } from './edge-buffer.js';
import {
  DEFAULT_AMPLITUDE,
  edgeSpanMs,
  levelToValue,
  polyBlepResidual,
  renderSquare,
  SquareSynth,
} from './square-synth.js';

const SAMPLE_RATE = 48_000;

/**
 * Edges for a square wave of `hz` lasting `ms`, as the ROM would make it: a
 * delay loop toggling D14 every half period.
 */
function toneEdges(hz: number, ms: number, fromCycle = 0): SpeakerEdgePair[] {
  const halfPeriod = CYCLE_HZ / (2 * hz);
  const toggles = Math.max(2, Math.round((ms / 1000) * CYCLE_HZ / halfPeriod));
  const speaker = new Speaker();
  let level: 0 | 1 = 0;
  for (let i = 0; i < toggles; i += 1) {
    level = level ? 0 : 1;
    speaker.recordEdge(Math.round(fromCycle + i * halfPeriod), level);
  }
  return speaker.toPairs();
}

describe('polyBlepResidual', () => {
  it('is zero at and beyond one sample either side', () => {
    expect(polyBlepResidual(-1)).toBe(0);
    expect(polyBlepResidual(1)).toBe(0);
    expect(polyBlepResidual(-2)).toBe(0);
    expect(polyBlepResidual(4)).toBe(0);
  });

  it('is continuous through the discontinuity, at the half-way point', () => {
    expect(polyBlepResidual(-1e-12)).toBeCloseTo(0.5, 9);
    expect(polyBlepResidual(0)).toBeCloseTo(-0.5, 12);
    // Naive step is 0 just before and 1 just after, so both sides land on 0.5.
    expect(0 + polyBlepResidual(-1e-12)).toBeCloseTo(1 + polyBlepResidual(0), 9);
  });

  it('is odd-symmetric about the discontinuity', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(polyBlepResidual(-x) + polyBlepResidual(x)).toBeCloseTo(0, 12);
    }
  });
});

describe('levelToValue', () => {
  it('maps high to plus amplitude and low to minus amplitude', () => {
    expect(levelToValue(1, 0.5)).toBe(0.5);
    expect(levelToValue(0, 0.5)).toBe(-0.5);
  });

  it('defaults to half scale, leaving headroom for the band-limited overshoot', () => {
    expect(DEFAULT_AMPLITUDE).toBe(0.5);
  });
});

describe('renderSquare - shape', () => {
  it('returns an empty buffer for a silent pin', () => {
    // If the ROM never toggles D14 there is nothing to render. There is no
    // event API that could produce sound instead.
    expect(renderSquare([], { cyclesPerSecond: CYCLE_HZ, sampleRate: SAMPLE_RATE }).length).toBe(0);
  });

  it('anchors on the first edge rather than machine reset', () => {
    const late = renderSquare(toneEdges(1000, 20, 2_000_000), {
      cyclesPerSecond: CYCLE_HZ,
      sampleRate: SAMPLE_RATE,
    });
    const early = renderSquare(toneEdges(1000, 20), {
      cyclesPerSecond: CYCLE_HZ,
      sampleRate: SAMPLE_RATE,
    });
    expect(late.length).toBe(early.length);
  });

  it('holds each level until the next transition', () => {
    const samples = renderSquare(
      [
        [0, 1],
        [4000, 0],
      ] as SpeakerEdgePair[],
      { cyclesPerSecond: 400_000, sampleRate: 48_000, tailSamples: 100 },
    );
    // 4000 cycles is 480 samples at 400 kHz / 48 kHz.
    expect(samples[200]).toBeCloseTo(DEFAULT_AMPLITUDE, 5);
    expect(samples[500]).toBeCloseTo(-DEFAULT_AMPLITUDE, 5);
  });

  it('starts from the speaker rest level, and honours an explicit one', () => {
    const opts = { cyclesPerSecond: 400_000, sampleRate: 48_000, lengthSamples: 600 };
    const pairs = [
      [0, 1],
      [4000, 0],
    ] as SpeakerEdgePair[];

    // Resting low, the leading edge is a real rise, so sample 0 sits mid-step.
    const fromRest = renderSquare(pairs, opts);
    expect(fromRest[0]).toBeCloseTo(0, 5);
    expect(fromRest[240]).toBeCloseTo(DEFAULT_AMPLITUDE, 5);

    // Declaring the pin already high makes it a no-op instead.
    const alreadyHigh = renderSquare(pairs, { ...opts, startLevel: 1 });
    expect(alreadyHigh[0]).toBeCloseTo(DEFAULT_AMPLITUDE, 5);
  });

  it('honours an explicit length and tail', () => {
    const opts = { cyclesPerSecond: CYCLE_HZ, sampleRate: SAMPLE_RATE };
    expect(renderSquare(toneEdges(1000, 10), { ...opts, lengthSamples: 777 }).length).toBe(777);
    const span = renderSquare(toneEdges(1000, 10), opts).length;
    expect(renderSquare(toneEdges(1000, 10), { ...opts, tailSamples: 64 }).length).toBe(span + 64);
  });

  it('rejects a fractional length', () => {
    expect(() =>
      renderSquare([], { cyclesPerSecond: CYCLE_HZ, sampleRate: SAMPLE_RATE, lengthSamples: 1.5 }),
    ).toThrow(RangeError);
  });

  it('scales with amplitude', () => {
    const samples = renderSquare(toneEdges(1000, 20), {
      cyclesPerSecond: CYCLE_HZ,
      sampleRate: SAMPLE_RATE,
      amplitude: 0.25,
    });
    const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.24);
    expect(peak).toBeLessThan(0.32);
  });

  it('keeps the band-limited overshoot inside full scale at the default amplitude', () => {
    const samples = renderSquare(toneEdges(1520, 50), {
      cyclesPerSecond: CYCLE_HZ,
      sampleRate: SAMPLE_RATE,
    });
    const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeLessThan(1);
  });
});

describe('renderSquare - band limiting', () => {
  it('places a transition at its fractional sample position, not the nearest sample', () => {
    // Two tones a fraction of a cycle apart must not render identically. A
    // synth that snapped edges to the sample grid would produce the same bytes.
    const opts = { cyclesPerSecond: 400_000, sampleRate: 48_000, lengthSamples: 64 };
    const a = renderSquare([[0, 1], [50, 0]] as SpeakerEdgePair[], opts);
    const b = renderSquare([[0, 1], [54, 0]] as SpeakerEdgePair[], opts);
    // 50 and 54 cycles are 6.0 and 6.48 samples - the same sample index.
    expect(Math.floor(50 / (400_000 / 48_000))).toBe(Math.floor(54 / (400_000 / 48_000)));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('smooths the step across the two samples straddling it', () => {
    // 96 kHz cycles against a 48 kHz rate is exactly 2 cycles per sample, so
    // cycle 4 lands on sample 2.0 and cycle 5 lands on sample 2.5.
    const opts = {
      cyclesPerSecond: 96_000,
      sampleRate: 48_000,
      lengthSamples: 8,
      amplitude: 1,
    };

    const onGrid = renderSquare([[0, 1], [4, 0]] as SpeakerEdgePair[], opts);
    expect(onGrid[1]).toBeCloseTo(1, 5);
    expect(onGrid[2]).toBeCloseTo(0, 5);
    expect(onGrid[3]).toBeCloseTo(-1, 5);

    // Half a sample later the step splits symmetrically over both samples
    // instead of snapping to one of them.
    const offGrid = renderSquare([[0, 1], [5, 0]] as SpeakerEdgePair[], opts);
    expect(offGrid[2]).toBeCloseTo(0.75, 5);
    expect(offGrid[3]).toBeCloseTo(-0.75, 5);
    expect(offGrid[2] + offGrid[3]).toBeCloseTo(0, 5);
  });
});

describe('edgeSpanMs', () => {
  it('measures first transition to last in emulated milliseconds', () => {
    expect(edgeSpanMs([[0, 1], [400_000, 0]] as SpeakerEdgePair[], 400_000)).toBeCloseTo(1000, 6);
  });

  it('is zero for a stream too short to span anything', () => {
    expect(edgeSpanMs([], CYCLE_HZ)).toBe(0);
    expect(edgeSpanMs([[10, 1]] as SpeakerEdgePair[], CYCLE_HZ)).toBe(0);
  });
});

describe('SquareSynth - block rendering', () => {
  it('starts at the speaker rest level', () => {
    expect(new SquareSynth().level).toBe(0);
    expect(new SquareSynth().carry).toBe(0);
  });

  it('renders a block of the requested width', () => {
    const synth = new SquareSynth();
    const out = synth.render({ startLevel: 0, edges: [], frames: 128 });
    expect(out.length).toBe(128);
    expect(out[0]).toBeCloseTo(-DEFAULT_AMPLITUDE, 5);
  });

  it('reuses a caller-supplied buffer of the right size', () => {
    const synth = new SquareSynth();
    const scratch = new Float32Array(128);
    expect(synth.render({ startLevel: 0, edges: [], frames: 128 }, scratch)).toBe(scratch);
  });

  it('allocates when the supplied buffer is the wrong size', () => {
    const synth = new SquareSynth();
    const scratch = new Float32Array(64);
    expect(synth.render({ startLevel: 0, edges: [], frames: 128 }, scratch)).not.toBe(scratch);
  });

  it('carries the held level across blocks', () => {
    const synth = new SquareSynth();
    synth.render({ startLevel: 0, edges: [{ sample: 10, level: 1 }], frames: 32 });
    expect(synth.level).toBe(1);
    const next = synth.render({ startLevel: 1, edges: [], frames: 32 });
    expect(next[16]).toBeCloseTo(DEFAULT_AMPLITUDE, 5);
  });

  it('trusts its own held level over the block, so a dropped block cannot invert the wave', () => {
    const synth = new SquareSynth();
    synth.render({ startLevel: 0, edges: [{ sample: 1, level: 1 }], frames: 8 });
    const lying = synth.render({ startLevel: 0, edges: [], frames: 8 });
    expect(lying[4]).toBeCloseTo(DEFAULT_AMPLITUDE, 5);
  });

  it('owes the next block the residual of a transition in its last sample', () => {
    const synth = new SquareSynth();
    synth.render({ startLevel: 0, edges: [{ sample: 7.5, level: 1 }], frames: 8 });
    expect(synth.carry).not.toBe(0);
    const next = synth.render({ startLevel: 1, edges: [], frames: 8 });
    expect(next[0]).not.toBeCloseTo(DEFAULT_AMPLITUDE, 6);
    expect(synth.carry).toBe(0);
  });

  it('reset() returns to rest with nothing owed', () => {
    const synth = new SquareSynth();
    synth.render({ startLevel: 0, edges: [{ sample: 7.5, level: 1 }], frames: 8 });
    synth.reset();
    expect(synth.level).toBe(0);
    expect(synth.carry).toBe(0);
  });

  it('matches the whole-stream render when fed the same edges block by block', () => {
    // The real-time path and the headless V5 path must agree, or the spectral
    // guarantee proves nothing about what the browser plays.
    const edges = toneEdges(1520, 30);
    const whole = renderSquare(edges, {
      cyclesPerSecond: CYCLE_HZ,
      sampleRate: SAMPLE_RATE,
      tailSamples: 128,
    });

    const buffer = new EdgeBuffer({ cyclesPerSecond: CYCLE_HZ, sampleRate: SAMPLE_RATE });
    buffer.push(edges);
    const synth = new SquareSynth();
    const blocked = new Float32Array(whole.length);
    for (let i = 0; i < whole.length; i += 128) {
      const frames = Math.min(128, whole.length - i);
      blocked.set(synth.render(buffer.take(frames)), i);
    }

    for (let i = 0; i < whole.length; i += 1) {
      expect(blocked[i]).toBeCloseTo(whole[i], 5);
    }
  });
});
