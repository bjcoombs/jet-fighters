import { describe, it, expect } from 'vitest';
import { NO_GRID, PwmAccumulator, type PwmFrame } from './pwm.js';

/** A 10 x 20 accumulator - the machine's geometry, without importing display.ts. */
function accumulator(): PwmAccumulator {
  return new PwmAccumulator(10, 20);
}

/** Duty of one segment in a frame, or 0 when it never lit. */
function dutyOf(frame: PwmFrame, grid: number, plate: number): number {
  return frame.segments.find((s) => s.grid === grid && s.plate === plate)?.duty ?? 0;
}

/**
 * Strobe every grid in turn for `dwell` cycles with `plates` driven, the way the
 * ROM's master loop sweeps the tube.
 */
function sweep(pwm: PwmAccumulator, plates: number, dwell: number, from = 0): number {
  let cycle = from;
  for (let grid = 0; grid < 10; grid += 1) {
    pwm.recordGridPlate(grid, plates, cycle);
    cycle += dwell;
  }
  return cycle;
}

describe('PwmAccumulator - construction', () => {
  it('starts blank with nothing driven', () => {
    const pwm = accumulator();
    expect(pwm.gridMask).toBe(0);
    expect(pwm.plateMask).toBe(0);
    expect(pwm.frameStart).toBe(0);
    expect(pwm.getActiveCycles(0, 0)).toBe(0);
  });

  it('rejects a non-positive geometry', () => {
    expect(() => new PwmAccumulator(0, 20)).toThrow(RangeError);
    expect(() => new PwmAccumulator(10, -1)).toThrow(RangeError);
  });

  it('rejects a segment address outside the geometry', () => {
    const pwm = accumulator();
    expect(() => pwm.getActiveCycles(10, 0)).toThrow(RangeError);
    expect(() => pwm.getActiveCycles(0, 20)).toThrow(RangeError);
  });
});

describe('PwmAccumulator - duty over a frame', () => {
  it('credits a segment lit for the whole frame a duty of 1', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(3, 1 << 5, 0);
    const frame = pwm.endFrame(100);

    expect(frame.cycles).toBe(100);
    expect(dutyOf(frame, 3, 5)).toBe(1);
  });

  it('leaves an unlit segment out of the frame entirely', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(3, 1 << 5, 0);
    const frame = pwm.endFrame(100);

    expect(frame.segments).toHaveLength(1);
    expect(frame.segments[0]).toMatchObject({ grid: 3, plate: 5 });
  });

  it('gives every segment of a ten-grid sweep a duty of one tenth', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    const end = sweep(pwm, 0b111, 40);
    const frame = pwm.endFrame(end);

    expect(frame.cycles).toBe(400);
    expect(frame.segments).toHaveLength(30);
    for (const segment of frame.segments) {
      expect(segment.activeCycles).toBe(40);
      expect(segment.duty).toBeCloseTo(0.1, 12);
    }
  });

  it('yields a duty strictly between 0 and 1 for a strobed display (contract V3)', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    const end = sweep(pwm, 1 << 2, 40);
    const frame = pwm.endFrame(end);

    const fractional = frame.segments.filter((s) => s.duty > 0 && s.duty < 1);
    expect(fractional.length).toBeGreaterThan(0);
  });

  it('scales duty with dwell time - a half-lit grid is half as bright', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(0, 1 << 1, 0);
    pwm.recordGridPlate(NO_GRID, 0, 25);
    pwm.recordGridPlate(1, 1 << 1, 50);
    const frame = pwm.endFrame(100);

    expect(dutyOf(frame, 0, 1)).toBeCloseTo(0.25, 12);
    expect(dutyOf(frame, 1, 1)).toBeCloseTo(0.5, 12);
  });

  it('accumulates a segment lit in several separate intervals', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(4, 1, 0);
    pwm.recordGridPlate(NO_GRID, 0, 10);
    pwm.recordGridPlate(4, 1, 50);
    const frame = pwm.endFrame(70);

    expect(dutyOf(frame, 4, 0)).toBeCloseTo(30 / 70, 12);
  });

  it('credits every grid held high at once, not just the last one written', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordState(0b11, 1, 0);
    const frame = pwm.endFrame(50);

    expect(dutyOf(frame, 0, 0)).toBe(1);
    expect(dutyOf(frame, 1, 0)).toBe(1);
  });

  it('lights nothing while a grid is driven with no plates', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(2, 0, 0);
    expect(pwm.endFrame(100).segments).toHaveLength(0);
  });

  it('lights nothing while plates are driven with no grid', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordState(0, 0xfffff, 0);
    expect(pwm.endFrame(100).segments).toHaveLength(0);
  });

  it('reports a zero-length frame as duty 0 rather than dividing by zero', () => {
    const pwm = accumulator();
    pwm.startFrame(10);
    pwm.recordGridPlate(0, 1, 10);
    const frame = pwm.endFrame(10);

    expect(frame.cycles).toBe(0);
    expect(frame.segments).toHaveLength(0);
  });
});

