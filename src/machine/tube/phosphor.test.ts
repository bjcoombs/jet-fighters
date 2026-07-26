import { describe, expect, it } from 'vitest';

import {
  PHOSPHOR,
  PhosphorField,
  stepBrightness,
  targetBrightness,
  type PhosphorConstants,
} from './phosphor.js';

/** Drive a field to steady state at a fixed duty, then report its brightness. */
function settle(field: PhosphorField, index: number, duty: number, frames = 200): number {
  for (let i = 0; i < frames; i += 1) {
    field.beginFrame();
    field.setDuty(index, duty);
    field.advance(16);
  }
  return field.brightnessAt(index);
}

describe('targetBrightness', () => {
  it('is zero for an undriven segment', () => {
    expect(targetBrightness(0)).toBe(0);
    expect(targetBrightness(-0.1)).toBe(0);
    expect(targetBrightness(Number.NaN)).toBe(0);
  });

  it('reaches full scale at the reference duty of a 10-grid sweep', () => {
    expect(targetBrightness(PHOSPHOR.referenceDuty)).toBeCloseTo(1, 10);
  });

  it('saturates rather than exceeding full scale', () => {
    expect(targetBrightness(0.5)).toBe(1);
    expect(targetBrightness(1)).toBe(1);
  });

  it('is monotonic in duty and never thresholds it to on/off', () => {
    const duties = [0.01, 0.02, 0.03, 0.05, 0.07, 0.09];
    const levels = duties.map((d) => targetBrightness(d));
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    }
    // Every intermediate duty lands strictly inside (0, 1): the whole point of
    // driving brightness from duty rather than from a lit/unlit boolean.
    for (const level of levels) {
      expect(level).toBeGreaterThan(0);
      expect(level).toBeLessThan(1);
    }
  });

  it('lifts the mid range through the response curve', () => {
    // Half the reference duty reads brighter than half scale, as the eye sees it.
    expect(targetBrightness(PHOSPHOR.referenceDuty / 2)).toBeGreaterThan(0.5);
  });
});

describe('stepBrightness', () => {
  it('does not move without elapsed time', () => {
    expect(stepBrightness(0.25, 1, 0)).toBe(0.25);
    expect(stepBrightness(0.25, 1, -5)).toBe(0.25);
  });

  it('rises to ~90% of target over the rise time', () => {
    const after = stepBrightness(0, 1, PHOSPHOR.riseTimeMs);
    expect(after).toBeCloseTo(0.9, 6);
  });

  it('decays to ~10% over the decay time', () => {
    const after = stepBrightness(1, 0, PHOSPHOR.decayTimeMs);
    expect(after).toBeCloseTo(0.1, 6);
  });

  it('rises faster than it decays', () => {
    const dt = 3;
    const risen = stepBrightness(0, 1, dt);
    const faded = 1 - stepBrightness(1, 0, dt);
    expect(risen).toBeGreaterThan(faded);
  });

  it('approaches but never overshoots the target', () => {
    let level = 0;
    for (let i = 0; i < 500; i += 1) {
      level = stepBrightness(level, 1, 16);
      expect(level).toBeLessThanOrEqual(1);
    }
    expect(level).toBeCloseTo(1, 6);
  });

  it('settles at the target for an enormous step rather than overshooting', () => {
    // A backgrounded tab hands back a multi-second delta on its first frame.
    expect(stepBrightness(0, 0.6, 10_000)).toBeCloseTo(0.6, 10);
    expect(stepBrightness(1, 0, 10_000)).toBeCloseTo(0, 10);
  });

  it('rejects non-finite inputs rather than poisoning the field', () => {
    expect(() => stepBrightness(Number.NaN, 1, 16)).toThrow(RangeError);
    expect(() => stepBrightness(0, Number.POSITIVE_INFINITY, 16)).toThrow(RangeError);
    expect(() => stepBrightness(0, 1, Number.NaN)).toThrow(RangeError);
  });

  it('honours custom constants', () => {
    const fast: PhosphorConstants = { ...PHOSPHOR, riseTimeMs: 1, decayTimeMs: 1 };
    expect(stepBrightness(0, 1, 1, fast)).toBeCloseTo(0.9, 6);
  });
});

