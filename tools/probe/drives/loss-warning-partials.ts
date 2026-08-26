// Is the launcher-hit warning a *prefix of the loss melody*, or a repeated note?
//
// The owner, playing the physical unit: "we have three lives, after each life is
// lost we play the sound, its the loosing theme progressively being reveiled
// until upuon the loss of the third life, it plays in total and the screen
// flashes." That describes a growing prefix. The ROM plays two, then three,
// copies of one 467 Hz beep. Both models predict the same beep *counts*, so the
// counts cannot separate them - only the per-beep spectrum and the timing can.
//
// This drive reads `assets/reference/loss-audio.m4a` and answers the question
// five ways, each of which can fail:
//
//   1. Per-beep dominant frequency, one window per beep, never pooled. The
//      pooled figure in docs/evidence/audio-reference.md (455, 455, 544 Hz)
//      cannot tell a descent from a repetition, because three partials pooled
//      over a whole event hide which beep each came from.
//   2. A band statistic, LOW (80-110 Hz) minus MID (420-560 Hz), tracked across
//      the warning and across the loss sound, each aligned on its own onset.
//      The loss melody's stage 2 is a collapse into 80-97 Hz. If the warning is
//      its prefix, beep 2 *is* that collapse and must read the same way.
//   3. The loss sound itself, through the identical statistic, as the positive
//      control. A method that cannot see the collapse where it is known to be
//      proves nothing about where it is not.
//   4. Event shape: what fraction of each event sits far below its own peak.
//   5. The isolation sweep over all 88 s, which is **where n comes from**, plus
//      the whine level that section 1's band choice is justified by. Both were
//      quoted in audio-reference.md before anything committed here computed
//      them; sections 5 and 5b are what make them re-derivable, and the
//      threshold grid in section 5 is there because a sample size that only
//      reads 1 at one setting is a property of the setting.
//
// **Nothing runs this automatically.** It is not imported by any suite, no test
// file references it, and `npm test` never reaches it. Run it by hand:
//
//   npx vite-node tools/probe/drives/loss-warning-partials.ts
//
// **Prerequisite: `ffmpeg` on PATH.** The reference recording is AAC in an MP4
// container, and decoding that is not something this repository can do for
// itself - so a clean checkout cannot run this drive until ffmpeg is installed
// (`brew install ffmpeg`, `apt-get install ffmpeg`). It is checked for up front
// and the failure names the fix rather than surfacing as ENOENT from a spawn.
// This is the same standing as `tools/trace/`, which needs Python with NumPy,
// SciPy and Pillow: both sit outside the build, neither is reachable from
// `src/`, and the zero-runtime-dependency rule in CLAUDE.md is about what ships,
// not about what an instrument may shell out to. The drive writes one temporary
// WAV under the system temp directory and removes it again.
//
// Paths below are relative to the repository root. Every frequency it prints is
// read off the recording; no figure here is transcribed from anywhere else.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hannWindow, magnitudeSpectrum } from '../../../src/machine/audio/spectrum.js';

const RECORDING = 'assets/reference/loss-audio.m4a';
const SR = 48_000;
const PAD = 1 << 16; // 0.73 Hz bins, so the mainlobe rather than the grid limits us

// --- the recording -----------------------------------------------------------

/** Fail with the fix rather than with an ENOENT out of a spawn. */
function requireFfmpeg(): void {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(
      [
        'loss-warning-partials: `ffmpeg` was not found on PATH.',
        '',
        `This drive decodes ${RECORDING} (AAC in an MP4 container), which it cannot do`,
        'without an external decoder. Install one and re-run:',
        '',
        '  macOS:  brew install ffmpeg',
        '  Debian: sudo apt-get install ffmpeg',
        '',
        'Nothing else in the repository needs it - no build, test or dev command does.',
      ].join('\n'),
    );
    process.exit(1);
  }
}

