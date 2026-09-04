// When is the real unit's score readout legible, and how brightly?
//
// This is the second drive here that measures the physical unit rather than the
// emulated machine, and it exists for the same reason as the first: a figure in
// `docs/evidence/` that only one person can re-derive is a figure nobody can
// check. Every score reading §15 and §15a of `open-questions.md` quote is now
// cited against a frame index and a lit-pixel count, and this drive is what
// re-derives those counts.
//
// It reads `assets/reference/skill3-video-score.csv` - the owner's committed
// skill-3 crop reduced to one lit-pixel count and one peak luminance per frame
// by `tools/video/score_windows.py`. Same shape as `missile-transit.ts` and the
// same reason: the drive needs no ffmpeg, NumPy or video decode, so a clean
// checkout runs it.
//
// ## What a window is, and what it is not
//
// **A window is a stretch of frames in which the digits are lit. It is not a
// reading.** The first window here runs 0.20 to 11.30 s and the score changes
// several times inside it. This drive says when the readout could be read and
// how much of it was alight; what the digits said is on the labelled contact
// sheet the Python tool writes, read by a person, and recorded against the frame
// index that backs it.
//
// The reason for that division is in `score_windows.py`'s header and is not a
// gap to be filled by a later, cleverer decoder: segment decoding was tried on
// this footage and is not reliable, because at the tube's scale the phosphor
// blooms and the two digits merge into one blob in the colour-excess channel. A
// decoder would be confidently wrong some of the time, which is worse than a
// human reading with a frame index attached to it.
//
// ## Why the readout being dark is the whole problem
//
// The readout is dark for more of this clip than it is lit, and the four
// corrections this tooling was built after all came from reading darkness as
// data. The worst of them put "21.33 s, SCORE 20" into a merged document - frame
// 640, which this drive measures at **0 lit pixels**, against a floor of 40. So
// the floors below are not only "did the instrument find anything": one of them
// asserts that a named dark frame is still dark, because that is the assertion
// the fabricated row would have failed.
//
// `score-windows.test.ts` holds this drive's floors.
//
// Paths in this file are relative to the repository root.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isEntryPoint } from './entry-point.js';

const SCORE_CSV = fileURLToPath(
  new URL('../../../assets/reference/skill3-video-score.csv', import.meta.url),
);

/**
 * The recording's frame rate.
 *
 * Every timestamp in this drive is `frame / FRAMES_PER_SECOND` and comes from
 * nowhere else. The fabricated row was a panel attributed to a timestamp that
 * did not come from its own frame index, so timestamp and index have one source
 * here by construction.
 */
export const FRAMES_PER_SECOND = 30;

/**
 * Lit pixels in the digit box before the readout counts as lit.
 *
 * Forty, the same floor `tools/video/score_windows.py` writes the `lit` column
 * with, restated here so this drive's arithmetic does not depend on a column
 * another program decided. Measured against it: a lit window peaks at 976-1557
 * px in this crop and a dark frame sits at 0, so the floor is an order of
 * magnitude clear of both.
 */
const LIT_FLOOR = 40;

/** Frames a window needs before it is a window rather than a one-frame flicker. */
const MIN_WINDOW_FRAMES = 2;

/**
 * Peak luminance at which a window is called clipped.
 *
 * **Measured: 247 and 255 on the two clipped windows against 207-219 on the
 * other thirteen.** The separation is 28 counts and this sits in the middle of
 * it. A clipped panel is one whose digits may not be what the readout was
 * showing, which is why the flag exists and why nothing here corrects the panel:
 * a contrast stretch that made the clip's final flash comfortable to read would
 * also have made it agree with the readings before it.
 */
const CLIPPED_LUMA = 240;

export interface ScoreFrame {
  readonly frame: number;
  readonly seconds: number;
  readonly litPixels: number;
  readonly lit: boolean;
  readonly peakLuma: number;
}

export interface ScoreWindow {
  readonly first: number;
  readonly last: number;
  readonly firstSeconds: number;
  readonly lastSeconds: number;
  /** The most lit pixels any frame in the window reached. */
  readonly peakLitPixels: number;
  /** The frame that reached it - the panel the contact sheet offers. */
  readonly brightestFrame: number;
  /** That frame's brightest pixel, as luminance. */
  readonly peakLuma: number;
  readonly clipped: boolean;
}

export interface ScoreWindowsResult {
  readonly frames: readonly ScoreFrame[];
  readonly litFrames: number;
  readonly windows: readonly ScoreWindow[];
  readonly clippedWindows: readonly ScoreWindow[];
  /** The most lit pixels any frame in the clip reached. */
  readonly peakLitPixels: number;
}

/** The regeneration this drive's CSV comes from, named in every parse failure. */
const REGENERATE = 'regenerate it with tools/video/score_windows.py --video --csv';

/**
 * One CSV field as a number, or a parse failure naming the field.
 *
 * An empty or non-numeric field coerces to `0` or `NaN` under `Number`, and both
 * pass silently into the census: `NaN >= LIT_FLOOR` is false and `0` is a dark
 * frame, so a truncated write of this file would read as a readout that went
 * out. That is the same shape of fault as the fabricated row - darkness taken
 * for data - so it is rejected rather than measured.
 */
const numberAt = (fields: readonly string[], column: number, name: string, row: number): number => {
  const raw = fields[column].trim();
  const value = Number(raw);
  if (raw.length === 0 || !Number.isFinite(value)) {
    throw new Error(
      `${SCORE_CSV} row ${row} has ${name} "${fields[column]}", which is not a finite number ` +
        `- ${REGENERATE}`,
    );
  }
  return value;
};