describe('PwmAccumulator - frame boundaries', () => {
  it('opens the next frame where the last one closed', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(0, 1, 0);
    pwm.endFrame(100);
    expect(pwm.frameStart).toBe(100);
  });

  it('discards the previous frame accumulation', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(0, 1, 0);
    pwm.endFrame(100);
    expect(pwm.getActiveCycles(0, 0)).toBe(0);
  });

  it('carries the driven state across the boundary - the tube does not blank', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(6, 1 << 3, 0);
    pwm.endFrame(100);
    const next = pwm.endFrame(200);

    expect(dutyOf(next, 6, 3)).toBe(1);
  });

  it('samples mid-frame without disturbing accumulation', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(1, 1, 0);

    const mid = pwm.sample(50);
    expect(dutyOf(mid, 1, 0)).toBe(1);
    expect(mid.cycles).toBe(50);

    const frame = pwm.endFrame(100);
    expect(frame.cycles).toBe(100);
    expect(dutyOf(frame, 1, 0)).toBe(1);
  });

  it('reports time accrued since the last port write, not just at it', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(2, 1, 0);
    expect(pwm.sample(80).segments[0].activeCycles).toBe(80);
  });
});

describe('PwmAccumulator - clearing and guards', () => {
  it('blanks the tube and the accumulation on clear', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(0, 1, 0);
    pwm.clear(0);

    expect(pwm.gridMask).toBe(0);
    expect(pwm.plateMask).toBe(0);
    expect(pwm.sample(100).segments).toHaveLength(0);
  });

  it('accepts a rewound cycle count only through clear - the power switch path', () => {
    const pwm = accumulator();
    pwm.startFrame(0);
    pwm.recordGridPlate(0, 1, 500);
    pwm.clear(0);

    expect(pwm.frameStart).toBe(0);
    expect(() => pwm.recordGridPlate(0, 1, 10)).not.toThrow();
  });

  it('rejects a cycle count that moves backwards', () => {
    const pwm = accumulator();
    pwm.recordGridPlate(0, 1, 100);
    expect(() => pwm.recordGridPlate(0, 1, 99)).toThrow(RangeError);
  });

  it('rejects a non-finite cycle count', () => {
    const pwm = accumulator();
    expect(() => pwm.sample(Number.NaN)).toThrow(RangeError);
    expect(() => pwm.sample(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a grid outside the geometry', () => {
    const pwm = accumulator();
    expect(() => pwm.recordGridPlate(10, 1, 0)).toThrow(RangeError);
    expect(() => pwm.recordGridPlate(-2, 1, 0)).toThrow(RangeError);
  });

  it('accepts NO_GRID as the blanking interval', () => {
    const pwm = accumulator();
    expect(() => pwm.recordGridPlate(NO_GRID, 0, 0)).not.toThrow();
    expect(pwm.gridMask).toBe(0);
  });
});