function decode(): Float64Array {
  requireFfmpeg();
  const dir = mkdtempSync(join(tmpdir(), 'jf-loss-'));
  const wav = join(dir, 'loss.wav');
  const src = resolve(import.meta.dirname, '..', '..', '..', RECORDING);
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', wav]);
    const buf = readFileSync(wav);
    // Walk the RIFF chunk list rather than assuming a 44-byte header.
    let at = 12;
    while (at + 8 <= buf.length) {
      const id = buf.toString('ascii', at, at + 4);
      const size = buf.readUInt32LE(at + 4);
      if (id === 'data') {
        const n = size >> 1;
        const out = new Float64Array(n);
        for (let i = 0; i < n; i += 1) out[i] = buf.readInt16LE(at + 8 + i * 2) / 32768;
        return out;
      }
      at += 8 + size + (size & 1);
    }
    throw new Error('no data chunk in the decoded WAV');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- spectra -----------------------------------------------------------------

/** Hann-windowed, zero-padded magnitude spectrum of `durS` seconds from `t0`. */
function spectrumAt(x: Float64Array, t0: number, durS: number): Float64Array {
  const a = Math.round(t0 * SR);
  const w = Math.round(durS * SR);
  const slice = x.subarray(a, a + w);
  let mean = 0;
  for (const v of slice) mean += v;
  mean /= slice.length;
  const win = hannWindow(slice.length);
  const padded = new Float64Array(PAD);
  for (let i = 0; i < slice.length; i += 1) padded[i] = (slice[i] - mean) * win[i];
  return magnitudeSpectrum(padded, { window: false });
}

const binHz = SR / PAD;
const bin = (hz: number) => Math.round(hz / binHz);

/** Mean-square level in dB over [lo, hi) of a magnitude spectrum. */
function bandDb(mags: Float64Array, lo: number, hi: number): number {
  let sum = 0;
  let n = 0;
  for (let k = bin(lo); k < bin(hi); k += 1) {
    sum += mags[k] * mags[k];
    n += 1;
  }
  return 10 * Math.log10(sum / n + 1e-30);
}

function rmsDb(x: Float64Array, t0: number, durS: number): number {
  const a = Math.round(t0 * SR);
  const n = Math.round(durS * SR);
  let sum = 0;
  for (let i = a; i < a + n; i += 1) sum += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(sum / n) + 1e-12);
}

// --- onsets ------------------------------------------------------------------

/**
 * Energy in 300-1300 Hz per 1 ms hop, over 8 ms windows.
 *
 * The band matters. Below 300 Hz the recording carries table rumble and handling
 * noise; above 1350 Hz sits a continuous 1400-1700 Hz whine, which is what
 * audio-reference.md means by "whine-notched". Section 5b measures it rather
 * than asserting it.
 */
function bandTrack(x: Float64Array, t0: number, t1: number): { t: number; db: number }[] {
  const out: { t: number; db: number }[] = [];
  // The window is centred on `t`, so a maximum names the beep's centre rather
  // than the start of the window that happened to contain it.
  for (let t = t0; t < t1; t += 0.001) {
    out.push({ t, db: bandDb(spectrumAt(x, t - 0.004, 0.008), 300, 1300) });
  }
  return out;
}

/** The `count` strongest local maxima of a track, at least `minGapMs` apart. */
function peaks(track: { t: number; db: number }[], count: number, minGapMs: number) {
  const sorted = [...track].sort((a, b) => b.db - a.db);
  const picked: typeof track = [];
  for (const p of sorted) {
    if (picked.every((q) => Math.abs(q.t - p.t) * 1000 > minGapMs)) picked.push(p);
    if (picked.length === count) break;
  }
  return picked.sort((a, b) => a.t - b.t);
}

// --- the measurement ---------------------------------------------------------

const x = decode();
console.log(`${RECORDING}: ${(x.length / SR).toFixed(3)} s at ${SR} Hz, mono\n`);

// audio-reference.md points at ~27.4 s for the discrete beep group and ~85.86 s
// for the loss opening. Both windows below are wider than those citations, and
// the events are found inside them rather than assumed at them.
const WARN_SEARCH = [27.3, 27.55] as const;
const LOSS_SEARCH = [85.85, 85.99] as const;

const warnPeaks = peaks(bandTrack(x, WARN_SEARCH[0], WARN_SEARCH[1]), 3, 15);
const BEEP_MS = 10; // audio-reference.md's measured beep length
const DUR = BEEP_MS / 1000;
const LEAD = 0.002; // start the window just before the peak, to hold the attack

