// Non-vacuity floors for `score-windows.ts`.
//
// Paths in this file are relative to the repository root.
//
// This drive shares `missile-transit.ts`'s failure modes - it measures a
// recording, not a machine, so it cannot print a zero because the machine
// stopped being driven - and it has one of its own that no other drive here has.
//
// **Its subject is mostly darkness.** The readout is unlit for more of this clip
// than it is lit, so an extraction that has come loose does not print an obvious
// zero: it prints a shorter census, and a shorter census of an intermittent
// readout looks exactly like the readout being intermittent. Four hand readings
// of this footage reached merged documents and were wrong; one of them,
// "21.33 s, SCORE 20", was read off a frame with **0 lit pixels**.
//
// So four things are floored, in increasing order of how specific they are:
//
// 1. There is a census at all - windows found, frames lit.
// 2. The census still depends on the floor it is taken at. A window-finder that
//    returns the same answer at any threshold has stopped measuring brightness.
// 3. The clipping flag still picks exactly the two clipped windows. It once
//    flagged fourteen of fifteen while missing the blown final flash it was
//    written for, and `score_windows.py`'s header says not to trim this check.
// 4. Named frames still read the way the documents that cite them say. Three
//    anchors lit at the exact counts §15 cites, and the fabricated row's frame
//    still dark.
//
// **What is deliberately not asserted: what the digits said.** Segment decoding
// is not reliable on this footage - see `score_windows.py` - so the readings in
// `open-questions.md` §15 and §15a are human, taken off the labelled contact
// sheet, and cited against the frame index and lit-pixel count this drive
// re-derives. Asserting a decoded digit here would be asserting a number no
// committed tool produces.

import { describe, expect, it } from 'vitest';
import {
  FRAMES_PER_SECOND,
  runScoreWindows,
  windowAt,
  windowsAtFloor,
  frameAt,
  type ScoreWindowsResult,
} from './score-windows.js';

const result: ScoreWindowsResult = runScoreWindows();

/**
 * Windows the census must still hold.
 *
 * **Measured: 15.** Twelve is three below that, which is the whole end-of-game
 * flash train minus one; below it the "nine separate windows after 17.00 s" that
 * §15a corrects §15 with is no longer what the recording says, and the
 * correction needs re-deriving rather than trusting.
 */
const WINDOWS = 12;

/**
 * Frames the digits must still be lit in.
 *
 * **Measured: 498 of 697 (71%).** Fifty is a tenth of that and two seconds of a
 * 23-second recording. It is the vacuity floor rather than a tight one: below
 * fifty, a census of "when was the readout legible" is a census of whatever
 * survived, and the counts backing the citations in `open-questions.md` are
 * being taken from a handful of frames.
 */
const LIT_FRAMES = 50;

/**
 * The two clipped windows, by their first frame.
 *
 * **Measured: peak luminance 247 at f20 and 255 at f658, against 207-219 on the
 * other thirteen windows.** Both ends of this matter. The final flash at
 * 21.93-21.97 s is the one the flag was written for - its tens digit reads 3
 * where every reading before it reads 2, and whether that is real is open, so a
 * panel that cannot be trusted must say so. And the count must stay at two: an
 * earlier version of this flag fired on fourteen of fifteen windows and missed
 * the final flash entirely, which is a flag anti-correlated with its own
 * subject.
 */
const CLIPPED_WINDOW_STARTS = [6, 658];

/**
 * Frames whose lit-pixel counts back a reading quoted in `open-questions.md`.
 *
 * The counts are asserted exactly. They are the counts §15 cites, read off the
 * committed CSV this drive reads, so a regenerated crop that moves them fails
 * here rather than leaving the citations quoting a number nothing produces any
 * more. A floor would not do that: any count above forty would pass while the
 * cited figure went stale.
 *
 * What is still not asserted is the digit. The crop is a different scale from
 * the registered stack the readings were first taken on, so what carries across
 * to `open-questions.md` is the frame index and the readout being lit, and the
 * reading itself stays human.
 */
const ANCHORS = [
  { frame: 399, seconds: 13.3, reading: 'SCORE 18', litPixels: 1078 },
  { frame: 441, seconds: 14.7, reading: 'SCORE 20', litPixels: 1396 },
  { frame: 495, seconds: 16.5, reading: 'SCORE 20', litPixels: 1332 },
] as const;

