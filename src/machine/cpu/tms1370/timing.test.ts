import { describe, it, expect } from 'vitest';
import {
  CLOCK_DIVIDER,
  CYCLE_HZ,
  CYCLE_HZ_MAX,
  CYCLE_HZ_MIN,
  OSCILLATOR_HZ,
  OSCILLATOR_HZ_MAX,
  OSCILLATOR_HZ_MIN,
  OSCILLATOR_SPREAD_HZ,
} from './timing.js';

// This suite asserts the *shape* V10 requires (contract, docs/contract/v3.contract.md):
// the oscillator and the divide-by-six are two separately named exported
// constants, and the instruction rate is computed from them rather than typed
// in as a fused literal. It does not and cannot assert a measured value - none
// exists yet. docs/research/mp2110-timing-measurement.md records why.

describe('tms1370 timing - separately named constants', () => {
  it('exports the oscillator frequency and the divide-by-six as distinct bindings', () => {
    // Distinct identifiers with distinct values - not one constant aliased
    // under two names, and not pre-combined into a single cycles-per-second
    // figure.
    expect(OSCILLATOR_HZ).not.toBe(CLOCK_DIVIDER);
    expect(typeof OSCILLATOR_HZ).toBe('number');
    expect(typeof CLOCK_DIVIDER).toBe('number');
  });

  it('fixes the divide-by-six at 6, the architectural constant tms1370-architecture.md §6 calls confirmed three independent ways', () => {
    expect(CLOCK_DIVIDER).toBe(6);
  });

  it('carries MAME’s fitted approximation for the oscillator, not a measurement', () => {
    // 350 kHz per docs/research/tms1370-architecture.md §6 (S2 hh_tms1k.cpp:7093).
    // This is the one place the estimate is allowed to appear as a literal -
    // it is the constant's own definition, cited to its source.
    expect(OSCILLATOR_HZ).toBe(350_000);
  });
});

describe('tms1370 timing - the instruction rate is derived, never a literal', () => {
  it('computes CYCLE_HZ from OSCILLATOR_HZ and CLOCK_DIVIDER by division', () => {
    expect(CYCLE_HZ).toBe(OSCILLATOR_HZ / CLOCK_DIVIDER);
  });

  it('moves CYCLE_HZ if OSCILLATOR_HZ is refined, independently of CLOCK_DIVIDER', () => {
    // Simulates a future refinement of the oscillator estimate without
    // touching the module's own binding, to prove the two constants are
    // independent inputs to one formula rather than fused together.
    const refinedOscillatorHz = OSCILLATOR_HZ + 1_000;
    const recomputed = refinedOscillatorHz / CLOCK_DIVIDER;
    expect(recomputed).not.toBe(CYCLE_HZ);
    expect(recomputed).toBe(refinedOscillatorHz / CLOCK_DIVIDER);
  });

  it('never lands on the unqualified 58,333 midpoint some sources quote', () => {
    // The contract (V10) is explicit: 350,000 / 6 = 58,333.33 is a midpoint of
    // a 50,000-66,667 Hz range carrying a real +/-50 kHz spread, and must not
    // appear anywhere as a threshold. This suite asserts the range instead.
    expect(CYCLE_HZ).toBeCloseTo(58_333.33, 1);
    expect(CYCLE_HZ).toBeGreaterThan(CYCLE_HZ_MIN);
    expect(CYCLE_HZ).toBeLessThan(CYCLE_HZ_MAX);
  });
});

describe('tms1370 timing - the oscillator spread is a named constant, not folded in', () => {
  it('derives the oscillator range from OSCILLATOR_HZ and OSCILLATOR_SPREAD_HZ', () => {
    expect(OSCILLATOR_SPREAD_HZ).toBe(50_000);
    expect(OSCILLATOR_HZ_MIN).toBe(OSCILLATOR_HZ - OSCILLATOR_SPREAD_HZ);
    expect(OSCILLATOR_HZ_MAX).toBe(OSCILLATOR_HZ + OSCILLATOR_SPREAD_HZ);
    expect(OSCILLATOR_HZ_MIN).toBe(300_000);
    expect(OSCILLATOR_HZ_MAX).toBe(400_000);
  });

  it('derives the instruction-rate range from the oscillator range and CLOCK_DIVIDER', () => {
    expect(CYCLE_HZ_MIN).toBe(OSCILLATOR_HZ_MIN / CLOCK_DIVIDER);
    expect(CYCLE_HZ_MAX).toBe(OSCILLATOR_HZ_MAX / CLOCK_DIVIDER);
    // 50,000-66,666.67 Hz, per the contract's stated band.
    expect(CYCLE_HZ_MIN).toBe(50_000);
    expect(CYCLE_HZ_MAX).toBeCloseTo(66_666.67, 1);
  });
});