console.log('--- 1. Per-beep dominant frequency -----------------------------------');
console.log(`Window ${BEEP_MS} ms Hann, zero-padded to ${PAD} (${binHz.toFixed(2)} Hz bins).`);
console.log(`A ${BEEP_MS} ms Hann mainlobe is ~${(4 / DUR).toFixed(0)} Hz wide, so the -3 dB span,`);
console.log('not the bin grid, is the uncertainty. Background is the mean spectrum of');
console.log('nine 10 ms windows in the gaps between and before the beeps.\n');

const bgTimes = [27.355, 27.36, 27.365, 27.4055, 27.4105, 27.4155, 27.4655, 27.4705, 27.4755];
const bgSpectra = bgTimes.map((t) => spectrumAt(x, t, DUR));
const background = new Float64Array(bgSpectra[0].length);
for (let k = 0; k < background.length; k += 1) {
  background[k] = bgSpectra.reduce((s, m) => s + m[k], 0) / bgSpectra.length;
}

/** Excess over background in dB, boxcar-smoothed over 100 Hz. */
function excess(mags: Float64Array): Float64Array {
  const raw = new Float64Array(mags.length);
  for (let k = 0; k < mags.length; k += 1) {
    raw[k] = 20 * Math.log10((mags[k] + 1e-15) / (background[k] + 1e-15));
  }
  const half = Math.round(50 / binHz);
  const smooth = new Float64Array(raw.length);
  for (let k = 0; k < raw.length; k += 1) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(raw.length - 1, k + half); j += 1) {
      sum += raw[j];
      n += 1;
    }
    smooth[k] = sum / n;
  }
  return smooth;
}

// 150-1350 Hz: above the rumble, below the whine, and wide enough to hold a
// 467 Hz fundamental with its second harmonic or a collapse to 92 Hz's third.
const LO_BIN = bin(150);
const HI_BIN = bin(1350);

console.log('  beep   onset(s)   dominant Hz   -3 dB span      excess    LOW-MID');
const beepRows: { t: number; dom: number }[] = [];
for (const [i, p] of warnPeaks.entries()) {
  const t0 = p.t - LEAD;
  const mags = spectrumAt(x, t0, DUR);
  const ex = excess(mags);
  let peakBin = LO_BIN;
  for (let k = LO_BIN; k <= HI_BIN; k += 1) if (ex[k] > ex[peakBin]) peakBin = k;
  let lo = peakBin;
  let hi = peakBin;
  while (lo > LO_BIN && ex[lo - 1] >= ex[peakBin] - 3) lo -= 1;
  while (hi < HI_BIN && ex[hi + 1] >= ex[peakBin] - 3) hi += 1;
  const lowMid = bandDb(mags, 80, 110) - bandDb(mags, 420, 560);
  console.log(
    `   ${i + 1}    ${t0.toFixed(4)}    ${(peakBin * binHz).toFixed(0).padStart(8)}   ` +
      `${(lo * binHz).toFixed(0).padStart(5)}-${(hi * binHz).toFixed(0).padEnd(5)}  ` +
      `${ex[peakBin].toFixed(1).padStart(7)} dB  ${lowMid.toFixed(1).padStart(7)} dB`,
  );
  beepRows.push({ t: t0, dom: peakBin * binHz });
}

const onsets = beepRows.map((r) => r.t);
console.log(
  `\n  onset-to-onset: ${onsets
    .slice(1)
    .map((t, i) => `${((t - onsets[i]) * 1000).toFixed(1)} ms`)
    .join(', ')};  group spans ${((onsets[2] - onsets[0]) * 1000).toFixed(1)} ms`,
);
console.log('  Whether this is the only such group in the recording is not asserted');
console.log('  here - section 5 sweeps all 88 s and counts them.\n');

// --- 2 and 3. the band statistic, warning against loss ------------------------

