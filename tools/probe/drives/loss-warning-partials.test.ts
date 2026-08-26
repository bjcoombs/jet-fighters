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
    },
    DRIVE_TIMEOUT_MS,
  );
});
