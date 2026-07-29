import { describe, expect, it } from 'vitest';

import type { ColorRegion } from './atlas-schema.js';
import {
  MEASURED_RESIDUAL,
  PHOSPHOR,
  PhosphorField,
  REFRESH_OFF_TIME_MS,
  decayTimeForResidual,
  residualAfterOffTime,
  stepBrightness,
  targetBrightness,
  type PhosphorConstants,
  type PhosphorSet,
} from './phosphor.js';

/**
 * The bands docs/evidence/vfd-appearance.md section 3 measured, per region:
 * the light left between refreshes as a fraction of the driven level, over four
 * independently sampled 600-frame windows. These are the measurement. The decay
 * times are derived from them, so the tests assert these and never a tau.
 */
const MEASURED_BAND: Readonly<Record<ColorRegion, { readonly min: number; readonly max: number }>> = {
  cyan: { min: 0.032, max: 0.045 },
  red: { min: 0.13, max: 0.21 },
};

/** A field of `regions.length` segments, in the order given. */
function fieldOf(regions: readonly ColorRegion[], constants?: PhosphorSet): PhosphorField {
  return new PhosphorField(regions, constants);
}

/** Drive a field to steady state at a fixed duty, then report its brightness. */
function settle(field: PhosphorField, index: number, duty: number, frames = 200): number {
  for (let i = 0; i < frames; i += 1) {
    field.beginFrame();
    field.setDuty(index, duty);
    field.advance(16);
  }
  return field.brightnessAt(index);
}

/** Drive every segment of a field to steady state at the reference duty. */
function settleAll(field: PhosphorField, frames = 200): void {
  for (let i = 0; i < frames; i += 1) {
    field.beginFrame();
    for (let index = 0; index < field.size; index += 1) {
      field.setDuty(index, PHOSPHOR.cyan.referenceDuty);
    }
    field.advance(16);
  }
}

/**
 * Mean brightness across one off-interval, starting from a fully driven segment
 * - the quantity the video measured.
 *
 * The camera integrates the decay over its exposure rather than catching an
 * instant, so the residual is an average across the interval and not the level
 * at its end. Sampled finely enough that the sum is the integral to well inside
 * the width of the measured bands.
 */
function residualsOverOffTime(field: PhosphorField, offTimeMs = REFRESH_OFF_TIME_MS): readonly number[] {
  const steps = 4000;
  const dt = offTimeMs / steps;
  // Every segment fades in the same pass - the field is stateful, so measuring
  // one index at a time would read the second one off an already-faded tube.
  const sums = Array.from({ length: field.size }, (_, index) => field.brightnessAt(index) / 2);
  for (let i = 0; i < steps; i += 1) {
    field.beginFrame(); // nothing driven: the grid has moved on
    field.advance(dt);
    for (let index = 0; index < field.size; index += 1) {
      sums[index] += field.brightnessAt(index);
    }
  }
  return sums.map((sum, index) => (sum - field.brightnessAt(index) / 2) / steps);
}

