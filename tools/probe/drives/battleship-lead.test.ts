// Non-vacuity floors for `battleship-lead.ts`.
//
// Paths in this file are relative to the repository root.
//
// This drive is one of the five in `drives/README.md`'s list of instruments that
// stopped measuring anything without saying so. It was reading the deleted lane
// rank and reported a kill figure its own header no longer matched; the rebase
// onto the two-plane model repaired it. What is floored here is the *opportunity*
// count - boat arrivals seen and shots taken - because that is what goes to zero
// when a drive dies, and a zero prints as a finding.

import { beforeAll, describe, expect, it } from 'vitest';
import { GAMES, runBattleshipLead, type BattleshipLeadResult } from './battleship-lead.js';

/** Nine emulated games at 20 samples a second cost seconds of wall clock. */
const DRIVE_TIMEOUT_MS = 120_000;

describe('the battleship lead drive', () => {
  let result: BattleshipLeadResult;
  beforeAll(() => {
    result = runBattleshipLead();
  }, DRIVE_TIMEOUT_MS);

  it('is still offered boat crossings to shoot at', () => {
    // **The floor is one crossing per game.** The drive plays nine - every skill
    // against every starting lane - and each runs to a game over or to 300
    // emulated seconds, which is eight times the parked-lever ending. A game
    // that never showed the boat is a game this drive learned nothing from.
    // Measured on this ROM: 21 crossings, so the floor sits at 43% of the
    // observation and a shortfall means arrivals stopped rather than that the
    // sample wobbled.
    expect(
      result.crossings,
      'no boat arrivals - the drive has nothing to lead and its figure is vacuous',
    ).toBeGreaterThanOrEqual(GAMES);
  });

  it('still gets a free barrel when the boat enters', () => {
    // The drive fires at most one shot per crossing, so shots can only fall
    // short of crossings when the barrel was busy every time the boat entered.
    // Measured: 21 shots against 21 crossings.
    expect(
      result.shots,
      'crossings were seen but nothing was fired at them - the barrel was never free',
    ).toBeGreaterThanOrEqual(GAMES);
  });

  it('still lands the kill its header says leading by two buys', () => {
    // An outcome rather than an opportunity, and it is here because it is the
    // drive's whole claim: aiming where the boat *is* took 18 shots over 11
    // crossings for nothing, and leading by two connects. **Measured on this
    // ROM: 3 kills in 21 shots**, so the margin over this floor is thin by
    // design. Zero does not mean flake - it means the header's finding is no
    // longer re-derivable and the drive must be re-read before it is quoted.
    expect(
      result.kills,
      'leading by two no longer connects - re-read the drive before quoting its finding',
    ).toBeGreaterThanOrEqual(1);
  });
});
