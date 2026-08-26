// Decoding and spectral helpers shared by the two drives that measure a
// *recording* rather than the machine.
//
// Paths in this file are relative to the repository root.
//
// `loss-warning-partials.ts` grew these first and owned the only copy. When
// `march-tone-identity.ts` needed the same decoder, the same zero-padded
// spectrum and the same zero-phase envelope, the choice was to duplicate 200
// lines or to lift them here. They are lifted, unchanged in behaviour, because
// two drives disagreeing about what "the 600-650 Hz band level" means is
// exactly the kind of drift this directory exists to prevent - the whole point
// of a committed drive is that a second person gets the same number.
//
// **Prerequisite: `ffmpeg` on PATH.** The reference recordings are AAC in MP4
// containers and decoding that is not something this repository can do for
// itself, so a clean checkout cannot run either drive until ffmpeg is installed
// (`brew install ffmpeg`, `apt-get install ffmpeg`). It is checked for up front
// and the failure names the fix rather than surfacing as ENOENT from a spawn.
// This is the same standing as `tools/trace/`, which needs Python with NumPy,
// SciPy and Pillow: both sit outside the build, neither is reachable from
// `src/`, and the zero-runtime-dependency rule in CLAUDE.md is about what ships,
// not about what an instrument may shell out to.
//
// This file is not itself a drive - it prints nothing and decides nothing. See
// `drives-covered.test.ts`, which records that and why.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hannWindow, magnitudeSpectrum } from '../../../src/machine/audio/spectrum.js';

/** Every drive here decodes to mono at this rate. */
export const SR = 48_000;

/** 0.73 Hz bins, so the mainlobe rather than the grid limits a reading. */
export const PAD = 1 << 16;

export const binHz = SR / PAD;

/** Bin index of a frequency, on the `PAD`-point grid. */
export const bin = (hz: number): number => Math.round(hz / binHz);

