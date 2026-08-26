// Non-vacuity floors for `missile-transit.ts`.
//
// Paths in this file are relative to the repository root.
//
// This drive is the one instrument here that measures the physical unit, so its
// failure modes are not the suite's usual ones. It cannot print a zero because
// the machine stopped being driven - there is no machine. It fails instead by
// **reading its input wrong and still producing a number**, which is exactly how
// the four earlier attempts on this recording failed.
//
// So three things are floored, not one:
//
// 1. The CSV still carries a usable sample. A regenerated CSV whose registration
//    collapsed leaves few `registered = 1` rows and the drive silently measures
//    the handful that survived.
// 2. Shots are still found, and still stand clear of the shuffled control. This
//    is the floor that matters: a linker that has stopped linking prints "0
//    tracks" and a linker that links anything prints a track count that its own
//    control also prints.
// 3. The rightward direction is still *not* measured. That reads oddly as an
//    assertion, and it is the deliberate one: the drive's second finding is a
//    negative, and a negative that quietly turns positive because a threshold
//    moved would be read as "the march cadence is in the recording after all".

import { beforeAll, describe, expect, it } from 'vitest';
import { runMissileTransit, type MissileTransitResult } from './missile-transit.js';

/**
 * Frames the CSV must still offer with the tube lit and the frame registered.
 *
 * **Measured: 526 of 697 (75%).** Four hundred is 13 seconds of the 23-second
 * recording - below that, a "median over 21 shots" is a median over whatever
 * fraction of the recording happened to survive, which is not the same figure.
 */
const USABLE_FRAMES = 400;

/**
 * Shots the drive must still link.
 *
 * **Measured: 21.** Ten still supports a median, and is seven times the
 * shuffled control's mean, so a run that scrapes this floor is reporting
 * something real even if the extraction has degraded.
 */
const SHOTS = 10;

/**
 * How far the shot count must stand above its own shuffled control.
 *
 * **Measured: z = +12.0** against a control mean of 2.5 +- 1.5. Six is half of
 * that and still far outside anything chance linking produces; the control's
 * own spread is what this is measured in, so it moves with the data rather than
 * against a fixed count.
 */
const SHOT_CONTROL_Z = 6;

/**
 * How close to chance the *rightward* count must stay.
 *
 * **Measured: z = -1.1** - one track against a control mean of 2.3 +- 1.2, which
 * is to say fewer than chance produces. Three deviations is the same bar the
 * drive prints "MEASURED" at, so this asserts the drive would not claim to have
 * found a squadron.
 */
const MARCH_CONTROL_Z = 3;

/**
 * Seconds per column, measured off the recording.
 *
 * The band is wide on purpose. What this test defends is not the third decimal
 * but the *conclusion*: the physical unit flies a shot several times faster than
 * `asm/jetfighter.asm`'s 0.500 s a column. Anything inside this band still says
 * that; anything outside it means the extraction has moved and the figure quoted
 * in `docs/evidence/` needs re-deriving rather than trusting.
 */
const SECONDS_PER_COLUMN = { min: 0.08, max: 0.25 } as const;

/** What the ROM does today, for the comparison the drive exists to make. */
const ROM_SECONDS_PER_COLUMN = 0.5;

describe('the missile transit drive', () => {
  let result: MissileTransitResult;
  beforeAll(() => {
    result = runMissileTransit();
  });

  it('still has a registered sample to measure', () => {
    expect(
      result.usableFrames,
      'the CSV carries too few registered, lit frames - re-run tools/trace/video-cells.py and check its lock rate',
    ).toBeGreaterThanOrEqual(USABLE_FRAMES);
    expect(result.frames).toBeGreaterThan(result.usableFrames);
  });

  it('still links shots leaving the G line', () => {
    expect(
      result.leftward.tracks.length,
      'no shots were linked - the drive would print a median over nothing',
    ).toBeGreaterThanOrEqual(SHOTS);
    expect(result.runs).toBeGreaterThan(result.leftward.tracks.length);
  });

  it('still finds more shots than chance linking produces', () => {
    expect(
      result.leftward.z,
      `shot tracks (${result.leftward.tracks.length}) no longer stand clear of the shuffled control ` +
        `(${result.leftward.shuffledMean.toFixed(1)}) - the linker is finding structure in noise`,
    ).toBeGreaterThan(SHOT_CONTROL_Z);
  });

  it('still declines to claim a march cadence from this recording', () => {
    expect(
      result.rightward.z,
      'rightward tracks now stand above chance - if that is real the recording has a squadron in it ' +
        'and open-questions.md is wrong, so re-derive rather than raise this bound',
    ).toBeLessThan(MARCH_CONTROL_Z);
  });

  it('still measures a shot crossing a column far faster than the ROM flies one', () => {
    expect(result.medianSecondsPerColumn).toBeGreaterThan(SECONDS_PER_COLUMN.min);
    expect(result.medianSecondsPerColumn).toBeLessThan(SECONDS_PER_COLUMN.max);
    expect(
      result.medianSecondsPerColumn,
      'the recording no longer disagrees with the ROM - which would be a finding, not a passing test',
    ).toBeLessThan(ROM_SECONDS_PER_COLUMN / 2);
  });

  it('still sees shots that cross the whole flying zone', () => {
    expect(
      result.fullTraverses.length,
      'no shot was tracked from the G line end of the flying zone to the far end - the seconds-scale ' +
        'measurement is the one that frame aliasing cannot reach, and it is gone',
    ).toBeGreaterThanOrEqual(3);
  });
});
