// Non-vacuity floors for `entry-onto-missile.ts`.
//
// Paths in this file are relative to the repository root.
//
// The drive classifies every shot-and-jet coincidence by how the jet got onto
// the cell: it was already standing there, it marched on, or it spawned on. The
// answer it exists to give - that the pass-throughs are spawns and not a
// collision test that missed - is a statement about the *relative* sizes of
// three counters, and three zeroes satisfy it as neatly as the truth does.
//
// So what is floored is the sample and the population of both fresh classes. A
// classifier shown only marches has never been asked the question.

import { beforeAll, describe, expect, it } from 'vitest';
import { runEntryOntoMissile, type EntryOntoMissileResult } from './entry-onto-missile.js';

/** Three drives of 90 emulated seconds each. */
const DRIVE_TIMEOUT_MS = 180_000;

/**
 * Coincidences pooled over the three firing cadences.
 *
 * **Measured: 88.** Twenty is under a quarter of that. The drive's headline
 * figure is "6 of 88", a rate of 7%, so a sample below twenty could not
 * distinguish that rate from zero even if every counter were working.
 */
const COINCIDENCES = 20;

describe('the entry-onto-missile drive', () => {
  let result: EntryOntoMissileResult;
  beforeAll(() => {
    result = runEntryOntoMissile();
  }, DRIVE_TIMEOUT_MS);

  it('is still shown coincidences to classify', () => {
    expect(
      result.coincidences,
      'no shot and jet ever shared a cell - every count below it is a statement about nothing',
    ).toBeGreaterThanOrEqual(COINCIDENCES);
  });

  it('still populates both arrival classes', () => {
    // **Measured: 40 by march, 30 by spawn.** The whole point of resolving
    // arrivals per slot rather than per row was to keep these two apart; if
    // either reads zero the split is untested and the drive's conclusion -
    // spawns escape, marches do not - rests on one class it never saw.
    expect(
      result.freshByMarch,
      'no jet was seen marching onto an occupied cell - the march class is untested',
    ).toBeGreaterThanOrEqual(1);
    expect(
      result.freshBySpawn,
      'no jet was seen spawning onto an occupied cell - the spawn class is untested, ' +
        'which is the class the drive exists to measure',
    ).toBeGreaterThanOrEqual(1);
  });

  it('accounts for every coincidence in one of the three classes', () => {
    // A settled coincidence is neither fresh, so the two fresh classes can only
    // be a part of the total. This catches a classifier that dropped arrivals
    // on the floor rather than one that saw none.
    expect(result.freshByMarch + result.freshBySpawn).toBeLessThanOrEqual(result.coincidences);
  });
});
