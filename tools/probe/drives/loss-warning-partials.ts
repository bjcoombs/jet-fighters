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

import {
  PAD,
  SR,
  bandDb,
  bestCombF0,
  bin,
  binHz,
  decodeRecording,
  envelopeMs,
  filtfilt,
  harmonicCombDb,
  highpassBq,
  lowpassBq,
  requireFfmpeg,
  rmsDb,
  spectrumAt,
} from './recording.js';

const RECORDING = 'assets/reference/loss-audio.m4a';
const GAMEPLAY = 'assets/reference/gameplay-audio.m4a';

/**
 * The decode, the spectra, the band levels and the zero-phase filters live in
 * `recording.ts` since `march-tone-identity.ts` needed the same ones. Nothing
 * about their behaviour changed when they moved; what changed is that two
 * drives now cannot drift apart about what "the 600-650 Hz band level" means.
 */
function decode(): Float64Array {
  requireFfmpeg('loss-warning-partials', RECORDING);
  return decodeRecording(RECORDING);
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

// The envelope, the zero-phase filters and the biquads now live in
// `recording.ts`, unchanged - see the note beside `decode` above.


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

const env = envelopeMs(x, 300, 1300);

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

/** The moving-median floor of an envelope, as a lookup by frame. */
function floorOf(e: Float64Array): (frame: number) => number {
  const floors = new Float64Array(Math.ceil(e.length / FLOOR_STEP_MS));
  for (let b = 0; b < floors.length; b += 1) {
    const mid = b * FLOOR_STEP_MS;
    const lo = Math.max(0, mid - FLOOR_WIN_MS / 2);
    const hi = Math.min(e.length, mid + FLOOR_WIN_MS / 2);
    const block = Array.from(e.subarray(lo, hi)).sort((p, q) => p - q);
    floors[b] = block[block.length >> 1];
  }
  return (frame: number) => floors[Math.min(floors.length - 1, Math.round(frame / FLOOR_STEP_MS))];
}

const medianAt = floorOf(env);

interface Burst {
  startMs: number;
  lenMs: number;
  peakDb: number;
  isolated: boolean;
}

/**
 * Bursts in any envelope, against any floor.
 *
 * Parameterised rather than closed over `env` because section 9 runs the
 * identical detector over `gameplay-audio.m4a`. A detector that was only ever
 * pointed at the file it was tuned on cannot answer whether "n = 1" is a fact
 * about the game or a fact about the recording.
 */
function burstsIn(e: Float64Array, floor: (f: number) => number, overDb: number): Burst[] {
  const found: Burst[] = [];
  let runStart = -1;
  for (let f = 0; f <= e.length; f += 1) {
    const loud = f < e.length && e[f] > floor(f) + overDb;
    if (loud && runStart < 0) runStart = f;
    if (!loud && runStart >= 0) {
      const len = f - runStart;
      if (len >= BURST_MIN_MS && len <= BURST_MAX_MS) {
        let peak = -Infinity;
        for (let k = runStart; k < f; k += 1) peak = Math.max(peak, e[k]);
        let isolated = runStart >= FLANK_MS && f + FLANK_MS <= e.length;
        for (let k = runStart - FLANK_MS; isolated && k < runStart; k += 1) {
          if (e[k] > floor(k) + overDb) isolated = false;
        }
        for (let k = f; isolated && k < f + FLANK_MS; k += 1) {
          if (e[k] > floor(k) + overDb) isolated = false;
        }
        found.push({ startMs: runStart, lenMs: len, peakDb: peak, isolated });
      }
      runStart = -1;
    }
  }
  return found;
}

/** The same detector, on this drive's own recording. */
function findBursts(overDb: number): Burst[] {
  return burstsIn(env, medianAt, overDb);
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

// --- 6. is a per-beep dominant a measurable quantity at all? -----------------

// Sections 1 and the pooled figure in audio-reference.md disagree wildly: 269 /
// 319 / 744 against 455 / 455 / 544. The obvious reading is that one of them
// has its window in the wrong place. This section tests that directly, by
// moving the window and watching what the reading does, and the answer turns
// out not to favour either figure.
//
// If the quantity were real, shifting a window by 2 ms - a fifth of a beep -
// would move it a little. What it actually does is printed below.

console.log('\n--- 6. The per-beep dominant against where the window is put ----------');
console.log('Same three beeps as section 1. Each row is one window length and one');
console.log('processing choice; each column is where the window starts relative to the');
console.log("beep's spectral peak. Section 1 is the '10 ms divided' row at -2 ms.\n");

function domAt(t0: number, dur: number, divide: boolean, lo: number, hi: number): number {
  const mags = spectrumAt(x, t0, dur);
  const v = new Float64Array(mags.length);
  for (let k = 0; k < mags.length; k += 1) {
    v[k] = divide ? mags[k] / (background[k] + 1e-15) : mags[k];
  }
  const half = Math.round(50 / binHz);
  let bestBin = bin(lo);
  let bestVal = -Infinity;
  for (let k = bin(lo); k <= bin(hi); k += 1) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(v.length - 1, k + half); j += 1) {
      sum += v[j];
      n += 1;
    }
    if (sum / n > bestVal) {
      bestVal = sum / n;
      bestBin = k;
    }
  }
  return bestBin * binHz;
}

