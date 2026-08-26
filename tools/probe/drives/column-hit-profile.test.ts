// Non-vacuity floors for `column-hit-profile.ts`.
//
// Paths in this file are relative to the repository root.
//
// **This is the drive the whole guard was written for.** It reads the squadron
// to find a plane standing on the column it means to aim at; when the lane rank
// it read was deleted, every read returned 0, `planeRowOn` never matched, and it
// fired **0 shots at every one of the five columns**. It then printed "no kills"
// five times and that read as a finding rather than as a dead instrument. It
// stayed dead for a whole tag.
//
// The floors below are the two counts that were zero: shots offered per target,
// and kills scored at all.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  TARGETS,
  killsIn,
  runColumnHitProfile,
  type ColumnProfile,
} from './column-hit-profile.js';

/** Five emulated games at 20 samples a second - the slowest drive in this directory. */
const DRIVE_TIMEOUT_MS = 180_000;

/**
 * The floor for grid 1, which is genuinely rare and gets its own number.
 *
 * A plane at grid 1 is one march step from the G line, so the drive is seldom
 * offered one: **measured at 6 shots**, against 48 to 185 at the other four
 * columns. One shot is the floor because one is the difference between "the
 * sample is small" - which the drive's header already says - and "the reader is
 * broken", which is what happened.
 */
const RARE_TARGET_SHOTS = 1;

/**
 * The floor for the other four columns.
 *
 * **Measured: 48, 185, 147 and 76 shots at grids 2 to 5.** Ten is under a fifth
 * of the smallest of those, wide enough that a cadence change moving the shot
 * rate does not trip it and narrow enough that a reader returning nothing does.
 */
const COMMON_TARGET_SHOTS = 10;

/**
 * The floor for kills pooled over all five games.
 *
 * **Measured: 311.** The number matters far less than its being non-zero: five
 * consecutive "no kills" lines are the exact output this drive produced while
 * dead, and one kill anywhere is enough to say the profile is a profile.
 */
const TOTAL_KILLS = 5;

describe('the column hit profile drive', () => {
  let profiles: readonly ColumnProfile[];
  beforeAll(() => {
    profiles = runColumnHitProfile();
  }, DRIVE_TIMEOUT_MS);

  it('still plays one game per target column', () => {
    expect(profiles.map((profile) => profile.target)).toEqual([...TARGETS]);
  });

  it('is still offered a shot at every column it aims at', () => {
    // The assertion that would have caught the incident on the day it happened.
    const shots = Object.fromEntries(profiles.map((p) => [`grid ${p.target}`, p.shots]));
    for (const profile of profiles) {
      const floor = profile.target === 1 ? RARE_TARGET_SHOTS : COMMON_TARGET_SHOTS;
      expect(
        profile.shots,
        `no shots were offered at grid ${profile.target} - the drive is reading a rank ` +
          `that no longer holds planes. Shots by target: ${JSON.stringify(shots)}`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it('still scores kills rather than printing "no kills" five times', () => {
    const total = profiles.reduce((sum, profile) => sum + killsIn(profile), 0);
    expect(
      total,
      'no kills at any column - "no kills" printed five times is what a dead drive looks like',
    ).toBeGreaterThanOrEqual(TOTAL_KILLS);
  });
});
