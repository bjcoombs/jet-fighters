// Tests for the TMS1370 cadence constants.
//
// Paths in this file are relative to the repository root.
//
// The point of the module is that six figures PRD R5 names are derived from one
// measured sweep and one provisional rate rather than written down. So these
// assert the *derivation* - that moving the sweep moves them - as well as the
// values, because a module that hard-coded the same numbers would pass a
// value-only suite exactly as well.

import { describe, expect, it } from 'vitest';
import {
  BURST_GAP_CYCLES,
  BUZZ_NOMINAL_HZ,
  BUZZ_STROBE_DIVIDER,
  CAPTURE_WINDOW_CYCLES,
  PLAYER_SLICE_CYCLES,
  REFRESH_TIMEOUT_CYCLES,
  STEP_CYCLES,
  STROBE_CYCLES,
  SWEEP_HZ,
  SWEEP_INSTRUCTIONS,
} from './tms1370-cadence.js';
import { STROBES_PER_SWEEP } from './o-pla.js';
import { CYCLE_HZ, CYCLE_HZ_MAX, CYCLE_HZ_MIN } from '../cpu/tms1370/timing.js';

describe('the sweep', () => {
  it('splits into the strobes the sweep plan issues', () => {
    expect(STROBE_CYCLES).toBeCloseTo(SWEEP_INSTRUCTIONS / STROBES_PER_SWEEP, 6);
    expect(STROBES_PER_SWEEP).toBe(24);
  });

  it('derives its rate from the instruction rate rather than stating one', () => {
    expect(SWEEP_HZ).toBeCloseTo(CYCLE_HZ / SWEEP_INSTRUCTIONS, 6);
  });

  it('spans the video refresh interval once the oscillator spread is applied', () => {
    // The reason this module does not tune SWEEP_INSTRUCTIONS to
    // vfd-appearance.md's 70.6-72.5 Hz: the same sweep runs anywhere inside
    // this range depending on the unit, and the range contains the interval
    // whole. Tuning the midpoint into it would be tuning to the figure the
    // contract says must appear nowhere as a threshold.
    const slowest = CYCLE_HZ_MIN / SWEEP_INSTRUCTIONS;
    const fastest = CYCLE_HZ_MAX / SWEEP_INSTRUCTIONS;
    expect(slowest).toBeLessThan(70.6);
    expect(fastest).toBeGreaterThan(72.5);
  });
});

describe('the horizons PRD R5 names', () => {
  it('states each one as a multiple of the sweep or of the instruction rate', () => {
    expect(BURST_GAP_CYCLES).toBe(Math.round(2 * SWEEP_INSTRUCTIONS));
    expect(REFRESH_TIMEOUT_CYCLES).toBe(Math.round(3 * SWEEP_INSTRUCTIONS));
    expect(PLAYER_SLICE_CYCLES).toBe(Math.round(SWEEP_INSTRUCTIONS / 5));
    expect(STEP_CYCLES).toBe(Math.round(STROBE_CYCLES));
    expect(CAPTURE_WINDOW_CYCLES).toBe(Math.round(10 * CYCLE_HZ));
  });

  it('orders them the way the events they bound are ordered', () => {
    // A strobe is inside a sweep, a sweep inside the refresh timeout, and the
    // capture window is seconds rather than sweeps. Getting one of these
    // backwards is how a v2-era literal survived into a machine seven times
    // slower without anything going red.
    expect(STEP_CYCLES).toBeLessThan(PLAYER_SLICE_CYCLES);
    expect(PLAYER_SLICE_CYCLES).toBeLessThan(SWEEP_INSTRUCTIONS);
    expect(SWEEP_INSTRUCTIONS).toBeLessThan(BURST_GAP_CYCLES);
    expect(BURST_GAP_CYCLES).toBeLessThan(REFRESH_TIMEOUT_CYCLES);
    expect(REFRESH_TIMEOUT_CYCLES).toBeLessThan(CAPTURE_WINDOW_CYCLES);
  });

  it('carries no 400 kHz-era figure', () => {
    // v2's literals, at the HMCS44's rate. Every one of them is wrong here by
    // about a factor of seven, and a literal says nothing about which machine
    // it belonged to.
    const v2 = [8_000, 600_000, 80_000, 3_000, 200];
    for (const stale of v2) {
      expect([
        BURST_GAP_CYCLES,
        CAPTURE_WINDOW_CYCLES,
        PLAYER_SLICE_CYCLES,
        STEP_CYCLES,
        REFRESH_TIMEOUT_CYCLES,
      ]).not.toContain(stale);
    }
  });
});

describe('the battleship buzz divider', () => {
  it('derives its rate from this machine sweep rather than ten grid dwells', () => {
    expect(BUZZ_NOMINAL_HZ).toBeCloseTo(
      (STROBES_PER_SWEEP * SWEEP_HZ) / (2 * BUZZ_STROBE_DIVIDER),
      6,
    );
  });

  it('lands inside the measured 79-111 Hz band', () => {
    // audio-reference.md, battleshipBuzz.repetitionRangeHz. The nominal figure
    // is taken at an idle sweep; the ROM's own is a little higher because the
    // buzz slows the sweep it is clocked off, and the probe suite measures that
    // one against the same band.
    expect(BUZZ_NOMINAL_HZ).toBeGreaterThanOrEqual(79);
    expect(BUZZ_NOMINAL_HZ).toBeLessThanOrEqual(111);
  });
});