// The loss sound rises out of the room floor over tens of milliseconds, so a
// fixed threshold over the background would name whatever the floor happened to
// do. Take its own peak in the search window and call the onset the first frame
// within 12 dB of it - the same "relative to the event" rule the beep peaks use.
let lossPeakDb = -Infinity;
for (let t = LOSS_SEARCH[0]; t < LOSS_SEARCH[1]; t += 0.001) {
  lossPeakDb = Math.max(lossPeakDb, rmsDb(x, t, 0.015));
}
let lossOnset = LOSS_SEARCH[0];
for (let t = LOSS_SEARCH[0]; t < LOSS_SEARCH[1]; t += 0.001) {
  if (rmsDb(x, t, 0.015) > lossPeakDb - 12) {
    lossOnset = t;
    break;
  }
}

console.log('--- 2 & 3. LOW-MID, warning against loss, each on its own onset -------');
console.log('LOW = 80-110 Hz, the gameOver stage-2 collapse band.');
console.log('MID = 420-560 Hz, the gameOver opening and the warning-beep band.');
console.log(`Warning onset ${onsets[0].toFixed(4)} s; loss onset ${lossOnset.toFixed(4)} s. 15 ms windows.\n`);
console.log('  rel_t(ms)   WARNING LOW-MID    LOSS LOW-MID');
for (let ms = 0; ms <= 120; ms += 10) {
  const w = spectrumAt(x, onsets[0] + ms / 1000, 0.015);
  const l = spectrumAt(x, lossOnset + ms / 1000, 0.015);
  const wv = bandDb(w, 80, 110) - bandDb(w, 420, 560);
  const lv = bandDb(l, 80, 110) - bandDb(l, 420, 560);
  console.log(`  ${String(ms).padStart(7)}    ${wv.toFixed(1).padStart(12)} dB ${lv.toFixed(1).padStart(13)} dB`);
}

console.log('\n--- the loss melody, stage by stage, as the positive control ----------');
console.log('  offset(ms)   dominant Hz   audio-reference.md stage');
const stages: [number, string][] = [
  [5, 'stage 1, 455-545 Hz opening'],
  [15, 'stage 2, 80-97 Hz collapse'],
  [25, 'stage 2, 80-97 Hz collapse'],
  [240, 'stage 3, 200-280 Hz rasp'],
];
const lossBgSpectra = [85.78, 85.79, 85.8, 85.81, 85.82, 85.83].map((t) => spectrumAt(x, t, DUR));
const lossBackground = new Float64Array(lossBgSpectra[0].length);
for (let k = 0; k < lossBackground.length; k += 1) {
  lossBackground[k] = lossBgSpectra.reduce((s, m) => s + m[k], 0) / lossBgSpectra.length;
}
for (const [ms, label] of stages) {
  const mags = spectrumAt(x, lossOnset + ms / 1000, DUR);
  const raw = new Float64Array(mags.length);
  for (let k = 0; k < mags.length; k += 1) {
    raw[k] = 20 * Math.log10((mags[k] + 1e-15) / (lossBackground[k] + 1e-15));
  }
  const half = Math.round(50 / binHz);
  let peakBin = bin(60);
  let bestVal = -Infinity;
  for (let k = bin(60); k <= HI_BIN; k += 1) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(raw.length - 1, k + half); j += 1) {
      sum += raw[j];
      n += 1;
    }
    if (sum / n > bestVal) {
      bestVal = sum / n;
      peakBin = k;
    }
  }
  console.log(`  ${String(ms).padStart(8)}   ${(peakBin * binHz).toFixed(0).padStart(11)}   ${label}`);
}

// --- 4. event shape: is the warning continuous, the way a melody is? ---------

console.log('\n--- 4. Event shape ---------------------------------------------------');
console.log('300-1300 Hz level per 2 ms frame, as a fraction of each event that sits');
console.log('more than 15 dB below that event\'s own peak. A melody played straight');
console.log('through has no such frames; a train of separated beeps is mostly them.\n');