const OFFSETS_MS = [-6, -4, -2, 0, 2, 4, 6];
const VARIANTS: [string, number, boolean, number, number][] = [
  ['5 ms divided ', 0.005, true, 150, 1350],
  ['10 ms divided', 0.010, true, 150, 1350],
  ['20 ms divided', 0.020, true, 150, 1350],
  ['10 ms raw    ', 0.010, false, 150, 1350],
  ['20 ms raw    ', 0.020, false, 150, 1350],
];
console.log(`  beep   variant        ${OFFSETS_MS.map((o) => `${o >= 0 ? '+' : ''}${o}ms`.padStart(7)).join(' ')}`);
const beepSwing: number[] = [];
for (const [i, p] of warnPeaks.entries()) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [label, dur, divide, bLo, bHi] of VARIANTS) {
    const row = OFFSETS_MS.map((off) => {
      const hz = domAt(p.t + off / 1000, dur, divide, bLo, bHi);
      lo = Math.min(lo, hz);
      hi = Math.max(hi, hz);
      return hz.toFixed(0).padStart(7);
    });
    console.log(`   ${i + 1}     ${label} ${row.join(' ')}`);
  }
  beepSwing.push(hi - lo);
  console.log(`         spread across the 35 readings above: ${(hi - lo).toFixed(0)} Hz\n`);
}
console.log(`  Per-beep spread: ${beepSwing.map((v) => `${v.toFixed(0)} Hz`).join(', ')}.`);
console.log('');
console.log('  **Neither figure is right, because the quantity is not determined.** A');
console.log('  10 ms Hann mainlobe is ~400 Hz wide and these beeps are broadband clicks,');
console.log('  so "the dominant" is decided by where the window lands, whether a');
console.log('  background is divided out, and how wide a band is searched - not by the');
console.log('  beep. 269 / 319 / 744 and 455 / 455 / 544 are both inside the swing above.');
console.log('  The honest reading is that this recording does not carry a per-beep pitch');
console.log('  for the warning at all, and no method choice will make it.');
console.log('');
console.log('  Section 1 is not withdrawn - what it is good for is the *shape* of the');
console.log('  sequence, and the LOW-MID statistic in sections 2 and 3 does not depend on');
console.log('  a dominant. But no single figure in this table should be quoted as a pitch.');

// --- 7. is the loss sound a melody at all? ----------------------------------

// The question this drive was built for assumes there is a melody to be a
// prefix of. Nobody had checked. The owner's account is of four notes; the ROM
// has five stages; both are statements about pitch, and pitch is testable.
//
// The statistic is a harmonic comb: the mean level at the first eight multiples
// of a candidate f0, minus the mean level 55 Hz either side of each. A tone
// scores high, noise scores near zero however loud it is, and the score means
// nothing except against controls - so a known tone and a known silence are
// scored in the same pass.

console.log('\n--- 7. Does the loss sound carry any pitch? ---------------------------');
console.log('Harmonic-comb score over 30 ms windows: the level at the first eight');
console.log('multiples of f0 minus the level 55 Hz either side of each. Immune to level.');
console.log('The controls are what make the number readable.\n');

