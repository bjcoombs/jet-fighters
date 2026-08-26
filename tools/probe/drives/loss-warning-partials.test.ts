// Non-vacuity floors for `loss-warning-partials.ts`.
//
// Paths in this file are relative to the repository root.
//
// **This drive is the odd one out in this directory, twice over**, and both
// reasons decided the shape of this file.
//
//   - It measures a *recording*, not the machine, so it shells out to `ffmpeg`
//     to decode `assets/reference/loss-audio.m4a` from AAC. A clean checkout
//     without ffmpeg cannot run it at all. The `ci` workflow installs ffmpeg if
//     the runner does not already have it, so this test is never skipped there;
//     on a developer's machine without it, the test skips and says so.
//   - It is a script whose body *is* its output: 700 lines of top-level
//     computation printing five sections, with no result to return. The other
//     drives export their figures and are imported here; refactoring this one
//     the same way would reindent the whole file for no measurement gained. It
//     is run as a subprocess instead and its printed figures are read back.
//
// Reading stdout is the fragile option, and it is chosen here knowingly: if the
// printed format changes, this test fails loudly rather than passing over a
// number it did not find. That is the correct direction for the failure. What is
// floored is what the drive *found in the recording* - a decoded signal, three
// beeps located, and a burst sweep that returned events - because an audio
// analysis whose detector finds nothing prints a tidy empty table and exits 0.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The drive, and the vite-node that can run a TypeScript entry point. */
const DRIVE = fileURLToPath(new URL('./loss-warning-partials.ts', import.meta.url));
const VITE_NODE = fileURLToPath(new URL('../../../node_modules/vite-node/dist/cli.mjs', import.meta.url));

/** Decoding 88 s of audio and sweeping it costs a couple of seconds. */
const DRIVE_TIMEOUT_MS = 120_000;

/** True when the decoder the drive needs is installed. */
function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The recording's length in seconds, from the drive's first line.
 *
 * **Measured: 88.619 s.** A decode that produced no samples reports 0.000 s and
 * every section downstream then measures silence, so the length is the first
 * thing worth a floor.
 */
const RECORDING_S = 80;

/**
 * Bursts the isolation sweep must find over the whole recording.
 *
 * **Measured: 29 bursts, 19 of them isolated, in 2 groups of two or more.** Ten
 * is a third of that. The sweep is "the whole basis of the n = figure" by the
 * drive's own words, and a detector returning nothing would report n = 0 - which
 * reads as a finding about the recording rather than as a broken detector.
 */
const BURSTS = 10;

/**
 * How far section 6's per-beep dominant must still move across its 35 readings.
 *
 * **Measured: 1088, 1196 and 699 Hz.** Two hundred is a floor well under all
 * three. This one is the odd assertion in the file, because the drive's finding
 * *is* the spread: a per-beep pitch is not a determined quantity here. A reader
 * that returned the same number for every window - a spectrum function handed an
 * empty slice, say - would print a spread of 0 Hz and that would read as the
 * opposite conclusion, tidily and wrongly.
 */
const DOMINANT_SPREAD_HZ = 200;

/**
 * Separation the tonality control must keep, in dB.
 *
 * **Measured: 12.9 dB for the win jingle against 4.7 dB for room silence, a
 * separation of 8.2.** Five is the floor. Section 7 concludes that the loss
 * sound has no pitch by scoring near the silence control; if the ruler stops
 * separating a known tone from a known silence, that conclusion is being read
 * off nothing.
 */
const TONALITY_SEPARATION_DB = 5;

/**
 * Candidate burst groups section 9 must still find in `gameplay-audio.m4a`.
 *
 * **Measured: 22 at the +15 dB setting the drive is tuned to.** Three is the
 * floor. Section 9 exists to answer whether "n = 1" in `loss-audio.m4a` is a
 * blind detector or a limitation of that recording, and it answers "not blind"
 * by finding groups in the other file. A detector that found none there would
 * make the section say the opposite of what it measured.
 */
const GAMEPLAY_GROUPS = 3;

