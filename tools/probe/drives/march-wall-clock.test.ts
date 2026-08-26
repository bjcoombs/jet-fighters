// Non-vacuity floors for `march-wall-clock.ts`.
//
// Paths in this file are relative to the repository root.
//
// The drive times march steps and groups them by the rung they ran on. Every
// line it prints is a median over a group it collected itself, so a reader that
// had stopped seeing the countdown would print nothing at all and exit 0 - the
// shape of failure `drives/README.md` records five times over.
//
// Two things are floored, and they are different in kind. The first is that
// steps were timed at all. The second is that the *played* drive still walks the
// ladder: a drive that stopped scoring would report one rung per skill and the
// whole descent - the half of the answer the owner's speed complaint turns on -
// would silently be missing while the drive still printed three tidy rows.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  DOCUMENTED_FLOOR_SWEEPS,
  runMarchWallClock,
  SKILLS,
  sweepsFor,
  type MarchWallClockResult,
} from './march-wall-clock.js';

/** Six drives of 120 emulated seconds each. */
const DRIVE_TIMEOUT_MS = 180_000;

/**
 * March steps the idle condition times.
 *
 * **Measured: 29** across the three skills - 8, 8 and 13, the skills differing
 * because a faster rung fits more steps into the same 120 s. Fifteen is half of
 * that, and far above what a reader that had lost the countdown could produce.
 */
const IDLE_STEPS = 15;

/**
 * March steps the played condition times.
 *
 * **Measured: 158.** Fifty is under a third of it. The played drive is the one
 * that can go quiet without erroring - it depends on the blind drive still
 * scoring, and a scoring path that broke would leave it pinned on one rung.
 */
const PLAYED_STEPS = 50;

/**
 * Distinct rungs the played drive reaches at each skill.
 *
 * **Measured: 6, 6 and 5** at skills 1, 2 and 3. Three is what makes the printed
 * table a descent rather than a single reading, and it is the assertion that
 * catches a drive that has stopped killing anything - `NIB_KILLS` is what walks
 * the ladder, and a drive whose shots stopped connecting would report the entry
 * rung and nothing else.
 */
const RUNGS_PER_SKILL = 3;

describe('the march wall-clock drive', () => {
  let result: MarchWallClockResult;
  beforeAll(() => {
    result = runMarchWallClock();
  }, DRIVE_TIMEOUT_MS);

  it('still times march steps in both conditions', () => {
    expect(result.idle.length, 'idle march steps timed').toBeGreaterThanOrEqual(IDLE_STEPS);
    expect(result.played.length, 'played march steps timed').toBeGreaterThanOrEqual(PLAYED_STEPS);
  });

  it('still walks the ladder down at every skill', () => {
    for (const skill of SKILLS) {
      const rungs = new Set(
        result.played.filter((step) => step.skill === skill).map((step) => step.stepHi),
      );
      expect(
        rungs.size,
        `distinct rungs reached at skill ${skill} - a drive that stopped scoring reports one`,
      ).toBeGreaterThanOrEqual(RUNGS_PER_SKILL);
    }
  });

  it('runs each rung for exactly the sweeps that rung asks for', () => {
    // Not a floor - the check that the instrument is reading the right thing.
    // The interval and the rung are read from two different places (the sweep
    // counter and `STEP_HI`), so their agreeing is evidence that the step
    // detector is on the countdown rather than on some other nibble's traffic.
    // It is also what caught the first version of this drive, which sampled on a
    // cycle budget, saw the low nibble's wrap as a reload, and reported 16-sweep
    // marches at every skill.
    expect(result.idle.length).toBeGreaterThan(0);
    const wrong = result.idle.filter((step) => step.sweeps !== sweepsFor(step.stepHi));
    expect(wrong.slice(0, 5), `${wrong.length} idle intervals disagree with their rung`).toEqual([]);
  });

  it('reaches a rung below the floor its own constants document', () => {
    // **This is a finding, asserted so it cannot quietly stop being true.**
    // `STEP_HI_MIN` is documented in `asm/jetfighter.asm` as "the floor: 32
    // sweeps, 488 ms", but `step_reload` applies it only when `STEP_HI_MAX -
    // kills - STEP_SKILL * (skill - 1)` *underflows*. At skill 3 with four kills
    // that expression is exactly 0, which does not underflow, so `STEP_HI` is
    // written as 0 and the squadron steps every 16 sweeps - half the documented
    // floor, and 325 ms of measured wall clock.
    //
    // `march-cadence.test.ts` carries the paired assertion, as an `it.fails()`,
    // in the form the rule should hold. This one records what the machine does
    // now, so that a fix to `step_reload` turns *both* red at once: this one
    // because the rung is no longer reachable, that one because it starts
    // passing. Neither may be weakened to green a branch - together they are the
    // only thing standing between this and being rediscovered a third time.
    const reached = Math.min(...result.played.map((step) => sweepsFor(step.stepHi)));
    expect(reached, 'fastest rung a played game reached, in sweeps').toBeLessThan(
      DOCUMENTED_FLOOR_SWEEPS,
    );
  });
});
