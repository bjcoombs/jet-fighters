// Non-vacuity floors for `march-tone-identity.ts`.
//
// Paths in this file are relative to the repository root.
//
// The drive's conclusion is a *negative* one - there is no per-step march note
// at ~66 s - and a negative conclusion is exactly what a broken instrument
// produces for free. A decoder that returned silence would find no tone
// anywhere, print a tidy empty table, exit 0, and read as agreement with the
// owner. So what is floored here is the drive's *positive* findings: that it
// decoded two recordings, that it located events at the cited timestamp, and
// that it found the sustained tones it says are there. The negative is only
// worth anything if the same pass, on the same files, can still find something.
//
// Like `loss-warning-partials.test.ts`, this needs `ffmpeg` to decode AAC. The
// `ci` workflow installs it, so the test never skips there; on a developer's
// machine without it, the test skips and says so.

import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  isSustainedTone,
  runMarchToneIdentity,
  sweepGrid,
  type MarchToneIdentityResult,
} from './march-tone-identity.js';

/** Decoding 154 s of audio across four files and sweeping it takes seconds. */
const DRIVE_TIMEOUT_MS = 180_000;

/**
 * Events the click-vs-tone test must find at the cited ~66 s.
 *
 * **Measured: 10 in the 2 s around it.** Four is well under that and far above
 * what a reader seeing silence could produce. The dominant-scatter figure is a
 * statistic over these events; with none of them it is a statistic over nothing.
 */
const CITED_EVENTS = 4;

/**
 * Sustained 625 Hz tones the drive must still find in `gameplay-audio.m4a`.
 *
 * **Measured: 3, at 12.600, 28.800 and 116.100 s.** One is the floor. This is
 * the finding that stops the drive's conclusion collapsing into "the decoder is
 * broken": the 600-650 Hz band does hold a real device sound, and the drive has
 * to be able to see it before its "not at 66 s" is worth reading.
 */
const GAMEPLAY_TONES = 1;

/**
 * The same, in the audio of the owner's skill-3 video.
 *
 * **Measured: 2, at 14.100 and 17.700 s.** One is the floor. The two files
 * agreeing is what makes the sound the machine's rather than one session's.
 */
const VIDEO_TONES = 1;

/** True when the decoder the drive needs is installed. */
function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ffmpeg = hasFfmpeg();

