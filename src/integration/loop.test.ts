import { describe, it, expect } from 'vitest';
import {
  drainAccumulator,
  LOGIC_TICKS_PER_SECOND,
  MAX_FRAME_MS,
  TICK_MS,
} from './loop.js';

describe('TICK_MS', () => {
  it('is the reciprocal of the logic tick rate', () => {
    expect(TICK_MS).toBeCloseTo(1000 / LOGIC_TICKS_PER_SECOND, 10);
  });
});

describe('drainAccumulator', () => {
  it('drains one whole tick and carries the sub-tick remainder', () => {
    const { ticks, accumulator } = drainAccumulator(0, 25, 10);
    expect(ticks).toBe(2);
    expect(accumulator).toBeCloseTo(5, 10);
  });

  it('adds the incoming frame to any banked accumulator', () => {
    const { ticks, accumulator } = drainAccumulator(7, 8, 10);
    expect(ticks).toBe(1);
    expect(accumulator).toBeCloseTo(5, 10);
  });

  it('returns zero ticks when not enough time has accumulated', () => {
    const { ticks, accumulator } = drainAccumulator(3, 4, 10);
    expect(ticks).toBe(0);
    expect(accumulator).toBeCloseTo(7, 10);
  });

  it('clamps a huge frame delta to avoid a catch-up spiral', () => {
    const { ticks, accumulator } = drainAccumulator(0, 100_000, 10, 250);
    expect(ticks).toBe(25); // 250ms / 10ms, not 10_000
    expect(accumulator).toBeCloseTo(0, 10);
  });

  it('treats a negative frame delta as zero elapsed time', () => {
    const { ticks, accumulator } = drainAccumulator(4, -50, 10);
    expect(ticks).toBe(0);
    expect(accumulator).toBe(4);
  });

  it('defaults to the real tick size and frame cap', () => {
    // A 1s frame is clamped to MAX_FRAME_MS (250ms); at 60 Hz that is 15 ticks.
    const { ticks } = drainAccumulator(0, 1000);
    expect(ticks).toBe(15);
    expect(MAX_FRAME_MS).toBe(250);
    expect(TICK_MS).toBeCloseTo(1000 / 60, 10);
  });

  it('rejects a non-positive tick size', () => {
    expect(() => drainAccumulator(0, 16, 0)).toThrow();
    expect(() => drainAccumulator(0, 16, -5)).toThrow();
  });
});