function shape(t0: number, durS: number, label: string): void {
  const frames: number[] = [];
  for (let t = t0; t < t0 + durS; t += 0.002) frames.push(bandDb(spectrumAt(x, t, 0.008), 300, 1300));
  const peak = Math.max(...frames);
  const quiet = frames.filter((v) => v < peak - 15).length;
  // Longest unbroken run within 15 dB of the peak, in ms.
  let run = 0;
  let bestRun = 0;
  for (const v of frames) {
    run = v >= peak - 15 ? run + 1 : 0;
    bestRun = Math.max(bestRun, run);
  }
  console.log(
    `  ${label.padEnd(34)} ${((quiet / frames.length) * 100).toFixed(0).padStart(3)}% quiet   ` +
      `longest continuous run ${(bestRun * 2).toFixed(0).padStart(4)} ms of ${(durS * 1000).toFixed(0)} ms`,
  );
}
// Matched lengths. Comparing an 88 ms window against a 1.1 s one would compare
// each event's peak to a different part of itself: over the whole loss sound the
// peak is the 240 Hz rasp body, 20 dB above the collapse that precedes it, and
// the statistic would then report the collapse as "quiet".
const span = onsets[2] + 0.015 - onsets[0];
shape(onsets[0], span, 'warning, whole three-beep group');
shape(lossOnset, span, 'loss, same length from its onset');

// --- 5. the isolation sweep, and the whine ----------------------------------

// Where n comes from. An earlier port of this sweep read band energy off 8 ms
// FFT frames and found nothing at 27.4 s: an 8 ms window smears a 10 ms burst
// past a 4-16 ms run gate. So the envelope here is time-domain - a zero-phase
// band-pass, rectified and smoothed - and never leaves the sample grid.

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook, normalised by a0. */
function lowpassBq(fc: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cos) / 2) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function highpassBq(fc: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function runBq(input: Float64Array, bq: Biquad, reverse: boolean): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let n = 0; n < input.length; n += 1) {
    const i = reverse ? input.length - 1 - n : n;
    const x0 = input[i];
    const y0 = bq.b0 * x0 + bq.b1 * x1 + bq.b2 * x2 - bq.a1 * y1 - bq.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/** Forward then backward: zero phase, so a burst keeps its position and length. */
function filtfilt(input: Float64Array, stages: Biquad[]): Float64Array {
  let y = input;
  for (const bq of stages) y = runBq(runBq(y, bq, false), bq, true);
  return y;
}

/**
 * Peak envelope of 300-1300 Hz, in dB, one frame per millisecond.
 *
 * Same band as `bandTrack`: above the table rumble, below the 1400-1700 Hz
 * whine. Rectified and smoothed at 120 Hz, which settles inside ~3 ms and so
 * still resolves a 10 ms burst; the per-frame maximum is taken rather than the
 * mean, for the same reason.
 */
function envelopeMs(input: Float64Array): Float64Array {
  const band = filtfilt(input, [highpassBq(300), lowpassBq(1300)]);
  for (let i = 0; i < band.length; i += 1) band[i] = Math.abs(band[i]);
  const smoothed = filtfilt(band, [lowpassBq(120)]);
  const hop = SR / 1000;
  const frames = Math.floor(smoothed.length / hop);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let peak = 0;
    for (let i = f * hop; i < (f + 1) * hop; i += 1) peak = Math.max(peak, smoothed[i]);
    out[f] = 20 * Math.log10(peak + 1e-12);
  }
  return out;
}

const BURST_MIN_MS = 4;
const BURST_MAX_MS = 16;
const OVER_MEDIAN_DB = 15; // a frame is "loud" this far over its local median
// A burst is isolated if nothing else reaches that same threshold within
// FLANK_MS either side. Not "silence": a 10 ms piezo click rings for another
// 10-15 ms, so a rule demanding the flanks return to the floor rejects all
// three beeps of a group that is audibly three separate beeps. What isolation
// has to mean here is that no *other* event is inside the flank.
const FLANK_MS = 12;
const GROUP_MIN_MS = 25;
const GROUP_MAX_MS = 50;

const env = envelopeMs(x);