/**
 * The frame the fabricated row was written from.
 *
 * 21.33 s. `open-questions.md` §15a records the row as removed and the frame as
 * dark; this is the assertion that keeps it removed. `tools/video/score_windows.py
 * --video --frame 640 --strict` is the same check at the other end of the
 * pipeline and exits non-zero rather than offering a panel to read.
 */
const FABRICATED_ROW_FRAME = 640;

describe('the score-windows drive', () => {
  it('still finds a census of lit windows', () => {
    expect(
      result.windows.length,
      'the score readout census has collapsed - re-run tools/video/score_windows.py ' +
        '--video --csv and check the digit box is still on the digits',
    ).toBeGreaterThanOrEqual(WINDOWS);
    expect(
      result.litFrames,
      'too few frames have the digits lit for a census to mean anything',
    ).toBeGreaterThanOrEqual(LIT_FRAMES);
    expect(result.frames.length).toBeGreaterThan(result.litFrames);
  });

  it('still finds less of the clip lit as the floor rises', () => {
    // Frames covered, not windows counted: a rising floor punches holes in a
    // long window before it removes one, so the window *count* climbs to 16 at
    // half the peak before it falls. Coverage is the monotone measure, and the
    // one that says the census is reading brightness rather than reproducing
    // the shape of the window-finder.
    const covered = (floor: number): number =>
      windowsAtFloor(result.frames, floor).reduce(
        (frames, window) => frames + (window.last - window.first + 1),
        0,
      );
    expect(windowsAtFloor(result.frames, 40).length).toBe(result.windows.length);
    expect(
      windowsAtFloor(result.frames, result.peakLitPixels + 1).length,
      'raising the floor above the brightest frame in the clip still finds windows - ' +
        'the census is not measuring brightness',
    ).toBe(0);
    expect(
      covered(Math.round(result.peakLitPixels / 2)),
      'the census covers as much of the clip at half the peak as at the floor, so it ' +
        'is an artefact of the window-finder rather than a measurement of the readout',
    ).toBeLessThan(covered(40));
  });

  it('still flags exactly the two clipped windows', () => {
    expect(
      result.clippedWindows.map((window) => window.first),
      'the clipping flag no longer picks exactly the overexposed windows. It once ' +
        'fired on fourteen of fifteen and missed the blown final flash it was written ' +
        'for - see score_windows.py, "Do not trim that check"',
    ).toEqual(CLIPPED_WINDOW_STARTS);
    for (const window of result.windows) {
      if (window.clipped) continue;
      expect(window.peakLuma, `f${window.first} is one count from being called clipped`).toBeLessThan(
        230,
      );
    }
  });

  it('still has the readout lit at every frame a documented reading cites', () => {
    for (const anchor of ANCHORS) {
      const frame = frameAt(result, anchor.frame);
      expect(frame.seconds).toBeCloseTo(anchor.seconds, 2);
      expect(
        frame.litPixels,
        `f${anchor.frame} (${anchor.seconds} s) backs "${anchor.reading}" in open-questions.md ` +
          `§15, cited at ${anchor.litPixels} lit px. assets/reference/skill3-video-score.csv ` +
          'now measures something else, so the citation has come loose from the evidence ' +
          'under it: re-run tools/video/score_windows.py --video --csv and carry the new ' +
          'count into §15 and into this anchor',
      ).toBe(anchor.litPixels);
      expect(windowAt(result, anchor.frame), `f${anchor.frame} is in no lit window`).toBeDefined();
    }
  });

  it('still reads the fabricated row frame as dark', () => {
    const frame = frameAt(result, FABRICATED_ROW_FRAME);
    expect(frame.seconds).toBeCloseTo(21.33, 2);
    expect(
      frame.litPixels,
      'f640 (21.33 s) has lit pixels in the digit box. The row read off it - ' +
        '"21.33 s, SCORE 20" - was removed as never observed, and this is the ' +
        'assertion that keeps it out',
    ).toBe(0);
    expect(windowAt(result, FABRICATED_ROW_FRAME)).toBeUndefined();
  });

  it('derives every timestamp from the frame index and nothing else', () => {
    for (const frame of result.frames) {
      expect(frame.seconds).toBe(frame.frame / FRAMES_PER_SECOND);
    }
  });
});