describe('PhosphorField', () => {
  it('rejects a nonsensical size', () => {
    expect(() => new PhosphorField(0)).toThrow(RangeError);
    expect(() => new PhosphorField(2.5)).toThrow(RangeError);
  });

  it('starts dark', () => {
    const field = new PhosphorField(4);
    expect(field.anyLit()).toBe(false);
    expect(field.brightnessAt(3)).toBe(0);
  });

  it('bounds-checks segment indexes', () => {
    const field = new PhosphorField(2);
    expect(() => field.setDuty(2, 0.1)).toThrow(RangeError);
    expect(() => field.brightnessAt(-1)).toThrow(RangeError);
  });

  it('settles a fully-driven segment at full brightness', () => {
    const field = new PhosphorField(2);
    expect(settle(field, 0, PHOSPHOR.referenceDuty)).toBeCloseTo(1, 6);
    // The untouched segment stayed dark.
    expect(field.brightnessAt(1)).toBe(0);
  });

  it('settles static PWM patterns at the brightness their duty implies', () => {
    const duties = [PHOSPHOR.referenceDuty, PHOSPHOR.referenceDuty * 0.5, PHOSPHOR.referenceDuty * 0.25];
    const field = new PhosphorField(duties.length);
    for (let i = 0; i < 400; i += 1) {
      field.beginFrame();
      duties.forEach((duty, index) => field.setDuty(index, duty));
      field.advance(16);
    }
    duties.forEach((duty, index) => {
      expect(field.brightnessAt(index)).toBeCloseTo(targetBrightness(duty), 6);
    });
    // Distinct duties stay distinguishable - the shimmer the real tube shows.
    expect(field.brightnessAt(0)).toBeGreaterThan(field.brightnessAt(1));
    expect(field.brightnessAt(1)).toBeGreaterThan(field.brightnessAt(2));
  });

  it('decays gradually when a segment stops being driven', () => {
    const field = new PhosphorField(1);
    settle(field, 0, PHOSPHOR.referenceDuty);

    const trail: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      field.beginFrame(); // nothing driven this frame
      field.advance(4);
      trail.push(field.brightnessAt(0));
    }

    // Still glowing several milliseconds after the drive stopped...
    expect(trail[0]).toBeGreaterThan(0.3);
    expect(trail[0]).toBeLessThan(1);
    // ...and monotonically fading, never snapping to black.
    for (let i = 1; i < trail.length; i += 1) {
      expect(trail[i]).toBeLessThan(trail[i - 1]);
      expect(trail[i]).toBeGreaterThan(0);
    }
  });

  it('produces flicker rather than a clean square under rapid on/off', () => {
    const field = new PhosphorField(1);
    const samples: number[] = [];
    // Alternate driven / undriven every 4 ms - faster than the phosphor settles.
    for (let i = 0; i < 60; i += 1) {
      field.beginFrame();
      if (i % 2 === 0) {
        field.setDuty(0, PHOSPHOR.referenceDuty);
      }
      field.advance(4);
      samples.push(field.brightnessAt(0));
    }

    const tail = samples.slice(-20);
    const min = Math.min(...tail);
    const max = Math.max(...tail);
    // Never fully on, never fully off - a shimmering ripple, not a square wave.
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(1);
    // But visibly modulated, not smoothed into a flat average.
    expect(max - min).toBeGreaterThan(0.05);
  });

  it('holds a steady average under rapid flicker above the fully-off floor', () => {
    const field = new PhosphorField(1);
    for (let i = 0; i < 200; i += 1) {
      field.beginFrame();
      if (i % 2 === 0) field.setDuty(0, PHOSPHOR.referenceDuty);
      field.advance(2);
    }
    expect(field.brightnessAt(0)).toBeGreaterThan(0.5);
  });

  it('clears the duty buffer each frame so an unreported segment fades', () => {
    const field = new PhosphorField(1);
    field.beginFrame();
    field.setDuty(0, PHOSPHOR.referenceDuty);
    expect(field.dutyAt(0)).toBe(PHOSPHOR.referenceDuty);
    field.beginFrame();
    expect(field.dutyAt(0)).toBe(0);
  });

  it('blanks instantly on reset - the power switch, not a fade', () => {
    const field = new PhosphorField(2);
    settle(field, 0, PHOSPHOR.referenceDuty);
    expect(field.anyLit()).toBe(true);
    field.reset();
    expect(field.anyLit()).toBe(false);
    expect(field.dutyAt(0)).toBe(0);
  });

  it('exposes every brightness in index order', () => {
    const field = new PhosphorField(3);
    settle(field, 1, PHOSPHOR.referenceDuty);
    const levels = field.brightnesses();
    expect(levels.length).toBe(3);
    expect(levels[1]).toBeGreaterThan(0.9);
    expect(levels[0]).toBe(0);
  });
});