// The floor a burst is measured against is the median of the half second
// around it, resampled every 50 ms.
//
// A whole-file or per-2 s median does not work here, and the way it fails is
// worth recording: this recording's floor moves by more than 10 dB between
// quiet stretches and dense play, so a 2 s median puts the beeps' own ringing
// 18 dB above the threshold. Every run then measures ~34 ms and is thrown out
// by the 4-16 ms gate - the sweep reports zero bursts at 27.4 s while the
// envelope plainly shows three.
const FLOOR_WIN_MS = 500;
const FLOOR_STEP_MS = 50;
const floors = new Float64Array(Math.ceil(env.length / FLOOR_STEP_MS));
for (let b = 0; b < floors.length; b += 1) {
  const mid = b * FLOOR_STEP_MS;
  const lo = Math.max(0, mid - FLOOR_WIN_MS / 2);
  const hi = Math.min(env.length, mid + FLOOR_WIN_MS / 2);
  const block = Array.from(env.subarray(lo, hi)).sort((p, q) => p - q);
  floors[b] = block[block.length >> 1];
}
const medianAt = (frame: number) => floors[Math.min(floors.length - 1, Math.round(frame / FLOOR_STEP_MS))];

interface Burst {
  startMs: number;
  lenMs: number;
  peakDb: number;
  isolated: boolean;
}

function findBursts(overDb: number): Burst[] {
  const found: Burst[] = [];
  let runStart = -1;
  for (let f = 0; f <= env.length; f += 1) {
    const loud = f < env.length && env[f] > medianAt(f) + overDb;
    if (loud && runStart < 0) runStart = f;
    if (!loud && runStart >= 0) {
      const len = f - runStart;
      if (len >= BURST_MIN_MS && len <= BURST_MAX_MS) {
        let peak = -Infinity;
        for (let k = runStart; k < f; k += 1) peak = Math.max(peak, env[k]);
        let isolated = runStart >= FLANK_MS && f + FLANK_MS <= env.length;
        for (let k = runStart - FLANK_MS; isolated && k < runStart; k += 1) {
          if (env[k] > medianAt(k) + overDb) isolated = false;
        }
        for (let k = f; isolated && k < f + FLANK_MS; k += 1) {
          if (env[k] > medianAt(k) + overDb) isolated = false;
        }
        found.push({ startMs: runStart, lenMs: len, peakDb: peak, isolated });
      }
      runStart = -1;
    }
  }
  return found;
}

/** Isolated bursts spaced GROUP_MIN_MS-GROUP_MAX_MS apart, in runs of 2 or more. */
function groupBursts(found: Burst[]): Burst[][] {
  const groups: Burst[][] = [];
  for (const b of found.filter((q) => q.isolated)) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    const gap = prev ? b.startMs - prev.startMs : Infinity;
    if (last && gap >= GROUP_MIN_MS && gap <= GROUP_MAX_MS) last.push(b);
    else groups.push([b]);
  }
  return groups.filter((g) => g.length >= 2);
}

const bursts = findBursts(OVER_MEDIAN_DB);
const isolated = bursts.filter((b) => b.isolated);
const multi = groupBursts(bursts);

console.log('\n--- 5. Isolation sweep over the whole recording ----------------------');
console.log(`Zero-phase 300-1300 Hz envelope, 1 ms frames. A burst is a run of`);
console.log(
  `${BURST_MIN_MS}-${BURST_MAX_MS} ms more than ${OVER_MEDIAN_DB} dB over the median of the ${FLOOR_WIN_MS} ms around it; isolated if the`,
);
console.log(`${FLANK_MS} ms either side holds no other event over it. Bursts ${GROUP_MIN_MS}-${GROUP_MAX_MS} ms apart`);
console.log('are one group. This is the whole basis of the "n =" figure.\n');
// gameOver.timestampRangeSec, from the table in audio-reference.md: a group
// found inside it is part of the loss sound, not a warning.
const LOSS_SPAN = [85.86, 86.99] as const;
const inPlay = (g: Burst[]) => g[0].startMs / 1000 < LOSS_SPAN[0];

console.log(`  bursts in range: ${bursts.length};  isolated: ${isolated.length};  groups of 2+: ${multi.length}`);
for (const g of multi) {
  const at = g[0].startMs / 1000;
  const gaps = g
    .slice(1)
    .map((b, i) => `${b.startMs - g[i].startMs}`)
    .join(', ');
  const where = at < LOSS_SPAN[0] ? 'in play' : at <= LOSS_SPAN[1] ? 'inside the loss sound' : 'after the loss sound';
  console.log(
    `    ${at.toFixed(3)} s  ${String(g.length).padStart(2)} bursts` +
      `   gaps ${gaps} ms   peak ${Math.max(...g.map((b) => b.peakDb)).toFixed(1)} dB   ${where}`,
  );
}
console.log(`\n  n = ${multi.filter(inPlay).length} beep group(s) in play, before the loss sound at ${LOSS_SPAN[0]} s.`);

