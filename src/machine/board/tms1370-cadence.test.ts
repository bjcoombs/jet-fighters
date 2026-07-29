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
  LIT_SEGMENT_DUTY,
  PLAYER_SLICE_CYCLES,
  REFRESH_TIMEOUT_CYCLES,
  STEP_CYCLES,
  STROBE_CYCLES,
  STROBE_DWELL_INSTRUCTIONS,
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
    expect(REFRESH_TIMEOUT_CYCLES).toBe(Math.round(SWEEP_INSTRUCTIONS));
    expect(PLAYER_SLICE_CYCLES).toBe(Math.round(SWEEP_INSTRUCTIONS / 5));
    expect(STEP_CYCLES).toBe(Math.round(STROBE_CYCLES));
    expect(CAPTURE_WINDOW_CYCLES).toBe(Math.round(10 * CYCLE_HZ));
  });

  it('orders them the way the events they bound are ordered', () => {
    // A strobe is inside a sweep, and the capture window is seconds rather than
    // sweeps. Getting one of these backwards is how a v2-era literal survived
    // into a machine seven times slower without anything going red.
    expect(STEP_CYCLES).toBeLessThan(PLAYER_SLICE_CYCLES);
    expect(PLAYER_SLICE_CYCLES).toBeLessThan(SWEEP_INSTRUCTIONS);
    expect(SWEEP_INSTRUCTIONS).toBeLessThan(BURST_GAP_CYCLES);
    expect(BURST_GAP_CYCLES).toBeLessThan(CAPTURE_WINDOW_CYCLES);
  });

  it('blanks the tube before it splits two sounds apart', () => {
    // These two used to be ordered the other way round, on the reading that a
    // refresh timeout of three sweeps was "a sweep plus slack". They measure
    // different things and the ordering follows from that rather than from
    // taste: the refresh timeout times the gap between one grid line falling
    // and the next rising, which is 11 cycles inside a pass and never more than
    // 490 on a machine that is sweeping, while the burst gap times silence on
    // the speaker between two sounds and has to clear the 25-28 ms the measured
    // warning phrase leaves between its own beeps.
    //
    // So the refresh timeout is the smaller of the two, and it has to be: the
    // shortest blank a sound produces measures 1,518 cycles, and a timeout above
    // that leaves the tube reading as lit through every short sound - D1 of
    // docs/evidence/vfd-appearance.md, and the bug the constant exists to stop.
    expect(REFRESH_TIMEOUT_CYCLES).toBeLessThan(BURST_GAP_CYCLES);
    expect(REFRESH_TIMEOUT_CYCLES).toBeLessThan(1_518);
  });

  it('carries no 400 kHz-era figure', () => {
    // The v2 machine's literals, at its 400 kHz rate. Every one of them is
    // wrong here by about a factor of seven, and a literal says nothing about
    // which machine it belonged to.
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

describe('the duty a lit segment accumulates', () => {
  it('holds the grid up for part of the strobe rather than all of it', () => {
    // The whole reason a third factor exists. If a strobe held its grid up for
    // its entire share of the sweep this would be one and the duty would be the
    // 1/24 docs/research/pla-design.md works out from the sweep plan.
    expect(STROBE_DWELL_INSTRUCTIONS).toBeGreaterThan(0);
    expect(STROBE_DWELL_INSTRUCTIONS).toBeLessThan(STROBE_CYCLES);
  });

  it('measures the duty against the sweep, which is the refresh period', () => {
    expect(LIT_SEGMENT_DUTY).toBeCloseTo(STROBE_DWELL_INSTRUCTIONS / SWEEP_INSTRUCTIONS, 12);
  });

  it('lands an order of magnitude below the grid share the tube has nine of', () => {
    // 1/9 is the grid duty and 1/24 is the strobe share; neither is the time a
    // segment is actually driven for. Normalising brightness against either
    // renders the tube dim, which is what src/machine/tube/phosphor.ts's
    // LIT_DUTY exists to stop.
    expect(LIT_SEGMENT_DUTY).toBeLessThan(1 / 24 / 3);
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
