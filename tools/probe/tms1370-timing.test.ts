// The cadence constants against the machine they were measured off.
//
// Paths in this file are relative to the repository root.
//
// `src/machine/board/tms1370-cadence.ts` says of two of its figures that they
// are *measured, not counted*: the sweep is however long the program's work
// takes, and a strobe holds its grid up for however long `strobe` takes. Every
// horizon in that module, and the tube's whole brightness normalisation, is
// built on those two. So they are held to the running ROM here rather than left
// as numbers a comment vouches for - a sweep-loop edit that moved either would
// otherwise dim the tube or misread every blank, silently.
//
// This is the file `tms1370-cadence.ts` names. It is deliberately not part of
// any of the seven behavioural suites: what it asserts is that a constant still
// describes the machine, which is a different question from whether the machine
// plays the game.
//
// Node-side test: no DOM, no browser globals.

import { describe, expect, it } from 'vitest';
import {
  LIT_SEGMENT_DUTY,
  REFRESH_TIMEOUT_CYCLES,
  STROBE_DWELL_INSTRUCTIONS,
  SWEEP_INSTRUCTIONS,
} from '../../src/machine/board/tms1370-cadence.js';
import { STROBES_PER_SWEEP } from '../../src/machine/board/o-pla.js';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { LIT_DUTY, PHOSPHOR, targetBrightness } from '../../src/machine/tube/phosphor.js';
import { Tms1370Machine, runGame, sweepPeriods } from './tms1370-probe.js';

/** Seconds of emulated time, as the cycle count the probe takes. */
const seconds = (value: number): number => Math.round(value * CYCLE_HZ);

/** The tolerance every figure here is held to: the sweep is not frequency-stable. */
const TOLERANCE = 0.1;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[sorted.length >> 1] as number;
};

describe('the sweep the cadence module measures', () => {
  const cycles = seconds(6);
  const run = runGame({
    cycles,
    input: [{ cycle: 0, change: { skill: 1, lane: 1 } }],
    keepStrobes: true,
  });

  it('runs a sweep of the length the module records', () => {
    // Within 10%, for the reason the module gives: the between-sweep work
    // varies with what is on the glass, so this pins the constant against drift
    // rather than asserting a rate.
    const period = median(sweepPeriods(run.strobes));
    expect(period).toBeGreaterThan(SWEEP_INSTRUCTIONS * (1 - TOLERANCE));
    expect(period).toBeLessThan(SWEEP_INSTRUCTIONS * (1 + TOLERANCE));
  });

  it('issues the strobes the sweep plan issues, and no more', () => {
    const sweeps = sweepPeriods(run.strobes).length;
    expect(sweeps).toBeGreaterThan(0);
    const perSweep = run.strobes.length / (sweeps + 1);
    expect(perSweep).toBeGreaterThan(STROBES_PER_SWEEP * (1 - TOLERANCE));
    expect(perSweep).toBeLessThan(STROBES_PER_SWEEP * (1 + TOLERANCE));
  });

  it('holds a grid up for the dwell the module records', () => {
    // `strobe` is one straight-line routine whatever grid it is pointed at, so
    // this is a constant rather than a distribution - and the assertion is on
    // the median rather than on every strobe because the arm that ticks the
    // buzz takes a longer path through the same routine.
    expect(median(run.strobes.map((strobe) => strobe.cycles))).toBe(STROBE_DWELL_INSTRUCTIONS);
  });

  it('leaves a segment at the duty the renderer normalises against', () => {
    // The end of the chain PRD R5 class 6 is about. If this drifts, the tube
    // renders at a fraction of its brightness and no other assertion sees it.
    const machine = new Tms1370Machine();
    machine.setContacts({ skill: 1, lane: 1 });
    machine.step(seconds(3));
    const duties = machine.getObservedFrame().segments.map((segment) => segment.duty);
    expect(duties.length, 'nothing was lit to measure').toBeGreaterThan(0);
    expect(median(duties)).toBeCloseTo(LIT_SEGMENT_DUTY, 4);
    expect(median(duties)).toBeCloseTo(LIT_DUTY, 4);
  });

  it('renders a driven segment at full brightness rather than a fraction of it', () => {
    // Normalising against the grid share (1/9) would put this at 0.18 and
    // against the strobe share (1/24) at 0.34. Both were plausible readings of
    // the sweep plan and both render the tube dim.
    expect(targetBrightness(LIT_SEGMENT_DUTY, PHOSPHOR.cyan)).toBeCloseTo(1, 6);
    expect(targetBrightness(LIT_SEGMENT_DUTY / STROBES_PER_SWEEP, PHOSPHOR.cyan)).toBeLessThan(0.2);
  });
});

describe('the blank threshold against the intervals it separates', () => {
  const cycles = seconds(20);
  const input = [{ cycle: 0, change: { skill: 1 } }];
  for (let at = 0, lane = 0; at < cycles; at += 40_000, lane = (lane + 1) % 3) {
    input.push({ cycle: at, change: { lane } as never });
  }
  const run = runGame({ cycles, input: input as never, keepStrobes: true });

  /** Every interval with no grid driven, in cycles. */
  const gaps = run.strobes
    .slice(1)
    .map((strobe, at) => {
      const previous = run.strobes[at] as { cycle: number; cycles: number };
      return strobe.cycle - (previous.cycle + previous.cycles);
    })
    .filter((gap) => gap >= 0);

  it('sits above every gap a running sweep produces', () => {
    const sweeping = gaps.filter((gap) => gap < REFRESH_TIMEOUT_CYCLES);
    expect(sweeping.length).toBeGreaterThan(0);
    expect(Math.max(...sweeping)).toBeLessThan(REFRESH_TIMEOUT_CYCLES);
  });

  it('sits below every blank a sound produces, with the band between them empty', () => {
    // The failure this catches is the one the constant had: three sweeps put the
    // threshold *above* the shortest sound blank, so the tube went on reading as
    // lit through every short sound - D1 of docs/evidence/vfd-appearance.md.
    const blanks = gaps.filter((gap) => gap > REFRESH_TIMEOUT_CYCLES);
    expect(blanks.length, 'no sound stopped the sweep in this window').toBeGreaterThan(0);
    const shortestBlank = Math.min(...blanks);
    const longestSweepGap = Math.max(...gaps.filter((gap) => gap < REFRESH_TIMEOUT_CYCLES));
    expect(shortestBlank).toBeGreaterThan(REFRESH_TIMEOUT_CYCLES);
    // A band, not a boundary: the threshold has margin on both sides rather than
    // sitting on the edge of either population.
    expect(REFRESH_TIMEOUT_CYCLES / longestSweepGap).toBeGreaterThan(1.5);
    expect(shortestBlank / REFRESH_TIMEOUT_CYCLES).toBeGreaterThan(1.5);
  });
});
