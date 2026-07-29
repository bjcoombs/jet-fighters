import { describe, it, expect } from 'vitest';
import { R_SPEAKER } from '../cpu/tms1370/ports.js';
import { CYCLE_HZ } from '../cpu/tms1370/timing.js';
import { isFalling, isRising, Speaker, SPEAKER_PIN, SPEAKER_REST_LEVEL } from './speaker.js';

/**
 * Toggle the pin at a fixed half-period, as a ROM delay loop does.
 *
 * @returns the cycle after the last toggle.
 */
function square(speaker: Speaker, halfPeriod: number, toggles: number, from = 0): number {
  let cycle = from;
  let level = speaker.level;
  for (let i = 0; i < toggles; i += 1) {
    level = level ? 0 : 1;
    speaker.recordEdge(cycle, level);
    cycle += halfPeriod;
  }
  return cycle;
}

describe('Speaker - pin identity', () => {
  it('is R15, the speaker pin MAME reads off our own ROM mask', () => {
    expect(SPEAKER_PIN).toBe(R_SPEAKER);
    expect(SPEAKER_PIN).toBe(15);
  });

  it('rests low, as reset leaves the D pins', () => {
    expect(SPEAKER_REST_LEVEL).toBe(0);
    expect(new Speaker().level).toBe(0);
  });
});

describe('Speaker - recording edges', () => {
  it('starts with an empty buffer', () => {
    const speaker = new Speaker();
    expect(speaker.edgeCount).toBe(0);
    expect(speaker.edges).toEqual([]);
  });

  it('records a rising edge with its exact cycle', () => {
    const speaker = new Speaker();
    expect(speaker.recordEdge(1234, 1)).toBe(true);
    expect(speaker.edges).toEqual([{ cycle: 1234, level: 1 }]);
    expect(speaker.level).toBe(1);
  });

  it('records a falling edge', () => {
    const speaker = new Speaker();
    speaker.recordEdge(10, 1);
    speaker.recordEdge(20, 0);

    expect(speaker.edges[1]).toEqual({ cycle: 20, level: 0 });
    expect(speaker.level).toBe(0);
  });

  it('drops a write of the level the pin already holds', () => {
    const speaker = new Speaker();
    speaker.recordEdge(10, 1);
    expect(speaker.recordEdge(20, 1)).toBe(false);
    expect(speaker.edgeCount).toBe(1);
  });

  it('treats any non-zero value as high', () => {
    const speaker = new Speaker();
    speaker.recordEdge(0, 7);
    expect(speaker.level).toBe(1);
    expect(speaker.edges[0].level).toBe(1);
  });

  it('keeps edges in cycle order', () => {
    const speaker = new Speaker();
    square(speaker, 133, 6);
    const cycles = speaker.edges.map((edge) => edge.cycle);
    expect(cycles).toEqual([0, 133, 266, 399, 532, 665]);
  });

  it('rejects an edge timestamped before the previous one', () => {
    const speaker = new Speaker();
    speaker.recordEdge(100, 1);
    expect(() => speaker.recordEdge(99, 0)).toThrow(RangeError);
  });

  it('rejects a non-finite timestamp', () => {
    const speaker = new Speaker();
    expect(() => speaker.recordEdge(Number.NaN, 1)).toThrow(RangeError);
  });

  it('classifies edges by direction', () => {
    const speaker = new Speaker();
    square(speaker, 10, 2);
    expect(isRising(speaker.edges[0])).toBe(true);
    expect(isFalling(speaker.edges[0])).toBe(false);
    expect(isFalling(speaker.edges[1])).toBe(true);
  });
});

describe('Speaker - reconstruction fidelity', () => {
  it('preserves the toggle period exactly, so the pitch survives (contract V5)', () => {
    const speaker = new Speaker();
    // 1560 Hz is the centre of the measured missile-fire band (1480-1632 Hz,
    // docs/evidence/audio-reference.md). A half-period at the emulated cycle
    // rate is the number of cycles the ROM's delay loop must burn between
    // toggles.
    const targetHz = 1560;
    const halfPeriod = Math.round(CYCLE_HZ / (2 * targetHz));
    square(speaker, halfPeriod, 40);

    const gaps = speaker.edges.slice(1).map((edge, i) => edge.cycle - speaker.edges[i].cycle);
    expect(new Set(gaps).size).toBe(1);

    const reconstructedHz = CYCLE_HZ / (2 * gaps[0]);
    expect(reconstructedHz).toBeGreaterThan(1480);
    expect(reconstructedHz).toBeLessThan(1632);
  });

  it('records a burst bounded in time, so its duration is measurable', () => {
    // A hundred toggles of the missile-fire loop, starting a second into the
    // run. Both figures are derived: the half period is what the loop costs on
    // this machine, and the start is a second of emulated time rather than the
    // 200000 cycles that meant a second only at the v2 core's 400 kHz.
    const speaker = new Speaker();
    const halfPeriod = Math.round(CYCLE_HZ / (2 * 1560));
    const start = Math.round(CYCLE_HZ);
    const end = square(speaker, halfPeriod, 100, start);
    const first = speaker.edges[0].cycle;
    const last = speaker.edges[speaker.edgeCount - 1].cycle;

    expect(first).toBe(start);
    expect(last).toBe(end - halfPeriod);
    // Under the 150 ms the acceptance summary's missileFire row gives.
    expect((last - first) / CYCLE_HZ).toBeLessThan(0.15);
  });

  it('leaves silence as an absence of edges, not as zeroes', () => {
    const speaker = new Speaker();
    square(speaker, 100, 4);
    speaker.recordEdge(10_000, speaker.level);
    expect(speaker.edgeCount).toBe(4);
  });
});

describe('Speaker - consuming the buffer', () => {
  it('hands the buffer over and empties it', () => {
    const speaker = new Speaker();
    square(speaker, 50, 4);

    const taken = speaker.takeEdges();
    expect(taken).toHaveLength(4);
    expect(speaker.edgeCount).toBe(0);
  });

  it('leaves the pin level alone when the buffer is consumed', () => {
    const speaker = new Speaker();
    speaker.recordEdge(0, 1);
    speaker.takeEdges();

    expect(speaker.level).toBe(1);
    expect(speaker.recordEdge(10, 1)).toBe(false);
  });

  it('goes on timestamping from where it left off after a drain', () => {
    const speaker = new Speaker();
    square(speaker, 50, 4);
    speaker.takeEdges();
    speaker.recordEdge(1000, speaker.level ? 0 : 1);

    expect(speaker.edges[0].cycle).toBe(1000);
    expect(speaker.totalEdges).toBe(5);
  });

  it('emits [cycle, level] pairs for the probe', () => {
    const speaker = new Speaker();
    square(speaker, 10, 3);
    expect(speaker.toPairs()).toEqual([
      [0, 1],
      [10, 0],
      [20, 1],
    ]);
  });

  it('clears the buffer without touching the pin', () => {
    const speaker = new Speaker();
    square(speaker, 10, 3);
    speaker.clear();

    expect(speaker.edgeCount).toBe(0);
    expect(speaker.level).toBe(1);
    expect(speaker.totalEdges).toBe(3);
  });

  it('returns to rest on reset - the power switch', () => {
    const speaker = new Speaker();
    square(speaker, 10, 3);
    speaker.reset();

    expect(speaker.level).toBe(0);
    expect(speaker.edgeCount).toBe(0);
    expect(speaker.totalEdges).toBe(0);
    expect(() => speaker.recordEdge(0, 1)).not.toThrow();
  });
});
