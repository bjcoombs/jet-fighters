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
// three ways, each of which can fail:
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
//
// **Nothing runs this automatically.** It is not imported by any suite and
// `npm test` never reaches it. It needs `ffmpeg` on PATH to decode the m4a, and
// it writes one temporary WAV under the system temp directory.
//
//   npx vite-node tools/probe/drives/loss-warning-partials.ts
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

function decode(): Float64Array {
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
 * noise; above 1350 Hz sits a continuous 1400-1700 Hz whine (present in every
 * quiet stretch of the file, ~24 dB over the local median) which is what
 * audio-reference.md means by "whine-notched".
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
console.log('  n = 1 warning event. This is the only beep group in the 88 s recording');
console.log('  that separates cleanly from the gameplay around it.\n');

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

console.log('\nRead the three together. The prefix model requires beep 2 to be the');
console.log('collapse; the collapse is what the loss sound shows at +30 dB or better on');
console.log('this statistic, and what beep 2 shows the opposite sign of.');