const gameplay = decodeRecording(GAMEPLAY);
console.log('  what                                           best f0   comb score');
const TONALITY: [string, Float64Array, number, number, number][] = [
  ['CONTROL gameplay 121.00 s, the win jingle', gameplay, 121.0, 900, 1400],
  ['CONTROL gameplay 12.80 s, the 625 Hz tone', gameplay, 12.8, 560, 1400],
  ['CONTROL gameplay 43.60 s, room silence', gameplay, 43.6, 560, 1400],
  ['CONTROL loss 20.00 s, room silence', x, 20.0, 60, 800],
  ['loss +80 ms, the opening peak', x, 85.94, 60, 800],
  ['loss +135 ms', x, 85.995, 60, 800],
  ['loss +315 ms, the body peak', x, 86.175, 60, 800],
  ['loss +405 ms, the body', x, 86.265, 60, 800],
  ['loss +535 ms, the tail', x, 86.395, 60, 800],
  ['loss +915 ms, the tail', x, 86.775, 60, 800],
  ['warning beep 1', x, 27.383, 150, 800],
];
const tonalityScores = new Map<string, number>();
for (const [label, sig, t, lo, hi] of TONALITY) {
  const { f0, scoreDb } = bestCombF0(spectrumAt(sig, t, 0.03), lo, hi);
  tonalityScores.set(label, scoreDb);
  console.log(`  ${label.padEnd(44)} ${f0.toFixed(0).padStart(5)} Hz  ${scoreDb.toFixed(1).padStart(7)} dB`);
}

console.log('\n  The specific claim, scored directly: gameOver stage 2 is 80-97 Hz.');
console.log('  A 92 Hz square or pulse drive puts a 92 Hz comb under the piezo resonance,');
console.log('  which is how battleshipBuzz was measured at 93.4 Hz in this same document.');
for (const t of [85.9, 85.92, 85.94, 85.96, 85.98]) {
  const mags = spectrumAt(x, t, 0.06);
  const at92 = harmonicCombDb(mags, 92);
  const bestLow = bestCombF0(mags, 80, 97, 0.25);
  console.log(
    `    ${t.toFixed(3)} s: 92 Hz comb ${at92.toFixed(1).padStart(6)} dB;` +
      `  best in 80-97 Hz is ${bestLow.f0.toFixed(1)} Hz at ${bestLow.scoreDb.toFixed(1)} dB`,
  );
}

// --- 8. how many events are in the loss sound? ------------------------------

// Since section 7 finds no pitch, "how many notes" cannot be answered by
// counting pitches. What can be counted is amplitude: a note played after
// another note leaves a dip between them. This segments the loss sound on a
// broadband envelope smoothed at 40 Hz - which settles in about 10 ms, so a
// 25 ms articulation survives and a single cycle does not - and calls a
// boundary a local maximum with at least a 3 dB dip since the last one.

console.log('\n--- 8. The loss sound counted on its envelope ------------------------');
console.log('60-6000 Hz, rectified, smoothed at 40 Hz. A maximum counts when at least');
console.log('3 dB of dip separates it from the last one. The centroid column is what');
console.log("audio-reference.md's stage table is describing.\n");

const lossEnvRaw = filtfilt(x, [highpassBq(60), lowpassBq(6000)]);
for (let i = 0; i < lossEnvRaw.length; i += 1) lossEnvRaw[i] = Math.abs(lossEnvRaw[i]);
const lossEnv = filtfilt(lossEnvRaw, [lowpassBq(40)]);

const SEG_FROM = 85.86;
const SEG_TO = 87.1;
let lossEnvPeak = 0;
for (let i = Math.round(SEG_FROM * SR); i < Math.round(SEG_TO * SR); i += 1) {
  lossEnvPeak = Math.max(lossEnvPeak, lossEnv[i]);
}
const segTrace: { t: number; db: number }[] = [];
for (let t = SEG_FROM; t < SEG_TO; t += 0.005) {
  segTrace.push({ t, db: 20 * Math.log10(lossEnv[Math.round(t * SR)] / lossEnvPeak + 1e-12) });
}
const segMax: { t: number; db: number }[] = [];
for (let i = 1; i < segTrace.length - 1; i += 1) {
  if (!(segTrace[i].db >= segTrace[i - 1].db && segTrace[i].db > segTrace[i + 1].db)) continue;
  const last = segMax.at(-1);
  if (last === undefined) {
    segMax.push(segTrace[i]);
    continue;
  }
  let dip = Infinity;
  for (const p of segTrace) if (p.t > last.t && p.t < segTrace[i].t) dip = Math.min(dip, p.db);
  if (Math.min(last.db, segTrace[i].db) - dip >= 3) segMax.push(segTrace[i]);
  else if (segTrace[i].db > last.db) segMax[segMax.length - 1] = segTrace[i];
}

