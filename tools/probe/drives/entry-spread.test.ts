// Non-vacuity floors for `entry-spread.ts`.
//
// Paths in this file are relative to the repository root.
//
// The drive histograms where planes enter and how far apart the two of them
// stand. Both halves are ratios over a sample the drive collects itself, so both
// divide by a denominator that a broken reader sets to zero: an entry histogram
// over no entries prints nothing at all, and a gap histogram over no samples
// prints nothing while the drive still exits 0.
//
// `entry-position.test.ts` is what asserts *where* entries land. What is floored
// here is only that the drive still collects a sample to describe.

import { beforeAll, describe, expect, it } from 'vitest';
import { runEntrySpread, type EntrySpreadResult } from './entry-spread.js';

/** Five drives of 90 emulated seconds each. */
const DRIVE_TIMEOUT_MS = 180_000;

/**
 * Entries pooled over the five firing cadences.
 *
 * **Measured: 298 across six cells.** Fifty is a sixth of that - ten entries a
 * cell, enough that a percentage in the printed histogram means something - and
 * far above what a reader that had stopped seeing the squadron could produce.
 */
const ENTRIES = 50;

/**
 * Frames in which both slots held a plane.
 *
 * **Measured: 23,837.** This is the gap histogram's denominator, and the gap
 * histogram is the half of the drive that answers whether the squadron marches
 * in lockstep. A thousand frames is 5 emulated seconds of both planes airborne
 * across five 90-second drives - the least that could be called a sample.
 */
const GAP_SAMPLES = 1000;

describe('the entry spread drive', () => {
  let result: EntrySpreadResult;
  beforeAll(() => {
    result = runEntrySpread();
  }, DRIVE_TIMEOUT_MS);

  it('still sees planes enter', () => {
    expect(
      result.total,
      'no entries were observed - the entry histogram divides by zero and prints nothing',
    ).toBeGreaterThanOrEqual(ENTRIES);
    expect(result.entries.reduce((sum, [, count]) => sum + count, 0)).toBe(result.total);
  });

  it('still catches both planes airborne together', () => {
    expect(
      result.gapSamples,
      'the two planes were never airborne at once - the column gap has no sample',
    ).toBeGreaterThanOrEqual(GAP_SAMPLES);
    // A histogram of the gap is only a histogram if it has a bucket.
    expect(result.gaps.length).toBeGreaterThanOrEqual(1);
  });
});
