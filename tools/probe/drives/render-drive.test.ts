// What a player sees, driven through the real renderer.
//
// Paths in this file are relative to the repository root.
//
// These are the two reports that motivated `render-drive.ts`, turned into
// assertions so the answers do not have to be re-derived. Both were reported
// against the deployed build and neither reproduced; what is pinned here is the
// property each report would have violated, so that if one ever starts
// happening the suite says so instead of a person noticing.
//
// See `docs/evidence/playability-audit.md` for the measurements these came
// from, and section 8 of it for why a drive must not choose its own frame
// accessor.

import { describe, expect, it } from 'vitest';
import { createRenderDrive } from './render-drive.js';

/** Long enough for a battleship crossing and its departure, measured at 19.8 s onset to onset. */
const CROSSING_SECONDS = 20;

/** `NIB_BSLANE` in `FILE_STATE`, and its value when no crossing is in progress. */
const FILE_STATE = 4;
const NIB_BSLANE = 9;
const BS_NONE = 15;

/** A drive of a whole crossing costs seconds of wall clock on a slow runner. */
const DRIVE_TIMEOUT_MS = 60_000;

const BOATS = ['battleship_lane0', 'battleship_lane1', 'battleship_lane2'] as const;
const BURSTS = [
  'battleship_burst_lane0',
  'battleship_burst_lane1',
  'battleship_burst_lane2',
] as const;

/** Above this a segment is being shown rather than decaying or ghosting. */
const LIT = 0.25;

describe('the battleship on the glass', () => {
  it(
    'never lights two rows at once, across a whole crossing and its departure',
    () => {
      // The report: "when the ship goes down to the bottom then disapears, all
      // ships light up on all rows for a brief moment". The ROM cannot express
      // that - `rd_bship` skips the draw when the lane is BS_NONE and
      // `lane_bit` yields exactly one of 1/2/4 - but the report was about the
      // glass, so it is the glass that is checked.
      const drive = createRenderDrive({ skill: 1 });
      let sawTheBoat = false;
      let sawItLeave = false;
      let worstRowsLit = 0;

      const frames = Math.round((CROSSING_SECONDS * 1000) / (1000 / 60));
      for (let i = 0; i < frames; i += 1) {
        drive.frame();
        const lane = drive.machine.ram[FILE_STATE * 16 + NIB_BSLANE] as number;
        if (lane !== BS_NONE) sawTheBoat = true;
        else if (sawTheBoat) sawItLeave = true;
        const rows = BOATS.filter((id) => drive.brightnessOf(id) > LIT).length;
        const bursts = BURSTS.filter((id) => drive.brightnessOf(id) > LIT).length;
        worstRowsLit = Math.max(worstRowsLit, rows, bursts);
      }

      // Preconditions, so this cannot pass over a drive where no boat ever came.
      expect(sawTheBoat, 'no battleship crossed - the drive never reached its case').toBe(true);
      expect(sawItLeave, 'the crossing never ended - the departure went untested').toBe(true);
      expect(worstRowsLit).toBe(1);
    },
    DRIVE_TIMEOUT_MS,
  );
});

describe('the tube after an ending', () => {
  it(
    'blanks once for the ending sound and then holds a steady picture',
    () => {
      // The report: "when you die the screen flashes and the flashes are slow".
      // What the machine does is blank once while the ROM bit-bangs the ending
      // sound - it cannot strobe and sound at the same time - and then hold.
      // Repeated flashing is what this pins against.
      const drive = createRenderDrive({ skill: 1 });
      const NIB_STATE = 11;

      // Never fire: three captures end the game inside a minute.
      let endedAt = -1;
      const lit: boolean[] = [];
      for (let i = 0; i < 60 * 90 && (endedAt < 0 || i - endedAt < 60 * 15); i += 1) {
        drive.frame();
        if (endedAt < 0 && (drive.machine.ram[FILE_STATE * 16 + NIB_STATE] as number) !== 0) {
          endedAt = i;
        }
        if (endedAt >= 0) lit.push(drive.machine.getLitSegments().length > 0);
      }

      expect(endedAt, 'the game never ended - the ending went untested').toBeGreaterThan(0);
      expect(lit.length, 'no frames were observed after the ending').toBeGreaterThan(60 * 10);

      const alternations = lit.filter((value, index) => index > 0 && lit[index - 1] !== value).length;
      // One blank for the sound, so at most one edge into it and one out of it.
      expect(alternations).toBeLessThanOrEqual(2);
    },
    DRIVE_TIMEOUT_MS,
  );
});
