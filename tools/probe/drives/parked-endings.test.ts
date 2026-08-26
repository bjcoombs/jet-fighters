// Non-vacuity floors for `parked-endings.ts`, and the ceilings it re-derives.
//
// Paths in this file are relative to the repository root.
//
// This drive is the re-derivation for every constant in
// `tools/probe/game-horizons.ts`, and those constants set the horizon of eight
// other suites. Until now nothing checked that they were still ceilings: the
// drive printed "NO LONGER A CEILING" into a terminal nobody was reading, which
// is the same standing the two constants had when they drifted to two values in
// three files.
//
// Two things are asserted, and they fail differently:
//
//   - **Non-vacuity.** A last speaker edge of 0 means the drive never heard the
//     machine; an edge at the 90 s ceiling means the game had not ended when the
//     drive gave up, so the figure is a property of `CEILING_S` rather than of
//     the machine. Both print a number that looks like a measurement.
//   - **The ceilings hold.** Each measured ending is under the constant that
//     claims to bound it. This is the assertion the drive's own
//     "NO LONGER A CEILING" line was making to nobody.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  CEILING_S,
  runParkedEndings,
  type ParkedEndingsResult,
} from './parked-endings.js';
import {
  PARKED_GAME_END_S,
  UNATTENDED_SILENCE_ANY_SKILL_S,
  UNATTENDED_SILENCE_S,
} from '../game-horizons.js';

/** Seven runs to a 90 s ceiling each. */
const DRIVE_TIMEOUT_MS = 180_000;

/**
 * The floor a real ending has to clear, in seconds.
 *
 * Not zero, because zero is not the only broken answer: a drive that heard one
 * edge at power-on and nothing after would report a fraction of a second. The
 * shortest ending measured on this ROM is **19.702 s** (skill 2, lever
 * untouched), so one second is under a twentieth of the smallest real figure and
 * cannot be reached by an ending that happened.
 */
const FLOOR_S = 1;

describe('the parked endings drive', () => {
  let result: ParkedEndingsResult;
  beforeAll(() => {
    result = runParkedEndings();
  }, DRIVE_TIMEOUT_MS);

  it('still hears a machine that stops, in all seven runs', () => {
    const runs: readonly (readonly [string, number])[] = [
      ...result.byLane.map((seconds, lane) => [`lever parked in lane ${lane}`, seconds] as const),
      ['no contact closed at all', result.untouched] as const,
      ...result.bySkill.map(
        (seconds, index) => [`skill ${index + 1}, lever untouched`, seconds] as const,
      ),
    ];
    expect(runs).toHaveLength(7);
    for (const [what, seconds] of runs) {
      expect(
        seconds,
        `${what}: no speaker edge worth the name - the drive measured silence, not an ending`,
      ).toBeGreaterThan(FLOOR_S);
      expect(
        seconds,
        `${what}: the game had not ended at the ${CEILING_S} s ceiling, so this figure ` +
          'is a property of the ceiling rather than of the machine',
      ).toBeLessThan(CEILING_S);
    }
  });

  it('still finds PARKED_GAME_END_S a ceiling', () => {
    const latest = Math.max(...result.byLane);
    expect(
      latest,
      `the latest parked-lever ending is past PARKED_GAME_END_S - every horizon derived ` +
        'from it in tools/probe/ is now short of the ending it was meant to contain',
    ).toBeLessThanOrEqual(PARKED_GAME_END_S);
  });

  it('still finds UNATTENDED_SILENCE_S a ceiling', () => {
    expect(
      result.untouched,
      'the unattended machine now outlives UNATTENDED_SILENCE_S',
    ).toBeLessThanOrEqual(UNATTENDED_SILENCE_S);
  });

  it('still finds UNATTENDED_SILENCE_ANY_SKILL_S a ceiling', () => {
    expect(
      Math.max(result.untouched, ...result.bySkill),
      'some skill setting now outlives UNATTENDED_SILENCE_ANY_SKILL_S',
    ).toBeLessThanOrEqual(UNATTENDED_SILENCE_ANY_SKILL_S);
  });
});