describe('the measured residual', () => {
  it('converts to a decay time and back', () => {
    for (const decayTimeMs of [0.5, 1, 4.4, 15, 40]) {
      const residual = residualAfterOffTime(decayTimeMs, REFRESH_OFF_TIME_MS);
      expect(decayTimeForResidual(residual, REFRESH_OFF_TIME_MS)).toBeCloseTo(decayTimeMs, 6);
    }
  });

  it('rises with the decay time and never leaves 0..1', () => {
    const residuals = [0.2, 1, 5, 20, 100].map((ms) => residualAfterOffTime(ms, REFRESH_OFF_TIME_MS));
    for (let i = 1; i < residuals.length; i += 1) {
      expect(residuals[i]).toBeGreaterThan(residuals[i - 1]);
    }
    expect(residuals[0]).toBeGreaterThan(0);
    expect(residuals.at(-1)).toBeLessThan(1);
  });

  it('rejects a residual that is not a fraction', () => {
    expect(() => decayTimeForResidual(0, REFRESH_OFF_TIME_MS)).toThrow(RangeError);
    expect(() => decayTimeForResidual(1, REFRESH_OFF_TIME_MS)).toThrow(RangeError);
    expect(() => decayTimeForResidual(Number.NaN, REFRESH_OFF_TIME_MS)).toThrow(RangeError);
  });

  it('puts each region\'s constants inside the band that produced them', () => {
    for (const region of ['cyan', 'red'] as const) {
      const residual = residualAfterOffTime(PHOSPHOR[region].decayTimeMs, REFRESH_OFF_TIME_MS);
      expect(residual).toBeGreaterThanOrEqual(MEASURED_BAND[region].min);
      expect(residual).toBeLessThanOrEqual(MEASURED_BAND[region].max);
      expect(residual).toBeCloseTo(MEASURED_RESIDUAL[region], 6);
    }
  });

  it('survives the off-time moving, because the residual is what is asserted', () => {
    // The off-time is the derivation's one assumption and it is in play: D4 is
    // moving the sweep from 64.5 Hz into 70.6-72.5 Hz, which shortens it. Re-derive
    // the constants across every off-time that bracket and the current ROM admit,
    // and the measured residual comes back unchanged at each - that invariance is
    // the reason the constants are inverted from the residuals in code rather
    // than written down. Only the decay times move, and they move together.
    const previous: Record<ColorRegion, number> = { cyan: 0, red: 0 };
    for (const offTimeMs of [10, 11, 12, 12.6, 13, 14, 15.5]) {
      for (const region of ['cyan', 'red'] as const) {
        const decayTimeMs = decayTimeForResidual(MEASURED_RESIDUAL[region], offTimeMs);
        const field = fieldOf([region], {
          ...PHOSPHOR,
          [region]: { ...PHOSPHOR[region], decayTimeMs },
        });
        settleAll(field);
        const [residual] = residualsOverOffTime(field, offTimeMs);
        expect(residual).toBeGreaterThanOrEqual(MEASURED_BAND[region].min);
        expect(residual).toBeLessThanOrEqual(MEASURED_BAND[region].max);
        // Longer off-time, slower phosphor - strictly, so a mistake in the
        // inversion cannot hide behind the width of the bands.
        expect(decayTimeMs).toBeGreaterThan(previous[region]);
        previous[region] = decayTimeMs;
      }
    }
  });

  it('excludes the single 15 ms constant this replaced', () => {
    // The old judgement call, measured the way the video measured the real tube:
    // it leaves 46% of the drive between refreshes against a measured 3.5% and
    // 15.5%. No single value could have satisfied both bands at once.
    const residual = residualAfterOffTime(15, REFRESH_OFF_TIME_MS);
    expect(residual).toBeGreaterThan(0.4);
    expect(residual).toBeGreaterThan(MEASURED_BAND.red.max);
    expect(residual).toBeGreaterThan(MEASURED_BAND.cyan.max);
  });
});

describe('targetBrightness', () => {
  it('is zero for an undriven segment', () => {
    expect(targetBrightness(0, PHOSPHOR.cyan)).toBe(0);
    expect(targetBrightness(-0.1, PHOSPHOR.cyan)).toBe(0);
    expect(targetBrightness(Number.NaN, PHOSPHOR.cyan)).toBe(0);
  });

  it('reaches full scale at the duty a whole strobe accumulates', () => {
    expect(targetBrightness(PHOSPHOR.cyan.referenceDuty, PHOSPHOR.cyan)).toBeCloseTo(1, 10);
    expect(targetBrightness(PHOSPHOR.red.referenceDuty, PHOSPHOR.red)).toBeCloseTo(1, 10);
  });

  it('saturates rather than exceeding full scale', () => {
    expect(targetBrightness(0.5, PHOSPHOR.cyan)).toBe(1);
    expect(targetBrightness(1, PHOSPHOR.cyan)).toBe(1);
  });

  it('is monotonic in duty and never thresholds it to on/off', () => {
    // Fractions of the reference duty rather than absolute duties: what the
    // sweep delivers to a fully driven segment has moved by more than a decade
    // between the two machines, and a fixed ladder of duties was one that
    // saturated on the second of them and stopped testing anything.
    const shares = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
    const duties = shares.map((share) => share * PHOSPHOR.cyan.referenceDuty);
    const levels = duties.map((d) => targetBrightness(d, PHOSPHOR.cyan));
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
    expect(targetBrightness(PHOSPHOR.cyan.referenceDuty / 2, PHOSPHOR.cyan)).toBeGreaterThan(0.5);
  });

  it('responds to duty identically in both regions', () => {
    // Only the decay differs. Nothing measures a per-region duty response, so
    // nothing here invents one.
    for (const duty of [0.01, 0.04, 0.09, 0.1]) {
      expect(targetBrightness(duty, PHOSPHOR.red)).toBeCloseTo(targetBrightness(duty, PHOSPHOR.cyan), 12);
    }
  });
});