describe.skipIf(!ffmpeg && process.env['CI'] === undefined)(
  'the march tone identity drive',
  () => {
    let result: MarchToneIdentityResult;
    beforeAll(() => {
      expect(
        ffmpeg,
        'ffmpeg is not on PATH. The ci workflow installs it; if this failed there, ' +
          'the install step in .github/workflows/ci.yml is what to look at.',
      ).toBe(true);
      result = runMarchToneIdentity();
    }, DRIVE_TIMEOUT_MS);

    it('decoded every recording to something', () => {
      // Two files at first; five since the second pass added the three
      // IMG_6113 windows open-questions.md 16 classified.
      expect(result.files).toHaveLength(5);
      for (const f of result.files) {
        expect(
          f.durationSec,
          `${f.path} decoded to ${f.durationSec.toFixed(3)} s - every figure below it is ` +
            'then a statement about an empty buffer',
        ).toBeGreaterThan(19);
      }
    });

    it('still finds events at the timestamp the jetMarch entry cites', () => {
      expect(
        result.citedEvents.length,
        'no events at ~66 s. The dominant-scatter figure is a statistic over these; ' +
          'with none of them the drive reports "no march note" about a window it ' +
          'never looked into.',
      ).toBeGreaterThanOrEqual(CITED_EVENTS);
      for (const e of result.citedEvents) {
        expect(e.dominantHz, 'an event with no dominant frequency').toBeGreaterThan(0);
      }
    });

    it('still finds the sustained 625 Hz tones in both recordings', () => {
      const [gameplay, video] = result.files;
      expect(
        gameplay.episodes.filter(isSustainedTone).length,
        'no sustained tone in gameplay-audio.m4a. The drive concludes that the ' +
          '600-650 Hz band holds a real device sound which is not a march; if it ' +
          'can no longer find that sound, the conclusion is untested.',
      ).toBeGreaterThanOrEqual(GAMEPLAY_TONES);
      expect(
        video.episodes.filter(isSustainedTone).length,
        'no sustained tone in the skill-3 video audio',
      ).toBeGreaterThanOrEqual(VIDEO_TONES);
    });

    it('keeps its negative control negative', () => {
      // Not a floor but a ceiling, and the one assertion here that can fail by
      // the drive finding *too much*. battleship-interval.m4a was recorded to
      // isolate the boat; a sustained 625 Hz tone in it would mean the detector
      // is finding the boat or the room rather than the sound section 3 names.
      expect(
        result.battleshipEpisodes.filter(isSustainedTone),
        'the detector found a sustained tone in the isolated battleship recording, ' +
          'which contains no squadron - so whatever it is finding elsewhere is not ' +
          'specific to what section 3 claims',
      ).toEqual([]);
    });

    it('still finds both populations, in the windows that hold them', () => {
      // The whole second pass exists because a fixed gate hid one of these.
      // **Measured: 8 episodes of 280 ms or longer, 6 shorter.** If either
      // population empties, sections 3c and 3d are comparing one thing to
      // nothing and would report "two sounds" from a sample of one.
      expect(
        result.populations.long.count,
        'no long episodes - the sound task 23 measured has gone missing',
      ).toBeGreaterThanOrEqual(3);
      expect(
        result.populations.short.count,
        'no short episodes. This is the population a 200 ms gate hid the first ' +
          'time; if the drive stops seeing it, the fix has regressed to the bug',
      ).toBeGreaterThanOrEqual(3);
    });

    it('keeps the two populations distinguishable on partial structure', () => {
      // The claim in 3c is that these are two sounds, and it rests on this gap:
      // **measured 15.2-20.5 dB of partial excess for the long population
      // against 1.8-5.2 dB for the short.** A ratio table alone cannot fail -
      // in noise there is always a peak near a multiple - so the excess is what
      // carries the verdict, and it has to keep separating them.
      const longMin = Math.min(...result.populations.long.partialExcessDb);
      const shortMax = Math.max(...result.populations.short.partialExcessDb);
      expect(
        longMin - shortMax,
        'the two populations no longer separate on how far their partials stand ' +
          'over the neighbourhood, so "two sounds" is being read off nothing',
      ).toBeGreaterThan(5);
    });

    it('sweeps a grid that actually varies', () => {
      // A grid whose every cell is the same number is not a sweep, and would
      // hide exactly the sensitivity this pass was written to expose. The
      // t=210 window is where the gate bites: **measured 9 episodes at
      // (>=4 dB, >=50 ms) falling to 0 by (>=4 dB, >=200 ms).**
      const t210 = result.files.find((f) => f.path.includes('t210'));
      expect(t210, 'the t=210 window is missing').toBeDefined();
      const grid = sweepGrid((t210 as { episodes: never[] }).episodes);
      // Both axes, separately. Asserting only that *some* cell differs passes
      // when one axis has been collapsed and the other still moves - which is
      // the exact failure this test was written for, and the first version of
      // it did not catch a flattened continuity axis for that reason.
      const rowVaries = grid.some((row) => new Set(row).size > 1);
      const columns = grid[0].map((_, c) => grid.map((row) => row[c]));
      const columnVaries = columns.some((col) => new Set(col).size > 1);
      expect(
        rowVaries,
        'the count does not move as the continuity floor moves, so that axis of ' +
          'the sweep is not measuring anything',
      ).toBe(true);
      expect(
        columnVaries,
        'the count does not move as the comb threshold moves, so that axis of ' +
          'the sweep is not measuring anything',
      ).toBe(true);
      expect(Math.max(...grid.flat()), 'the sweep found nothing anywhere').toBeGreaterThanOrEqual(3);
    });

    it('keeps a tonality control that separates a tone from silence', () => {
      // The comb score is meaningless in absolute terms. If the known tone and
      // the known silence stop separating, every "is this a tone" verdict the
      // drive prints is being read off a broken ruler.
      const tone = result.combControls.find((c) => c.label.includes('win jingle'));
      const silence = result.combControls.find((c) => c.label.includes('gameplay 43.60'));
      expect(tone, 'the tone control is missing').toBeDefined();
      expect(silence, 'the silence control is missing').toBeDefined();
      expect(
        (tone as { combDb: number }).combDb - (silence as { combDb: number }).combDb,
        'the win jingle and room silence no longer separate on the comb score, so ' +
          'the score cannot support any tone-versus-noise verdict in this drive',
      ).toBeGreaterThan(5);
    });
  },
);