// n is the figure everything else in this section is a sample of, so it is
// worth knowing whether it survives the threshold being moved. If n only reads
// 1 at one setting, it is a property of the setting.
console.log('\n  n against the detection threshold:');
for (const overDb of [11, 13, 15, 17, 19]) {
  const g = groupBursts(findBursts(overDb));
  const play = g.filter(inPlay);
  console.log(
    `    +${String(overDb).padStart(2)} dB: ${play.length} group(s) in play` +
      `${play.length ? ` at ${play.map((q) => `${(q[0].startMs / 1000).toFixed(3)} s (${q.length} bursts)`).join(', ')}` : ''}` +
      `;  ${g.length - play.length} at or after the loss sound`,
  );
}
console.log('');

// Which of section 1's three beeps the sweep is willing to call isolated - the
// reason one of them is quoted with a caveat there.
console.log('  Section 1\'s beeps against this sweep:');
for (const [i, r] of beepRows.entries()) {
  const near = bursts.filter((b) => Math.abs(b.startMs / 1000 - (r.t + LEAD)) < 0.02);
  const seen = near.map((b) => `${(b.startMs / 1000).toFixed(3)} s ${b.lenMs} ms ${b.isolated ? 'isolated' : 'NOT isolated'}`);
  console.log(`    beep ${i + 1} (${r.t.toFixed(4)} s): ${seen.length ? seen.join('; ') : 'no burst in range'}`);
}
const between = bursts.filter((b) => b.startMs / 1000 > 27.43 && b.startMs / 1000 < 27.46);
console.log(
  `    bursts between beep 2 and beep 3: ${
    between.length ? between.map((b) => `${(b.startMs / 1000).toFixed(3)} s (${b.lenMs} ms)`).join(', ') : 'none'
  }`,
);

// --- the whine, which is why section 1 reads 150-1350 Hz ---------------------

console.log('\n--- 5b. The 1400-1700 Hz whine --------------------------------------');
console.log('Peak bin in 1400-1700 Hz over the median bin level of 1000-2200 Hz outside');
console.log('it, in the quietest 200 ms windows of the file. This is what justifies the');
console.log('band limit in section 1 and the word "whine-notched" in the summary table.\n');

// The quietest windows, found rather than assumed: lowest broadband envelope.
const QUIET_MS = 200;
const quietStarts: number[] = [];
{
  const scored: { at: number; db: number }[] = [];
  for (let f = 0; f + QUIET_MS < env.length; f += QUIET_MS) {
    let sum = 0;
    for (let k = f; k < f + QUIET_MS; k += 1) sum += env[k];
    scored.push({ at: f, db: sum / QUIET_MS });
  }
  scored.sort((a, b) => a.db - b.db);
  quietStarts.push(...scored.slice(0, 5).map((s) => s.at / 1000));
}
for (const t of quietStarts) {
  const mags = spectrumAt(x, t, QUIET_MS / 1000);
  let peakBin = bin(1400);
  for (let k = bin(1400); k < bin(1700); k += 1) if (mags[k] > mags[peakBin]) peakBin = k;
  const around: number[] = [];
  for (let k = bin(1000); k < bin(2200); k += 1) {
    if (k < bin(1350) || k >= bin(1750)) around.push(mags[k]);
  }
  around.sort((a, b) => a - b);
  const med = around[around.length >> 1];
  console.log(
    `  ${t.toFixed(3)} s: peak ${(peakBin * binHz).toFixed(0).padStart(4)} Hz, ` +
      `${(20 * Math.log10(mags[peakBin] / med)).toFixed(1).padStart(5)} dB over the local median`,
  );
}

console.log('\nRead the five together. The prefix model requires beep 2 to be the');
console.log('collapse; the collapse is what the loss sound shows at +30 dB or better on');
console.log('this statistic, and what beep 2 shows the opposite sign of.');