describe('stepBrightness', () => {
  it('does not move without elapsed time', () => {
    expect(stepBrightness(0.25, 1, 0, PHOSPHOR.cyan)).toBe(0.25);
    expect(stepBrightness(0.25, 1, -5, PHOSPHOR.cyan)).toBe(0.25);
  });

  it('rises to ~90% of target over the rise time', () => {
    const after = stepBrightness(0, 1, PHOSPHOR.cyan.riseTimeMs, PHOSPHOR.cyan);
    expect(after).toBeCloseTo(0.9, 6);
  });

  it('decays to ~10% over the decay time, per region', () => {
    for (const region of ['cyan', 'red'] as const) {
      const constants = PHOSPHOR[region];
      expect(stepBrightness(1, 0, constants.decayTimeMs, constants)).toBeCloseTo(0.1, 6);
    }
  });

  it('rises faster than it decays', () => {
    const dt = 3;
    const risen = stepBrightness(0, 1, dt, PHOSPHOR.red);
    const faded = 1 - stepBrightness(1, 0, dt, PHOSPHOR.red);
    expect(risen).toBeGreaterThan(faded);
  });

  it('approaches but never overshoots the target', () => {
    let level = 0;
    for (let i = 0; i < 500; i += 1) {
      level = stepBrightness(level, 1, 16, PHOSPHOR.cyan);
      expect(level).toBeLessThanOrEqual(1);
    }
    expect(level).toBeCloseTo(1, 6);
  });

  it('settles at the target for an enormous step rather than overshooting', () => {
    // A backgrounded tab hands back a multi-second delta on its first frame.
    expect(stepBrightness(0, 0.6, 10_000, PHOSPHOR.cyan)).toBeCloseTo(0.6, 10);
    expect(stepBrightness(1, 0, 10_000, PHOSPHOR.red)).toBeCloseTo(0, 10);
  });

  it('rejects non-finite inputs rather than poisoning the field', () => {
    expect(() => stepBrightness(Number.NaN, 1, 16, PHOSPHOR.cyan)).toThrow(RangeError);
    expect(() => stepBrightness(0, Number.POSITIVE_INFINITY, 16, PHOSPHOR.cyan)).toThrow(RangeError);
    expect(() => stepBrightness(0, 1, Number.NaN, PHOSPHOR.cyan)).toThrow(RangeError);
  });

  it('honours custom constants', () => {
    const fast: PhosphorConstants = { ...PHOSPHOR.cyan, riseTimeMs: 1, decayTimeMs: 1 };
    expect(stepBrightness(0, 1, 1, fast)).toBeCloseTo(0.9, 6);
  });
});