describe('the loss warning partials drive', () => {
  const ffmpeg = hasFfmpeg();

  // Skipping is the honest answer on a machine without the decoder, and a
  // silent skip in CI is exactly the gap this task exists to close - so CI is
  // required to have it rather than trusted to.
  it.skipIf(!ffmpeg && process.env['CI'] === undefined)(
    'still finds beeps and bursts in the reference recording',
    () => {
      expect(
        ffmpeg,
        'ffmpeg is not on PATH. The ci workflow installs it; if this failed there, ' +
          'the install step in .github/workflows/ci.yml is what to look at.',
      ).toBe(true);

      const stdout = execFileSync(process.execPath, [VITE_NODE, DRIVE], {
        encoding: 'utf8',
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        maxBuffer: 16 * 1024 * 1024,
      });

      // 1. The recording decoded to something.
      const decoded = /loss-audio\.m4a: ([\d.]+) s at (\d+) Hz/.exec(stdout);
      expect(decoded, `the drive did not report a decode:\n${stdout}`).not.toBeNull();
      expect(Number((decoded as RegExpExecArray)[1])).toBeGreaterThan(RECORDING_S);

      // 2. Section 1 located its three beeps. Rows look like
      //    "   1    27.3850         269     196-344       29.6 dB     -1.5 dB".
      const beeps = [...stdout.matchAll(/^\s+([123])\s+(\d+\.\d{4})\s+(\d+)\s/gm)];
      expect(
        beeps.length,
        'section 1 found no beeps to take a spectrum of - every per-beep figure it ' +
          `prints is then a statement about a window with nothing in it:\n${stdout}`,
      ).toBe(3);
      for (const beep of beeps) {
        expect(Number(beep[3]), 'a beep with no dominant frequency').toBeGreaterThan(0);
      }

      // 3. Section 5's sweep found events, and grouped at least one of them.
      const sweep = /bursts in range: (\d+);\s+isolated: (\d+);\s+groups of 2\+: (\d+)/.exec(stdout);
      expect(sweep, `section 5 printed no sweep summary:\n${stdout}`).not.toBeNull();
      const [, inRange, isolated, groups] = sweep as RegExpExecArray;
      expect(
        Number(inRange),
        'the isolation sweep found no bursts in 88 s of a recording of a machine making noise',
      ).toBeGreaterThanOrEqual(BURSTS);
      expect(Number(isolated), 'no burst was isolated').toBeGreaterThanOrEqual(1);
      expect(Number(groups), 'no burst group was formed').toBeGreaterThanOrEqual(1);

      // 4. n, the figure section 5 exists to produce.
      const n = /n = (\d+) beep group\(s\) in play/.exec(stdout);
      expect(n, `the drive printed no n:\n${stdout}`).not.toBeNull();
      expect(
        Number((n as RegExpExecArray)[1]),
        'n = 0: no beep group before the loss sound, which is the sample every ' +
          'figure in audio-reference.md is drawn from',
      ).toBeGreaterThanOrEqual(1);

      // 5. Section 6 still moved the window and got different answers.
      const spread = /Per-beep spread: ([\d.]+) Hz, ([\d.]+) Hz, ([\d.]+) Hz/.exec(stdout);
      expect(spread, `section 6 printed no spread summary:\n${stdout}`).not.toBeNull();
      for (const value of (spread as RegExpExecArray).slice(1)) {
        expect(
          Number(value),
          'a per-beep dominant that does not move when the window moves. Section 6 ' +
            'concludes the reading is undetermined *because* it swings by ~1 kHz; a ' +
            'spread of zero is what a spectrum of an empty slice produces, and it ' +
            'would read as the opposite finding',
        ).toBeGreaterThan(DOMINANT_SPREAD_HZ);
      }

      // 6. Section 7's ruler still separates a known tone from known silence.
      const jingle = /CONTROL gameplay 121\.00 s, the win jingle\s+\d+ Hz\s+(-?[\d.]+) dB/.exec(stdout);
      const quiet = /CONTROL gameplay 43\.60 s, room silence\s+\d+ Hz\s+(-?[\d.]+) dB/.exec(stdout);
      expect(jingle, `section 7 printed no tone control:\n${stdout}`).not.toBeNull();
      expect(quiet, `section 7 printed no silence control:\n${stdout}`).not.toBeNull();
      expect(
        Number((jingle as RegExpExecArray)[1]) - Number((quiet as RegExpExecArray)[1]),
        'the comb score no longer separates the win jingle from room silence, so ' +
          'section 7\'s "the loss sound has no pitch" is being read off a broken ruler',
      ).toBeGreaterThan(TONALITY_SEPARATION_DB);

      // 7. Section 8 still segmented the loss sound into something.
      const maxima = /(\d+) maxima within 25 dB of the peak, (\d+) counting the tail/.exec(stdout);
      expect(maxima, `section 8 printed no segmentation:\n${stdout}`).not.toBeNull();
      expect(
        Number((maxima as RegExpExecArray)[1]),
        'the envelope segmenter found no maxima in the loss sound - it is then ' +
          'reporting a note count for a window it heard nothing in',
      ).toBeGreaterThanOrEqual(2);

      // 8. Section 9 still found groups in the *other* recording.
      const gameplayRow = /\+15 dB\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(
        stdout.slice(stdout.indexOf('9. The same detector')),
      );
      expect(gameplayRow, `section 9 printed no sweep of gameplay-audio.m4a:\n${stdout}`).not.toBeNull();
      expect(
        Number((gameplayRow as RegExpExecArray)[3]),
        'the detector found no groups in gameplay-audio.m4a. Section 9 concludes it ' +
          'is not blind by finding some there; with none, the section asserts the ' +
          'opposite of what it measured',
      ).toBeGreaterThanOrEqual(GAMEPLAY_GROUPS);
    },
    DRIVE_TIMEOUT_MS,
  );
});
