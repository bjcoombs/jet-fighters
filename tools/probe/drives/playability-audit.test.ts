// Non-vacuity floors for `playability-audit.ts`.
//
// Paths in this file are relative to the repository root.
//
// The second drive that died against the deleted lane rank, and the worse of the
// two: it reported **0 march steps and 0 releases on all three skills**, and its
// crossing test - the question the drive exists to answer - compared zeroes and
// reported no crossings. "No crossings" is also the right answer on a working
// ROM, so the dead instrument and the healthy one printed the same conclusion.
//
// That is why the floors here are on the crossing test's *inputs* rather than on
// its output. `CROSSINGS` is deliberately not asserted: zero is the finding, and
// `missile-rank.test.ts` is what pins the collision rule itself.

import { beforeAll, describe, expect, it } from 'vitest';
import { SKILLS, runPlayabilityAudit, type SkillAudit } from './playability-audit.js';

/** Three emulated games, one of which runs to a win at 230 s. */
const DRIVE_TIMEOUT_MS = 180_000;

/**
 * March steps per game.
 *
 * **Measured: 161, 51 and 71 at skills 1 to 3.** Ten is under a fifth of the
 * smallest, and the failure this catches was zero on all three.
 */
const STEPS = 10;

/**
 * Entries per game.
 *
 * **Measured: 59, 13 and 17.** Five is under half the smallest. A game with no
 * entries has no squadron and nothing the rest of the audit describes.
 */
const RELEASES = 5;

/**
 * Shots launched per game.
 *
 * **Measured: 143, 32 and 36.** The crossing test can see nothing without a shot
 * in flight, so this is the precondition that a zero crossing count means
 * anything at all.
 */
const FLIGHTS = 10;

/**
 * Frames in which a shot and a jet were in the same lane with both present.
 *
 * **Measured: 230, 84 and 63 same-cell frames**, against zero crossings. This is
 * the count that separates "the shot and the jet were compared and never
 * swapped untested" from "nothing was ever compared", and the dead drive read 0.
 */
const COMPARISONS = 10;

describe('the playability audit drive', () => {
  let audits: readonly SkillAudit[];
  beforeAll(() => {
    audits = runPlayabilityAudit();
  }, DRIVE_TIMEOUT_MS);

  it('still plays one game per skill', () => {
    expect(audits.map((audit) => audit.skill)).toEqual([...SKILLS]);
  });

  it('still sees the squadron march and enter on every skill', () => {
    for (const audit of audits) {
      expect(
        audit.steps,
        `skill ${audit.skill}: no march steps - the drive is not reading the squadron`,
      ).toBeGreaterThanOrEqual(STEPS);
      expect(
        audit.releases,
        `skill ${audit.skill}: no entries - the drive is not reading the squadron`,
      ).toBeGreaterThanOrEqual(RELEASES);
    }
  });

  it('still gets shots into the air for the crossing test to watch', () => {
    for (const audit of audits) {
      expect(
        audit.flights,
        `skill ${audit.skill}: nothing was fired, so no crossing could be observed`,
      ).toBeGreaterThanOrEqual(FLIGHTS);
    }
  });

  it('still compares a shot against a jet rather than comparing zeroes', () => {
    for (const audit of audits) {
      expect(
        audit.sameCell + audit.crossings,
        `skill ${audit.skill}: a shot and a jet were never in one lane together - ` +
          `CROSSINGS ${audit.crossings} is a statement about an empty sample`,
      ).toBeGreaterThanOrEqual(COMPARISONS);
    }
  });
});