const readSeries = (): ScoreFrame[] => {
  const lines = readFileSync(SCORE_CSV, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length < 2) {
    throw new Error(
      `${SCORE_CSV} carries no frames: ${lines.length} non-comment lines, where a series ` +
        `needs a header and a row per frame - ${REGENERATE}`,
    );
  }
  const header = lines[0].split(',');
  if (header.join(',') !== 'frame,lit_pixels,lit,peak_luma') {
    throw new Error(
      `${SCORE_CSV} header is "${header.join(',')}", expected "frame,lit_pixels,lit,peak_luma" ` +
        `- ${REGENERATE}`,
    );
  }
  return lines.slice(1).map((line, index) => {
    const fields = line.split(',');
    if (fields.length !== 4) {
      throw new Error(`${SCORE_CSV} row ${index} has ${fields.length} fields, expected 4`);
    }
    const frame = numberAt(fields, 0, 'frame', index);
    if (frame !== index) {
      throw new Error(
        `${SCORE_CSV} row ${index} carries frame ${frame}. The rows are the frame index and a ` +
          'gap or a duplicate in them is the exact fault that produced the fabricated row',
      );
    }
    const litPixels = numberAt(fields, 1, 'lit_pixels', index);
    return {
      frame,
      seconds: frame / FRAMES_PER_SECOND,
      litPixels,
      lit: litPixels >= LIT_FLOOR,
      peakLuma: numberAt(fields, 3, 'peak_luma', index),
    };
  });
};

/**
 * Contiguous stretches in which the digits are lit, at a floor of the caller's
 * choosing.
 *
 * The floor is a parameter rather than a constant so the census can be shown to
 * *depend* on it. `missile-transit.ts` re-runs its linker on shuffled runs for
 * the same reason: an instrument that returns the same answer whatever it is
 * asked has not measured anything. Swept from 40 to above the peak, the count
 * here falls 15 -> 0, and `score-windows.test.ts` asserts that it does.
 */
export const windowsAtFloor = (frames: readonly ScoreFrame[], floor: number): ScoreWindow[] => {
  const found: ScoreWindow[] = [];
  const lit = (frame: ScoreFrame): boolean => frame.litPixels >= floor;
  let index = 0;
  while (index < frames.length) {
    if (!lit(frames[index])) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < frames.length && lit(frames[end])) end += 1;
    if (end - index >= MIN_WINDOW_FRAMES) {
      const inside = frames.slice(index, end);
      const brightest = inside.reduce((a, b) => (b.litPixels > a.litPixels ? b : a));
      found.push({
        first: index,
        last: end - 1,
        firstSeconds: index / FRAMES_PER_SECOND,
        lastSeconds: (end - 1) / FRAMES_PER_SECOND,
        peakLitPixels: brightest.litPixels,
        brightestFrame: brightest.frame,
        peakLuma: brightest.peakLuma,
        clipped: brightest.peakLuma >= CLIPPED_LUMA,
      });
    }
    index = end;
  }
  return found;
};

export const runScoreWindows = (): ScoreWindowsResult => {
  const frames = readSeries();
  const windows = windowsAtFloor(frames, LIT_FLOOR);
  return {
    frames,
    litFrames: frames.filter((frame) => frame.lit).length,
    windows,
    clippedWindows: windows.filter((window) => window.clipped),
    peakLitPixels: frames.reduce((most, frame) => Math.max(most, frame.litPixels), 0),
  };
};

/** The window a frame falls in, or `undefined` when the readout was dark. */
export const windowAt = (
  result: ScoreWindowsResult,
  frame: number,
): ScoreWindow | undefined => result.windows.find((w) => frame >= w.first && frame <= w.last);

/**
 * One frame's row, by index.
 *
 * Callers ask by frame and get the timestamp from the row, never the other way
 * round.
 */
export const frameAt = (result: ScoreWindowsResult, frame: number): ScoreFrame => {
  const found = result.frames[frame];
  if (found === undefined) {
    throw new Error(`frame ${frame} is outside the clip's 0-${result.frames.length - 1}`);
  }
  return found;
};

const report = (result: ScoreWindowsResult): void => {
  console.log(
    `${result.frames.length} frames, ${result.litFrames} with the score digits lit ` +
      `(${((100 * result.litFrames) / result.frames.length).toFixed(0)}%), ` +
      `brightest ${result.peakLitPixels} lit px\n`,
  );
  console.log('  window (s)        frames         peak lit px   peak luma');
  for (const window of result.windows) {
    const luma = window.clipped
      ? `CLIPPED ${window.peakLuma.toFixed(0)}`
      : window.peakLuma.toFixed(0);
    console.log(
      `  ${window.firstSeconds.toFixed(2).padStart(6)}-${window.lastSeconds.toFixed(2).padStart(6)}   ` +
        `f${window.first}-f${String(window.last).padEnd(6)}  ${String(window.peakLitPixels).padStart(6)}       ` +
        `${luma.padEnd(12)}(brightest f${window.brightestFrame})`,
    );
  }
  console.log(
    `\n${result.windows.length} windows, ${result.clippedWindows.length} of them clipped. ` +
      'What the digits said in each is read off the labelled contact sheet\n' +
      '`tools/video/score_windows.py --video --sheet` writes, and recorded against the frame index.',
  );
};

if (isEntryPoint(import.meta.url)) report(runScoreWindows());
