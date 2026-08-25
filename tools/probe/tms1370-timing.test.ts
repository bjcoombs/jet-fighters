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

/**
 * Frames the duty is taken over, so the sweep's jitter averages out.
 *
 * Stated as a count of frames rather than as a span of emulated time, because
 * the quantity being averaged is per frame and a span would silently mean
 * "however many sweeps fit at today's sweep length". Two hundred is a few
 * seconds of play at any sweep length this ROM could plausibly have, and well
 * past the point the median stops moving.
 */
const FRAMES_SAMPLED = 200;

/**
 * Sweeps the duty sample may run before it gives up on reaching that count.
 *
 * A dark frame does not count towards {@link FRAMES_SAMPLED}, so the loop needs
 * some other end: the ROM stops sweeping for the whole of every sound and for
 * good once the game ends, and this drive only works the lever. Sized as a
 * multiple of the frames wanted rather than as a cycle horizon, because what it
 * bounds is a count of attempts. Four times is generous against the measured
 * shortfall - this drive is silent enough that 200 frames currently take exactly
 * 200 sweeps - and still ends a run against a tube that has gone dark for good.
 * The headroom is the point: a ROM that sounds more often should widen the
 * sample rather than fail, and only a tube that has stopped should end it.
 */
const FRAME_ATTEMPTS_MAX = 4 * FRAMES_SAMPLED;

/**
 * Cycles to wait for one sweep before giving up on it.
 *
 * `runSweeps` needs a ceiling because the ROM stops sweeping for the whole of
 * every sound and for good once the game ends. Expressed as a multiple of the
 * sweep the module records rather than as a literal, for the reason CLAUDE.md
 * gives about horizons in tests of a machine that stops.
 */
const SWEEP_WAIT_CYCLES = 64 * SWEEP_INSTRUCTIONS;

/**
 * Brightness a segment driven on every sweep has to still reach.
 *
 * `targetBrightness` normalises duty against `LIT_DUTY` and clamps at 1, so this
 * is a floor on dimming and says nothing about a sweep that shortened - which is
 * why the sweep itself is asserted separately. About 3% of sweep drift, against
 * the 10% the constant is held to, and far above the 0.24 and 0.13 that the two
 * plausible misreadings of the sweep plan produce.
 */