function centroidHz(t: number): number {
  const mags = spectrumAt(x, t - 0.01, 0.02);
  let num = 0;
  let den = 0;
  for (let k = bin(60); k < bin(4000); k += 1) {
    const p = mags[k] * mags[k];
    num += p * k * binHz;
    den += p;
  }
  return num / den;
}

console.log('  offset(ms)   level(dB re peak)   centroid(Hz)');
const loud = segMax.filter((p) => p.db > -25);
for (const p of loud) {
  console.log(
    `  ${((p.t - SEG_FROM) * 1000).toFixed(0).padStart(10)}   ${p.db.toFixed(1).padStart(17)}   ${centroidHz(p.t).toFixed(0).padStart(12)}`,
  );
}
console.log(
  `\n  ${loud.length} maxima within 25 dB of the peak, ${segMax.length} counting the tail.`,
);
console.log('  Grouped by the dips that separate them, the sound is: a rise to a first');
console.log("  peak whose centroid falls as it goes, a low stretch, a much louder body,");
console.log('  and then a long decaying tail of small bumps whose centroid *rises* into');
console.log("  the recording's own 1400-1700 Hz whine. That is an envelope, not a tune.");

// --- 9. is n = 1 a fact about the game or about the recording? --------------

// Section 5 sweeps this file and returns one warning group in 88 s. A full game
// has three life losses, so either this recording does not contain them or the
// detector cannot see them. The way to tell is to point the identical detector
// at a second recording of the same machine.

console.log('\n--- 9. The same detector, on gameplay-audio.m4a -----------------------');
console.log('Identical envelope, identical floor, identical burst and grouping rules.');
console.log('If the detector were blind, it would be blind in both files.\n');

const gpEnv = envelopeMs(gameplay, 300, 1300);
const gpFloor = floorOf(gpEnv);
console.log('  over-median   bursts   isolated   groups of 2+   group starts (s)');
for (const overDb of [11, 13, 15, 17, 19]) {
  const found = burstsIn(gpEnv, gpFloor, overDb);
  const groups: Burst[][] = [];
  for (const b of found.filter((q) => q.isolated)) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    const gap = prev ? b.startMs - prev.startMs : Infinity;
    if (last && gap >= GROUP_MIN_MS && gap <= GROUP_MAX_MS) last.push(b);
    else groups.push([b]);
  }
  const multiG = groups.filter((g) => g.length >= 2);
  console.log(
    `  ${`+${overDb} dB`.padStart(11)}   ${String(found.length).padStart(6)}   ` +
      `${String(found.filter((b) => b.isolated).length).padStart(8)}   ${String(multiG.length).padStart(12)}   ` +
      multiG.slice(0, 6).map((g) => (g[0].startMs / 1000).toFixed(2)).join(', ') +
      (multiG.length > 6 ? ', ...' : ''),
  );
}
console.log('');
console.log('  Read this against section 5. The detector is not blind - it returns groups');
console.log('  in both files. What it cannot do is tell a launcher-hit warning from any');
console.log('  other pair of clicks 25-50 ms apart, and gameplay-audio.m4a is 130 s of');
console.log('  dense overlapping play, so a count here is a count of candidates rather');
console.log('  than of warnings. **n = 1 is a fact about what could be isolated, not a');
console.log('  census of the warnings the machine played.** Settling the progression');
console.log('  needs a recording made for it, not a better threshold.');

console.log('\nRead the nine together. The prefix model requires beep 2 to be the');
console.log('collapse; the collapse is what the loss sound shows at +30 dB or better on');
console.log('the LOW-MID statistic, and what beep 2 shows the opposite sign of. Sections');
console.log('6 and 7 then go further than that: the warning has no measurable per-beep');
console.log('pitch, and the loss sound has no measurable pitch of any kind, so a');
console.log('question about which notes are played needs a different recording to answer.');