describe('PhosphorField', () => {
  it('rejects a field with no segments', () => {
    expect(() => fieldOf([])).toThrow(RangeError);
  });

  it('rejects a colour region it has no constants for', () => {
    expect(() => fieldOf(['amber' as ColorRegion])).toThrow(RangeError);
  });

  it('starts dark', () => {
    const field = fieldOf(['cyan', 'cyan', 'red', 'red']);
    expect(field.anyLit()).toBe(false);
    expect(field.brightnessAt(3)).toBe(0);
  });

  it('bounds-checks segment indexes', () => {
    const field = fieldOf(['cyan', 'red']);
    expect(() => field.setDuty(2, 0.1)).toThrow(RangeError);
    expect(() => field.brightnessAt(-1)).toThrow(RangeError);
  });

  it('settles a fully-driven segment at full brightness', () => {
    const field = fieldOf(['cyan', 'red']);
    expect(settle(field, 0, PHOSPHOR.cyan.referenceDuty)).toBeCloseTo(1, 6);
    // The untouched segment stayed dark.
    expect(field.brightnessAt(1)).toBe(0);
  });

  it('settles static PWM patterns at the brightness their duty implies', () => {
    const full = PHOSPHOR.cyan.referenceDuty;
    const duties = [full, full * 0.5, full * 0.25];
    const field = fieldOf(['cyan', 'cyan', 'cyan']);
    for (let i = 0; i < 400; i += 1) {
      field.beginFrame();
      duties.forEach((duty, index) => field.setDuty(index, duty));
      field.advance(16);
    }
    duties.forEach((duty, index) => {
      expect(field.brightnessAt(index)).toBeCloseTo(targetBrightness(duty, PHOSPHOR.cyan), 6);
    });
    // Distinct duties stay distinguishable - the shimmer the real tube shows.
    expect(field.brightnessAt(0)).toBeGreaterThan(field.brightnessAt(1));
    expect(field.brightnessAt(1)).toBeGreaterThan(field.brightnessAt(2));
  });

  it('leaves each region the residual its own band measured', () => {
    // The headline assertion of this file, and the one a single decay constant
    // cannot satisfy: drive both phosphors to full, stop, and average the light
    // over one grid off-interval, exactly as the video did.
    const field = fieldOf(['cyan', 'red']);
    settleAll(field);

    const [cyan, red] = residualsOverOffTime(field);

    expect(cyan).toBeGreaterThanOrEqual(MEASURED_BAND.cyan.min);
    expect(cyan).toBeLessThanOrEqual(MEASURED_BAND.cyan.max);
    expect(red).toBeGreaterThanOrEqual(MEASURED_BAND.red.min);
    expect(red).toBeLessThanOrEqual(MEASURED_BAND.red.max);
  });

  it('holds red against cyan at the measured ~4x persistence', () => {
    const field = fieldOf(['cyan', 'red']);
    settleAll(field);
    const [cyan, red] = residualsOverOffTime(field);
    const ratio = red / cyan;
    // 15.5 / 3.5 = 4.4. One shared constant gives exactly 1.
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(6);
  });

  it('reproduces the old single-constant residual when given the old constants', () => {
    // The complement of the assertion above: the model is not hard-wired to the
    // new numbers, it follows whatever constants it is handed. Both regions at
    // 15 ms land where the old field landed - far outside both measured bands.
    const legacy: PhosphorSet = {
      cyan: { ...PHOSPHOR.cyan, decayTimeMs: 15 },
      red: { ...PHOSPHOR.red, decayTimeMs: 15 },
    };
    const field = fieldOf(['cyan', 'red'], legacy);
    settleAll(field);
    const [cyan, red] = residualsOverOffTime(field);
    expect(cyan).toBeCloseTo(red, 6);
    expect(cyan).toBeGreaterThan(MEASURED_BAND.red.max);
  });

  it('decays gradually when a segment stops being driven', () => {
    const field = fieldOf(['red']);
    settle(field, 0, PHOSPHOR.red.referenceDuty);

    const trail: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      field.beginFrame(); // nothing driven this frame
      field.advance(0.5);
      trail.push(field.brightnessAt(0));
    }

    // Red is still well above the noise half a millisecond after the drive
    // stopped - e^(-0.5 / 1.86 ms) - and reaches 10% at ~4.4 ms.
    expect(trail[0]).toBeCloseTo(Math.exp(-0.5 / (PHOSPHOR.red.decayTimeMs / Math.LN10)), 6);
    expect(trail[0]).toBeLessThan(1);
    // ...and monotonically fading, never snapping to black.
    for (let i = 1; i < trail.length; i += 1) {
      expect(trail[i]).toBeLessThan(trail[i - 1]);
      expect(trail[i]).toBeGreaterThan(0);
    }
  });

  it('produces flicker rather than a clean square under rapid on/off', () => {
    const field = fieldOf(['red']);
    const samples: number[] = [];
    // Alternate driven / undriven every 0.5 ms - faster than the phosphor settles.
    for (let i = 0; i < 60; i += 1) {
      field.beginFrame();
      if (i % 2 === 0) {
        field.setDuty(0, PHOSPHOR.red.referenceDuty);
      }
      field.advance(0.5);
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

  it('rides high under flicker faster than the phosphor can follow', () => {
    // At a 0.2 ms half-period - well inside red's ~1.9 ms time constant - the
    // ripple settles around half scale rather than falling to the 15.5% the
    // same phosphor reaches over the sweep's own 12 ms off-time.
    const field = fieldOf(['red']);
    for (let i = 0; i < 400; i += 1) {
      field.beginFrame();
      if (i % 2 === 0) field.setDuty(0, PHOSPHOR.red.referenceDuty);
      field.advance(0.2);
    }
    expect(field.brightnessAt(0)).toBeGreaterThan(0.4);
    expect(field.brightnessAt(0)).toBeGreaterThan(MEASURED_RESIDUAL.red * 2);
  });

  it('clears the duty buffer each frame so an unreported segment fades', () => {
    const field = fieldOf(['cyan']);
    field.beginFrame();
    field.setDuty(0, PHOSPHOR.cyan.referenceDuty);
    expect(field.dutyAt(0)).toBe(PHOSPHOR.cyan.referenceDuty);
    field.beginFrame();
    expect(field.dutyAt(0)).toBe(0);
  });

  it('blanks instantly on reset - the power switch, not a fade', () => {
    const field = fieldOf(['cyan', 'red']);
    settle(field, 0, PHOSPHOR.cyan.referenceDuty);
    expect(field.anyLit()).toBe(true);
    field.reset();
    expect(field.anyLit()).toBe(false);
    expect(field.dutyAt(0)).toBe(0);
  });

  it('exposes every brightness in index order', () => {
    const field = fieldOf(['cyan', 'red', 'cyan']);
    settle(field, 1, PHOSPHOR.red.referenceDuty);
    const levels = field.brightnesses();
    expect(levels.length).toBe(3);
    expect(levels[1]).toBeGreaterThan(0.9);
    expect(levels[0]).toBe(0);
  });
});