const DRIVEN_BRIGHTNESS_FLOOR = 0.98;

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
    //
    // ## Why this reads many frames, and why the claim is split in three
    //
    // It used to read the one frame standing at t=3 s and hold its median duty
    // to LIT_SEGMENT_DUTY at four decimal places. Both halves of that were a bet
    // on phase.
    //
    // **The frame period IS the sweep.** `pwm.ts` measures every duty against
    // the period that just closed, and `tms1370-cadence.ts` is explicit that the
    // sweep is not frequency-stable by design - the between-sweep work varies
    // with what is on the glass. So one frame reports whatever that one sweep
    // cost, not what the ROM costs. Measured on this drive: the sweep standing at
    // t=3 s is 894 cycles on one ROM and 944 on another whose *median* sweep is
    // 898. Nothing in the brightness chain differed between them - the sample
    // landed in a long sweep.
    //
    // **And four decimal places is a bound of about six cycles** on a sweep
    // length the module itself only claims to within 10%. `main` passed it with
    // 88% of that tolerance already spent, so any edit to the render path tipped
    // it, and the failure said "the tube is dim" when what had happened was that
    // a different sweep was sampled.
    //
    // The single-frame median was also read as fragile for a second reason that
    // turned out not to be one: the lit-segment count moves between ROMs, so a
    // median over the set could pick a different segment. It cannot - every lit
    // segment in a frame accrues exactly one strobe dwell, which is claim 1
    // below, now asserted rather than assumed.
    //
    // So the claims it was conflating are made separately, and the one that
    // carries the brightness is now exact rather than approximate:
    //
    //   1. the display model turns a dwell and a sweep into a duty correctly,
    //      asserted against the period each frame itself reports;
    //   2. the sweep the ROM produces still matches the constant, at the same
    //      tolerance its sibling above uses - this is the assertion that goes red
    //      when the ROM's sweep genuinely moves, and the figure task 8 re-derives;
    //   3. a fully driven segment still renders at full brightness, which is what
    //      the paragraph at the top is actually about.
    const machine = new Tms1370Machine();
    machine.setContacts({ skill: 1, lane: 1 });
    const dwells: number[] = [];
    const periods: number[] = [];
    // **The loop counts frames it kept, not sweeps it ran.** Counting attempts
    // would let a stretch of sound spend the budget on dark frames and leave the
    // median resting on whatever few lit ones survived - a smaller version of the
    // single-frame bet this test was rewritten to remove. The attempt ceiling is
    // what stops it running forever once the game ends and the sweeps stop.
    for (
      let attempt = 0;
      periods.length < FRAMES_SAMPLED && attempt < FRAME_ATTEMPTS_MAX;
      attempt += 1
    ) {
      machine.runSweeps(1, SWEEP_WAIT_CYCLES);
      const frame = machine.getObservedFrame();
      if (frame.segments.length === 0 || frame.cycles === 0) {
        continue; // a sound held the sweep and the tube was dark for all of it
      }
      periods.push(frame.cycles);
      for (const segment of frame.segments) {
        dwells.push(Math.round(segment.duty * frame.cycles));
      }
    }
    expect(periods, 'the tube went dark before a full sample was taken').toHaveLength(
      FRAMES_SAMPLED,
    );

    // 1. A driven segment accrues exactly one strobe dwell in the frame. The
    //    median rather than every segment, for the reason the dwell assertion
    //    above gives: the arm that ticks the buzz takes a longer path through
    //    `strobe`, so a minority of strobes are longer by design.
    expect(median(dwells)).toBe(STROBE_DWELL_INSTRUCTIONS);

    // 2. The sweep those duties are measured against is still the one the module
    //    records. `main` measures 893 here and this branch 898, against a
    //    constant of 889 - see the PR notes; task 8 re-derives it.
    const sweep = median(periods);
    expect(sweep).toBeGreaterThan(SWEEP_INSTRUCTIONS * (1 - TOLERANCE));
    expect(sweep).toBeLessThan(SWEEP_INSTRUCTIONS * (1 + TOLERANCE));

    // 3. The outcome. `targetBrightness` clamps at 1, so this catches dimming
    //    only - claim 2 is what catches a sweep that shortened. The floor is
    //    tighter than claim 2's band, not looser: a 10% long sweep renders at
    //    0.939 and this admits about 3%, while the two readings that made this
    //    test necessary in the first place - normalising against the grid share
    //    or the strobe share - come out at 0.24 and 0.13.
    const duty = STROBE_DWELL_INSTRUCTIONS / sweep;
    expect(targetBrightness(duty, PHOSPHOR.cyan)).toBeGreaterThan(DRIVEN_BRIGHTNESS_FLOOR);

    // The two constants are derived in different modules - LIT_SEGMENT_DUTY from
    // the sweep and the dwell, LIT_DUTY from the grid share and the strobe duty -
    // and the renderer's normalisation is only sound while they agree.
    expect(LIT_DUTY).toBeCloseTo(LIT_SEGMENT_DUTY, 6);
  });

  it('renders a driven segment at full brightness rather than a fraction of it', () => {
    // Normalising against the grid share (1/9) would put this at 0.18 and
    // against the strobe share (1/24) at 0.34. Both were plausible readings of
    // the sweep plan and both render the tube dim.
    expect(targetBrightness(LIT_SEGMENT_DUTY, PHOSPHOR.cyan)).toBeCloseTo(1, 6);
    expect(targetBrightness(LIT_SEGMENT_DUTY / STROBES_PER_SWEEP, PHOSPHOR.cyan)).toBeLessThan(0.2);
  });
});

/**
 * Cycles the synthetic player below holds each lever lane for: 45 sweeps.
 *
 * Stated as a count of sweeps rather than the bare 40,000 cycles it used to be,
 * for the reason CLAUDE.md gives about literals in tests of a machine that
 * stops: 40,000 silently meant "at this instruction rate, for this sweep
 * length", and both moved when the core did. At today's `SWEEP_INSTRUCTIONS`
 * this is 40,005 cycles, or 0.686 s.
 *
 * What the figure has to satisfy is a floor and a ceiling, and 45 sweeps sits
 * between them with room either side. The floor is that the ROM samples each
 * strobe column once per sweep, so a dwell shorter than a few sweeps could be
 * missed entirely; the ceiling is that the 20 s window has to hold enough lane
 * moves for the gap distribution below to be a distribution, and this gives 29
 * of them. Nothing here is a measurement of the machine - it is how the drive
 * plays, and the assertions are about the gaps the sweep leaves while it does.
 */
const LANE_DWELL_CYCLES = 45 * SWEEP_INSTRUCTIONS;

describe('the blank threshold against the intervals it separates', () => {
  const cycles = seconds(20);
  const input = [{ cycle: 0, change: { skill: 1 } }];
  for (let at = 0, lane = 0; at < cycles; at += LANE_DWELL_CYCLES, lane = (lane + 1) % 3) {
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