/** Fail with the fix rather than with an ENOENT out of a spawn. */
export function requireFfmpeg(who: string, what: string): void {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(
      [
        `${who}: \`ffmpeg\` was not found on PATH.`,
        '',
        `This drive decodes ${what} (AAC in an MP4 container), which it cannot do`,
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

/**
 * Decode a reference recording to mono float samples at `SR`.
 *
 * `relPath` is relative to the repository root. `-vn` is passed so the same
 * function decodes a `.mov` the owner recorded on his phone as well as an
 * `.m4a`; a video stream would otherwise make ffmpeg pick a different output
 * container. One temporary WAV is written under the system temp directory and
 * removed again.
 */
export function decodeRecording(relPath: string): Float64Array {
  const dir = mkdtempSync(join(tmpdir(), 'jf-rec-'));
  const wav = join(dir, 'decoded.wav');
  const src = relPath.startsWith('/')
    ? relPath
    : resolve(import.meta.dirname, '..', '..', '..', relPath);
  try {
    execFileSync('ffmpeg', [
      '-y', '-v', 'error', '-i', src,
      '-vn', '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', wav,
    ]);
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
    throw new Error(`no data chunk in the decoded WAV for ${relPath}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Hann-windowed, zero-padded magnitude spectrum of `durS` seconds from `t0`. */
export function spectrumAt(x: Float64Array, t0: number, durS: number): Float64Array {
  const a = Math.max(0, Math.round(t0 * SR));
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

/** Mean-square level in dB over [lo, hi) of a magnitude spectrum. */
export function bandDb(mags: Float64Array, lo: number, hi: number): number {
  let sum = 0;
  let n = 0;
  for (let k = bin(lo); k < bin(hi); k += 1) {
    sum += mags[k] * mags[k];
    n += 1;
  }
  return 10 * Math.log10(sum / n + 1e-30);
}

/** Broadband RMS in dB of `durS` seconds from `t0`. */
export function rmsDb(x: Float64Array, t0: number, durS: number): number {
  const a = Math.round(t0 * SR);
  const n = Math.round(durS * SR);
  let sum = 0;
  for (let i = a; i < a + n; i += 1) sum += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(sum / n) + 1e-12);
}

/**
 * Strongest bin in [lo, hi), after boxcar-smoothing over `smoothHz`.
 *
 * Returns hertz. The smoothing is what makes this readable on a short window:
 * a 10 ms Hann mainlobe is ~400 Hz wide, so the raw peak bin wanders inside the
 * lobe. **It does not make the reading stable** - see the drive section that
 * measures how far it moves when the window moves.
 */
export function dominantHz(
  mags: ArrayLike<number>,
  lo: number,
  hi: number,
  smoothHz = 100,
): number {
  const half = Math.round(smoothHz / 2 / binHz);
  let bestBin = bin(lo);
  let bestVal = -Infinity;
  for (let k = bin(lo); k <= bin(hi); k += 1) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(mags.length - 1, k + half); j += 1) {
      sum += mags[j];
      n += 1;
    }
    if (sum / n > bestVal) {
      bestVal = sum / n;
      bestBin = k;
    }
  }
  return bestBin * binHz;
}

// --- zero-phase filtering ----------------------------------------------------

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook low-pass, normalised by a0. */
export function lowpassBq(fc: number, q = Math.SQRT1_2): Biquad {
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

/** RBJ cookbook high-pass, normalised by a0. */
export function highpassBq(fc: number, q = Math.SQRT1_2): Biquad {
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

/**
 * RBJ cookbook constant-skirt band-pass, normalised by a0.
 *
 * `q` is centre over bandwidth: a 600-650 Hz band is f0 624.5, Q 12.5.
 */
export function bandpassBq(f0: number, q: number): Biquad {
  const w = (2 * Math.PI * f0) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
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
export function filtfilt(input: Float64Array, stages: readonly Biquad[]): Float64Array {
  let y = input;
  for (const bq of stages) y = runBq(runBq(y, bq, false), bq, true);
  return y;
}

/**
 * Peak envelope of a band, in dB, one frame per millisecond.
 *
 * Rectified and smoothed at `smoothHz`, which at the 120 Hz default settles
 * inside ~3 ms and so still resolves a 10 ms burst; the per-frame maximum is
 * taken rather than the mean, for the same reason.
 */
export function envelopeMs(
  input: Float64Array,
  lo: number,
  hi: number,
  smoothHz = 120,
): Float64Array {
  const band = filtfilt(input, [highpassBq(lo), lowpassBq(hi)]);
  for (let i = 0; i < band.length; i += 1) band[i] = Math.abs(band[i]);
  const smoothed = filtfilt(band, [lowpassBq(smoothHz)]);
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

/**
 * RMS level of one band, in dB, sampled every `hopMs` over `winMs` windows.
 *
 * A time-domain band-pass rather than a transform, because sweeping 130 s at a
 * 10 ms hop with a 65536-point FFT per window costs minutes and this costs
 * about a second. Two cascaded constant-skirt sections, run forwards and
 * backwards, so the band is narrow and a burst keeps its position.
 *
 * Frame `i` covers `[i * hopMs, i * hopMs + winMs)`.
 */
export function bandRmsTrackDb(
  x: Float64Array,
  lo: number,
  hi: number,
  winMs: number,
  hopMs: number,
): Float64Array {
  const f0 = Math.sqrt(lo * hi);
  const bq = bandpassBq(f0, f0 / (hi - lo));
  const band = filtfilt(x, [bq, bq]);
  const win = Math.round((winMs / 1000) * SR);
  const hop = Math.round((hopMs / 1000) * SR);
  const frames = Math.max(0, Math.floor((band.length - win) / hop) + 1);
  const out = new Float64Array(frames);
  // Prefix sums of the square, so each frame is O(1) rather than O(win).
  const cum = new Float64Array(band.length + 1);
  for (let i = 0; i < band.length; i += 1) cum[i + 1] = cum[i] + band[i] * band[i];
  for (let f = 0; f < frames; f += 1) {
    const a = f * hop;
    out[f] = 10 * Math.log10((cum[a + win] - cum[a]) / win + 1e-30);
  }
  return out;
}

// --- tonality ----------------------------------------------------------------

/**
 * How much a window looks like a tone at `f0`, in dB.
 *
 * Mean level at the first `harmonics` multiples of `f0`, minus the mean level
 * at points `offsetHz` either side of each of them. A tone with a harmonic
 * series scores high; noise, however loud, scores near zero, because the
 * anti-points rise with it. **The statistic is only meaningful against its own
 * controls**, which is why every drive that prints it prints a known tone and a
 * known silence beside the thing in question.
 */
export function harmonicCombDb(
  mags: Float64Array,
  f0: number,
  harmonics = 8,
  offsetHz = 55,
  maxHz = 6000,
): number {
  const at = (hz: number) => bandDb(mags, hz - 12, hz + 12);
  let sum = 0;
  let n = 0;
  for (let h = 1; h <= harmonics; h += 1) {
    const hz = h * f0;
    if (hz > maxHz) break;
    sum += at(hz) - (at(hz - offsetHz) + at(hz + offsetHz)) / 2;
    n += 1;
  }
  return n >= 3 ? sum / n : Number.NEGATIVE_INFINITY;
}

/** The `f0` in [lo, hi] that maximises `harmonicCombDb`, and its score. */
export function bestCombF0(
  mags: Float64Array,
  lo: number,
  hi: number,
  stepHz = 1,
): { f0: number; scoreDb: number } {
  let f0 = lo;
  let scoreDb = Number.NEGATIVE_INFINITY;
  for (let f = lo; f <= hi; f += stepHz) {
    const s = harmonicCombDb(mags, f);
    if (s > scoreDb) {
      scoreDb = s;
      f0 = f;
    }
  }
  return { f0, scoreDb };
}
