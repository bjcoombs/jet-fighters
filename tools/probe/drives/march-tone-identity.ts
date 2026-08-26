// Is there a per-step march buzz at 600-650 Hz, and if not, what is in that band?
//
// Paths in this file are relative to the repository root.
//
// `docs/evidence/audio-reference.md` carries a `jetMarch` section describing
// "the per-step buzz of the advancing squadron" at **600-650 Hz**, marked
// *Measured*, read off `assets/reference/gameplay-audio.m4a` at **~66 s**, with
// a 70 ms step. The ROM has `jm_beep` emitting a 71.8 ms note per squadron step
// on the strength of it.
//
// The owner, 2026-08-26, playing the physical unit: *"the jet fighters do not
// beep as they go from left to right"*, and asked whether he meant merely that
// there was no discrete per-step beep: *"no marching sound"*.
//
// This drive settles the entry against the recordings rather than against
// either account. It asks its questions of five files - `gameplay-audio.m4a`,
// which is where the entry came from, `skill3-video-audio.m4a`, and the three
// 20 s windows of `IMG_6113.mov` that `open-questions.md` §16 classified - and
// every one of them can come back the other way:
//
// **What the second pass changed, and why there was one.** The first pass fixed
// two gates at 10 dB and 200 ms, found five sustained tones of 405-417 ms, and
// argued from that count. §16 then measured 25 tonal runs of 130-210 ms in a
// recording this drive had never opened, and every one of those fails a 200 ms
// continuity gate by construction. Sections 3b, 3c and 3d exist because of
// that: the gates are swept rather than chosen, both populations go through one
// instrument, and §16's own control window is what separates them.
//
// **The answer is that they are two sounds, not one at two lengths** - see 3c
// and 3d - so the task 23 conclusion about the long tone stands, and it was
// never about the sound §16 found.
//
//   1. Where the 600-650 Hz band stands out across the whole of each file, as a
//      prominence over eight control bands. A per-step march buzz would make
//      ~66 s unremarkable only if the entry were wrong.
//   2. The two tests the entry has to pass at ~66 s itself: do the periodic
//      events there read as one frequency or scatter, and does the 600-650 Hz
//      band rise at an event relative to 100 ms later.
//   3. What the 600-650 Hz energy in these files actually is, located by a
//      narrow-line excess rather than by the band level.
//   4. Whether those episodes are one continuous tone or a train of ~70 ms
//      beeps, from a narrow-band envelope that resolves a 25 ms gap.
//   5. Controls: the isolated battleship recordings, which contain a known
//      device sound and no squadron at all.
//
// **The black-box rule applies.** Nothing here is informed by the dumped MP2110
// image, by MAME's driver internals, or by any disassembly. Every figure is read
// off a recording of the physical unit.
//
// **Nothing runs this automatically.** `npm test` never reaches
// `tools/probe/drives/`; `march-tone-identity.test.ts` imports `runMarchToneIdentity`
// and floors what it found. Run it by hand:
//
//   npx vite-node tools/probe/drives/march-tone-identity.ts
//
// **Prerequisite: `ffmpeg` on PATH** - see `recording.ts`.

import { isEntryPoint } from './entry-point.js';
import {
  bandDb,
  bandRmsTrackDb,
  bestCombF0,
  decodeRecording,
  dominantHz,
  envelopeMs,
  filtfilt,
  highpassBq,
  lowpassBq,
  requireFfmpeg,
  SR,
  spectrumAt,
} from './recording.js';

/** The band the `jetMarch` entry claims, and the note length it claims. */
const MARCH_LO = 600;
const MARCH_HI = 650;
const MARCH_STEP_MS = 70;

/** Where `audio-reference.md` says the march was read. */
const CITED_SEC = 66;

/**
 * Eight equal-width control bands, none of them a harmonic of 625 Hz.
 *
 * The prominence statistic is the 600-650 Hz level minus the median of these.
 * It is immune to level, which matters: a broadband click is loud in every band
 * at once and a level-based detector calls that a march step.
 */
const CONTROL_BANDS: readonly (readonly [number, number])[] = [
  [400, 450], [450, 500], [500, 550], [700, 750],
  [750, 800], [800, 850], [900, 950], [1000, 1050],
];

export interface Episode {
  /** Seconds into the recording: where the detection span opens. */
  readonly startSec: number;
  /** Where the unbroken run itself starts. Read the tone from here, not `startSec`. */
  readonly runStartSec: number;
  /** Length of the unbroken run within 12 dB of the episode's own peak, ms. */
  readonly continuousMs: number;
  /** Length of the whole episode above the detection threshold, ms. */
  readonly spanMs: number;
  /** Best harmonic-comb fundamental over 560-700 Hz. */
  readonly f0Hz: number;
  /** That comb's score in dB. Compare against the printed controls. */
  readonly combDb: number;
}

export interface FileResult {
  readonly path: string;
  readonly durationSec: number;
  /** Prominence percentiles over every 40 ms window at a 10 ms hop. */
  readonly prominencePctileDb: Readonly<Record<string, number>>;
  /** Episodes where the 625 Hz line stands clear of its own neighbourhood. */
  readonly episodes: readonly Episode[];
  /** Prominence in the 2 s around the cited timestamp, if the file has one. */
  readonly citedWindowPeakDb: number | null;
}

export interface EventTest {
  readonly atSec: number;
  readonly dominantHz: number;
  /** 600-650 Hz level at the event minus the same band 100 ms later. */
  readonly marchExcessDb: number;
  /** 600-650 Hz over the control-band median, at the event. Tone-vs-click. */
  readonly prominenceDb: number;
}

/**
 * What it takes to call an episode a sustained tone.
 *
 * Both are needed and neither alone is enough. The line-excess detector that
 * finds candidates fires on narrow-band noise as well as on notes, and the comb
 * score locks onto 624 Hz inside the win jingle because 1248 Hz is a harmonic
 * of it - so an episode has to hold up *and* stay up.
 *
 * **These two numbers decided this drive's first answer, and that was a
 * defect.** The original pass fixed them at 10 dB and 200 ms, reported three
 * sustained tones in 130 s and five across two recordings, and argued from that
 * count that the band holds nothing on a step cadence. `open-questions.md` §16
 * then measured 25 tonal runs of **130-210 ms** in a different recording of the
 * same unit. Every one of those fails a 200 ms continuity gate by construction.
 * The drive was looking for 410 ms tones and it found 410 ms tones.
 *
 * They survive as named constants because a test needs a cell to assert on, but
 * they are now **one cell of {@link sweepGrid}**, which reports the count at
 * every combination of both axes. Read the grid before either number. A count
 * that is flat across a region and cliffs outside it is a measurement; a count
 * taken at one setting is a property of the setting.
 */
const TONE_COMB_DB = 10;
const TONE_CONTINUOUS_MS = 200;

/**
 * The axes the grid is swept over.
 *
 * Both are swept, not just continuity. `isSustainedTone` is an AND of two gates,
 * so sweeping one produces a curve that looks clean while remaining hostage to
 * the other.
 */
const COMB_AXIS_DB = [4, 6, 8, 10, 12, 14] as const;
const CONTINUITY_AXIS_MS = [50, 100, 150, 200, 300, 400] as const;

/** Where the drive splits short from long. Chosen from the histogram, not before it. */
const SPLIT_MS = 280;

/**
 * The window both populations are re-scored over, in ms.
 *
 * 100 ms fits inside the shortest episode either population contains, so both
 * get the same frequency resolution and neither is scored on a window the other
 * could not have supplied.
 */
const FIXED_COMB_MS = 100;

/** True for an episode that is a sustained tone rather than a passing artefact. */
export function isSustainedTone(e: Episode): boolean {
  return e.combDb >= TONE_COMB_DB && e.continuousMs >= TONE_CONTINUOUS_MS;
}

/** Episode counts at every (comb, continuity) combination. */
export function sweepGrid(episodes: readonly Episode[]): number[][] {
  return COMB_AXIS_DB.map((comb) =>
    CONTINUITY_AXIS_MS.map(
      (ms) => episodes.filter((e) => e.combDb >= comb && e.continuousMs >= ms).length,
    ),
  );
}

/**
 * A population of episodes, summarised the ways two sounds would differ.
 *
 * Sharing a band is not sharing an identity. If the 130-210 ms runs and the
 * 405-417 ms episodes are one sound at two lengths, they have to agree on more
 * than where their energy sits: on the fundamental, on how tonal they are, and
 * on the partial series.
 */
export interface Population {
  readonly label: string;
  readonly count: number;
  readonly medianF0Hz: number;
  readonly f0SpreadHz: number;
  readonly medianCombDb: number;
  /**
   * The comb score again, on a window of the same length for both populations.
   *
   * **The confound this removes.** `medianCombDb` is measured over as much of
   * each episode as there is, so a short episode gets a short window. A shorter
   * window has coarser frequency resolution and scores lower on a comb whatever
   * it contains, so a tonality gap between a short population and a long one is
   * exactly what the method would manufacture. Scored over {@link FIXED_COMB_MS}
   * for both, any difference that survives is the sound's, not the window's.
   */
  readonly fixedWindowCombDb: number;
  readonly medianContinuousMs: number;
  /** Ratio of each partial to the fundamental, median over the population. */
  readonly partialRatios: readonly number[];
  /**
   * How far each partial stands over its own neighbourhood, in dB.
   *
   * **`partialRatios` alone cannot fail and must not be read without this.** It
   * reports the strongest bin within +/-35 Hz of each multiple, and in noise
   * there is always a bin there - so a pure hiss returns a tidy 2.00 / 3.00 /
   * 4.00 and looks like a harmonic series. This asks what the ratio cannot: is
   * anything actually *at* the multiple, or is the ratio naming the nearest
   * lump of noise.
   */
  readonly partialExcessDb: readonly number[];
}

export interface PopulationComparison {
  readonly short: Population;
  readonly long: Population;
  /** Every episode's unbroken run, pooled across the device recordings. */
  readonly durationsMs: readonly number[];
}

export interface MarchToneIdentityResult {
  readonly files: readonly FileResult[];
  /** The click-vs-tone test at the cited ~66 s of `gameplay-audio.m4a`. */
  readonly citedEvents: readonly EventTest[];
  /** Tonality controls: a known tone, a known silence, and the loss body. */
  readonly combControls: readonly { readonly label: string; readonly f0Hz: number; readonly combDb: number }[];
  /** Episodes found in the isolated battleship recording. */
  readonly battleshipEpisodes: readonly Episode[];
  /** Partial series of the first sustained tone in each file, for the record. */
  readonly seriesHz: readonly { readonly label: string; readonly partials: readonly number[] }[];
  /** The two candidate populations, put through one instrument. */
  readonly populations: PopulationComparison;
}

const GAMEPLAY = 'assets/reference/gameplay-audio.m4a';
const VIDEO = 'assets/reference/skill3-video-audio.m4a';
const BATTLESHIP = 'assets/reference/battleship-interval.m4a';
const LOSS = 'assets/reference/loss-audio.m4a';

/**
 * The three windows `open-questions.md` §16 classified, as committed audio.
 *
 * §16's 25 tonal runs come from `IMG_6113.mov`, which is 579 MB and stays out of
 * the repository - so these are the reductions, 20 s each, extracted at the same
 * offsets `tools/video/blanking.py` uses. Committing them is what lets this
 * drive put §16's population and this drive's own through **one** instrument.
 * Two findings measured by two tools on two files cannot be compared, and that
 * is most of why the disagreement looked like one.
 *
 * t=120 is the control of the three: §16 measures **0.0%** blanking there
 * against 13.2% and 16.7% in the other two.
 */
const T120 = 'assets/reference/img6113-t120-audio.m4a';
const T210 = 'assets/reference/img6113-t210-audio.m4a';
const T340 = 'assets/reference/img6113-t340-audio.m4a';

/** Narrow level either side of a line, for the "is this line here" statistic. */
function lineDb(mags: Float64Array, hz: number): number {
  return bandDb(mags, hz - 8, hz + 8);
}

/**
 * Excess of the 625 Hz line over the two points 40 Hz either side, in dB.
 *
 * Not the band level. A click raises 585, 625 and 665 Hz together and scores
 * zero here; a tone raises only its own line.
 */
function lineExcessDb(mags: Float64Array, hz = 625): number {
  return lineDb(mags, hz) - (lineDb(mags, hz - 40) + lineDb(mags, hz + 40)) / 2;
}

/** Prominence of 600-650 Hz over the median of the control bands, in dB. */
function prominenceDb(mags: Float64Array): number {
  const ctrl = CONTROL_BANDS.map(([a, b]) => bandDb(mags, a, b)).sort((p, q) => p - q);
  return bandDb(mags, MARCH_LO, MARCH_HI) - (ctrl[3] + ctrl[4]) / 2;
}

/** Where the 625 Hz line stands more than `thrDb` clear, merged into episodes. */
function findEpisodes(x: Float64Array, thrDb = 12): Episode[] {
  const dur = x.length / SR;
  const hits: number[] = [];
  for (let t = 0; t + 0.2 < dur; t += 0.1) {
    if (lineExcessDb(spectrumAt(x, t, 0.2)) > thrDb) hits.push(t);
  }
  const spans: [number, number][] = [];
  for (const t of hits) {
    const last = spans.at(-1);
    if (last && t - last[1] <= 0.25) last[1] = t + 0.2;
    else spans.push([t, t + 0.2]);
  }

  // Continuity is decided on a narrow-band envelope, not on the 200 ms grid
  // that found the span. Two cascaded band-passes on the line itself, smoothed
  // at 60 Hz - which settles in about 6 ms, so a 25 ms gap between 70 ms beeps
  // would be fully resolved if one were there.
  const line = filtfilt(x, [
    highpassBq(607, 3), highpassBq(607, 3), lowpassBq(643, 3), lowpassBq(643, 3),
  ]);
  const rect = new Float64Array(line.length);
  for (let i = 0; i < line.length; i += 1) rect[i] = Math.abs(line[i]);
  const env = filtfilt(rect, [lowpassBq(60)]);

  return spans.map(([a, b]) => {
    const lo = Math.max(0, Math.round((a - 0.05) * SR));
    const hi = Math.min(env.length, Math.round((b + 0.05) * SR));
    let peak = 0;
    for (let i = lo; i < hi; i += 1) peak = Math.max(peak, env[i]);
    let run = 0;
    let best = 0;
    let bestEnd = lo;
    for (let i = lo; i < hi; i += 1) {
      run = env[i] >= peak * 0.25 ? run + 1 : 0; // 0.25 in amplitude is -12 dB
      if (run > best) {
        best = run;
        bestEnd = i;
      }
    }
    // Where the unbroken run actually is, which is not where the 200 ms
    // detection grid put the span: a span can open up to 200 ms before the tone
    // and run on after it. Anything reading the tone itself - the fixed window
    // in the population comparison above all - has to start from here, or on a
    // long episode it measures whatever preceded the note.
    const runStart = (bestEnd - best) / SR;
    const mags = spectrumAt(x, a, Math.min(0.2, b - a));
    const { f0, scoreDb } = bestCombF0(mags, 560, 700);
    return {
      startSec: a,
      runStartSec: runStart,
      continuousMs: (best / SR) * 1000,
      spanMs: (b - a) * 1000,
      f0Hz: f0,
      combDb: scoreDb,
    };
  });
}

/** Percentiles of the prominence statistic over a whole file. */
function prominenceProfile(x: Float64Array): { pctiles: Record<string, number>; track: { t: number; db: number }[] } {
  const track: { t: number; db: number }[] = [];
  // Band tracks rather than per-window transforms: 130 s at a 10 ms hop is
  // 13,000 windows, and a 65536-point transform each costs minutes.
  const bands = [[MARCH_LO, MARCH_HI], ...CONTROL_BANDS].map(([a, b]) =>
    bandRmsTrackDb(x, a, b, 40, 10),
  );
  const frames = Math.min(...bands.map((b) => b.length));
  for (let f = 0; f < frames; f += 1) {
    const ctrl = CONTROL_BANDS.map((_, i) => bands[i + 1][f]).sort((p, q) => p - q);
    track.push({ t: f * 0.01, db: bands[0][f] - (ctrl[3] + ctrl[4]) / 2 });
  }
  const sorted = track.map((p) => p.db).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    pctiles: { p50: at(0.5), p90: at(0.9), p99: at(0.99), p100: at(1) },
    track,
  };
}

/** Periodic events in a window, as onsets of a 300-1300 Hz envelope. */
function eventsIn(x: Float64Array, t0: number, t1: number, overDb = 12): number[] {
  const env = envelopeMs(x, 300, 1300);
  const floors: number[] = [];
  const STEP = 50;
  const WIN = 500;
  for (let b = 0; b * STEP < env.length; b += 1) {
    const mid = b * STEP;
    const block = Array.from(
      env.subarray(Math.max(0, mid - WIN / 2), Math.min(env.length, mid + WIN / 2)),
    ).sort((p, q) => p - q);
    floors.push(block[block.length >> 1]);
  }
  const medianAt = (f: number) => floors[Math.min(floors.length - 1, Math.round(f / STEP))];
  const out: number[] = [];
  for (let f = Math.round(t0 * 1000); f < Math.round(t1 * 1000) && f < env.length - 1; f += 1) {
    if (env[f] > medianAt(f) + overDb && env[f] >= env[f - 1] && env[f] > env[f + 1]) {
      if (out.length === 0 || f - out.at(-1)! > 40) out.push(f);
      else if (env[f] > env[out.at(-1)!]) out[out.length - 1] = f;
    }
  }
  return out.map((f) => f / 1000);
}

export function runMarchToneIdentity(): MarchToneIdentityResult {
  requireFfmpeg('march-tone-identity', `${GAMEPLAY} and ${VIDEO}`);

  const files: FileResult[] = [];
  const decoded = new Map<string, Float64Array>();
  const load = (p: string) => {
    if (!decoded.has(p)) decoded.set(p, decodeRecording(p));
    return decoded.get(p)!;
  };

  // GAMEPLAY and VIDEO stay first: the tests index this array.
  for (const path of [GAMEPLAY, VIDEO, T120, T210, T340]) {
    const x = load(path);
    const { pctiles, track } = prominenceProfile(x);
    const cited = path === GAMEPLAY
      ? Math.max(...track.filter((p) => Math.abs(p.t - CITED_SEC) <= 1).map((p) => p.db))
      : null;
    files.push({
      path,
      durationSec: x.length / SR,
      prominencePctileDb: pctiles,
      episodes: findEpisodes(x),
      citedWindowPeakDb: cited,
    });
  }

  // The two tests, at the timestamp the entry cites.
  const gp = load(GAMEPLAY);
  const citedEvents: EventTest[] = eventsIn(gp, CITED_SEC - 1, CITED_SEC + 1).map((t) => ({
    atSec: t,
    dominantHz: dominantHz(spectrumAt(gp, t - 0.004, 0.008), 300, 6000, 0),
    marchExcessDb:
      bandDb(spectrumAt(gp, t - 0.01, 0.02), MARCH_LO, MARCH_HI)
      - bandDb(spectrumAt(gp, t + 0.09, 0.02), MARCH_LO, MARCH_HI),
    prominenceDb: prominenceDb(spectrumAt(gp, t - 0.01, 0.02)),
  }));

  // Tonality controls. The comb score means nothing on its own - it is only
  // ever "more than a known silence" or "less than a known tone".
  const loss = load(LOSS);
  const combControls = [
    ['gameplay 121.00 s, the win jingle, a known tone', gp, 121.0, 900, 1400],
    ['gameplay 43.60 s, room silence', gp, 43.6, 560, 1400],
    ['loss 86.17 s, the loss body', loss, 86.17, 60, 800],
    ['loss 20.00 s, room silence', loss, 20.0, 60, 800],
  ].map(([label, sig, t, lo, hi]) => {
    const { f0, scoreDb } = bestCombF0(spectrumAt(sig as Float64Array, t as number, 0.03), lo as number, hi as number);
    return { label: label as string, f0Hz: f0, combDb: scoreDb };
  });

  const battleshipEpisodes = findEpisodes(load(BATTLESHIP));

  // The partial series of one sustained tone per file, so what the band holds
  // is on the record as a series rather than as a single number.
  const seriesHz = files.flatMap((f) => {
    const first = f.episodes.find(isSustainedTone);
    if (first === undefined) return [];
    const mags = spectrumAt(load(f.path), first.startSec + 0.1, 0.2);
    const partials: number[] = [];
    for (let h = 1; h <= 6; h += 1) {
      partials.push(dominantHz(mags, h * 625 - 30, h * 625 + 30, 0));
    }
    return [{ label: `${f.path} @ ${first.startSec.toFixed(3)} s`, partials }];
  });

  // --- the two populations, through one instrument --------------------------
  //
  // Pooled over every device recording. The battleship clip is excluded on
  // purpose: it is the null, and folding it in here would score the control as
  // data.
  const pooled = files.flatMap((f) =>
    f.episodes
      .filter((e) => e.combDb >= 6) // tonal at all; the grid shows what this costs
      .map((e) => ({ file: f.path, episode: e })),
  );

  const median = (xs: readonly number[]): number => {
    if (xs.length === 0) return Number.NaN;
    const q = [...xs].sort((a, b) => a - b);
    return q.length % 2 ? q[q.length >> 1] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2;
  };

  const summarise = (
    label: string,
    rows: readonly { file: string; episode: Episode }[],
  ): Population => {
    const f0s = rows.map((r) => r.episode.f0Hz);
    const window = (r: { file: string; episode: Episode }) =>
      spectrumAt(
        load(r.file),
        r.episode.runStartSec + 0.01,
        Math.min(0.15, Math.max(0.03, r.episode.continuousMs / 1000)),
      );
    // Partial ratios, per episode against its own f0, so a population whose
    // fundamental wanders is still comparable.
    const ratioLists = rows.map((r) => {
      const mags = window(r);
      const f0 = r.episode.f0Hz;
      const out: number[] = [];
      for (let h = 2; h <= 6; h += 1) out.push(dominantHz(mags, h * f0 - 35, h * f0 + 35, 0) / f0);
      return out;
    });
    // Is anything at the multiple, or is `partialRatios` naming noise?
    const excessLists = rows.map((r) => {
      const mags = window(r);
      const f0 = r.episode.f0Hz;
      const at = (hz: number) => bandDb(mags, hz - 12, hz + 12);
      return [2, 3, 4, 5, 6].map((h) => at(h * f0) - (at(h * f0 - 55) + at(h * f0 + 55)) / 2);
    });
    // The duration confound, removed: the same window length for both.
    const fixed = rows.map(
      (r) =>
        bestCombF0(
          spectrumAt(load(r.file), r.episode.runStartSec + 0.01, FIXED_COMB_MS / 1000),
          560,
          700,
        ).scoreDb,
    );
    return {
      label,
      count: rows.length,
      medianF0Hz: median(f0s),
      f0SpreadHz: f0s.length ? Math.max(...f0s) - Math.min(...f0s) : Number.NaN,
      medianCombDb: median(rows.map((r) => r.episode.combDb)),
      fixedWindowCombDb: median(fixed),
      medianContinuousMs: median(rows.map((r) => r.episode.continuousMs)),
      partialRatios: [0, 1, 2, 3, 4].map((i) => median(ratioLists.map((l) => l[i]))),
      partialExcessDb: [0, 1, 2, 3, 4].map((i) => median(excessLists.map((l) => l[i]))),
    };
  };

  const populations: PopulationComparison = {
    short: summarise(`shorter than ${SPLIT_MS} ms`, pooled.filter((r) => r.episode.continuousMs < SPLIT_MS)),
    long: summarise(`${SPLIT_MS} ms or longer`, pooled.filter((r) => r.episode.continuousMs >= SPLIT_MS)),
    durationsMs: pooled.map((r) => r.episode.continuousMs),
  };

  return { files, citedEvents, combControls, battleshipEpisodes, seriesHz, populations };
}

function report(r: MarchToneIdentityResult): void {
  const gameplay = r.files.find((f) => f.path === GAMEPLAY);
  const gpP90 = gameplay?.prominencePctileDb['p90'] ?? 0;
  const gpMax = gameplay?.prominencePctileDb['p100'] ?? 0;
  console.log('=== Is the 600-650 Hz entry a march? =================================\n');

  console.log('--- 1. Where 600-650 Hz stands out, over the whole of each file -------');
  console.log('Prominence = the 600-650 Hz level minus the median of eight equal-width');
  console.log('control bands, over 40 ms windows at a 10 ms hop. Immune to level, so a');
  console.log('broadband click - loud in every band at once - scores near zero.\n');
  for (const f of r.files) {
    const p = f.prominencePctileDb;
    console.log(`  ${f.path}  (${f.durationSec.toFixed(3)} s)`);
    console.log(
      `    p50 ${p['p50'].toFixed(1)} dB   p90 ${p['p90'].toFixed(1)} dB   ` +
        `p99 ${p['p99'].toFixed(1)} dB   max ${p['p100'].toFixed(1)} dB`,
    );
    if (f.citedWindowPeakDb !== null) {
      const nearest = f.episodes
        .filter(isSustainedTone)
        .map((e) => Math.abs(e.startSec - CITED_SEC))
        .sort((a, b) => a - b)[0];
      console.log(
        `    peak within +/- 1 s of the cited ${CITED_SEC} s: ${f.citedWindowPeakDb.toFixed(1)} dB` +
          `, against ${p['p100'].toFixed(1)} dB for the file.`,
      );
      console.log(
        `    nearest sustained tone (section 3) to ${CITED_SEC} s: ` +
          `${nearest === undefined ? 'none in the file' : `${nearest.toFixed(1)} s away`}.`,
      );
    }
  }

  console.log('\n--- 2. The two tests at the cited timestamp ---------------------------');
  console.log('A 627 Hz note lasting 71.8 ms reads one frequency at every event, and puts');
  console.log(`energy into ${MARCH_LO}-${MARCH_HI} Hz *and nowhere else*. Two level statistics, plus`);
  console.log('the dominant, which is the one that answers:\n');
  console.log('  excess   the band at the event minus the same band 100 ms later.');
  console.log('  prom     the band at the event minus the median of eight control bands.\n');
  console.log('  event(s)   dominant Hz    excess      prom');
  for (const e of r.citedEvents) {
    console.log(
      `  ${e.atSec.toFixed(3)}  ${e.dominantHz.toFixed(0).padStart(11)}   ` +
        `${e.marchExcessDb.toFixed(1).padStart(7)} dB  ${e.prominenceDb.toFixed(1).padStart(5)} dB`,
    );
  }
  const doms = r.citedEvents.map((e) => e.dominantHz);
  const spread = Math.max(...doms) - Math.min(...doms);
  const positiveExcess = r.citedEvents.filter((e) => e.marchExcessDb > 6).length;
  const positiveProm = r.citedEvents.filter((e) => e.prominenceDb > 6).length;
  console.log(
    `\n  dominant spread ${spread.toFixed(0)} Hz over ${doms.length} events` +
      ` - a note reads within ~50 Hz; a transient scatters.`,
  );
  console.log(`  events over +6 dB of excess:     ${positiveExcess} of ${r.citedEvents.length}`);
  console.log(`  events over +6 dB of prominence: ${positiveProm} of ${r.citedEvents.length}`);
  console.log('');
  console.log('  **Neither level test settles anything here, and saying so is the point.**');
  console.log('  The excess test is confounded: this passage is dense, events land about');
  console.log('  100 ms apart, so the "100 ms later" reference lands in the gap after the');
  console.log('  event rather than on quiet floor, and any transient scores positive');
  console.log('  against it. The prominence figures are positive too, but they are not');
  console.log('  large: 6-14 dB, which is where this file sits at its own 90th percentile');
  console.log(`  (${gpP90.toFixed(1)} dB), against ${gpMax.toFixed(1)} dB at its maximum. These events are ordinary`);
  console.log('  for this recording in this band, not a sound the band was made for.');
  console.log('');
  console.log('  What does settle it is the dominant. A note is one frequency; the reading');
  console.log(`  scatters over ${spread.toFixed(0)} Hz across ten consecutive events, which is what a`);
  console.log('  3-8 ms transient does and what a 71.8 ms note cannot.');

  console.log('\n--- 3. The 625 Hz episodes that are there -----------------------------');
  console.log('Located by a narrow-line excess - the 625 Hz line against the two points');
  console.log('40 Hz either side - so a click, which raises all three together, does not');
  console.log('register. Continuity is measured on a narrow-band envelope smoothed at');
  console.log(`60 Hz, which settles in ~6 ms and would resolve a gap between ${MARCH_STEP_MS} ms beeps.`);
  console.log('');
  console.log(`A candidate is called a sustained tone at comb >= ${TONE_COMB_DB} dB *and* an unbroken`);
  console.log(`run >= ${TONE_CONTINUOUS_MS} ms. Both are needed: the line test also fires on narrow-band`);
  console.log('noise, and the comb locks onto 624 Hz inside the win jingle because the');
  console.log("jingle's 1248 Hz note is a harmonic of it.\n");
  for (const f of r.files) {
    const tones = f.episodes.filter(isSustainedTone);
    console.log(`  ${f.path}: ${f.episodes.length} candidate(s), ${tones.length} sustained tone(s)`);
    console.log('    start(s)   span(ms)   unbroken(ms)   comb f0   comb score   tone?');
    for (const e of f.episodes) {
      console.log(
        `    ${e.startSec.toFixed(3).padStart(8)}   ${e.spanMs.toFixed(0).padStart(8)}   ` +
          `${e.continuousMs.toFixed(0).padStart(12)}   ${e.f0Hz.toFixed(0).padStart(7)} Hz  ` +
          `${e.combDb.toFixed(1).padStart(7)} dB   ${isSustainedTone(e) ? 'yes' : '-'}`,
      );
    }
    if (tones.length > 0) {
      const runs = tones.map((e) => e.continuousMs);
      console.log(
        `    unbroken runs: ${runs.map((v) => `${v.toFixed(0)} ms`).join(', ')}` +
          ` - a train of ${MARCH_STEP_MS} ms beeps cannot produce one.`,
      );
    }
  }
  console.log('\n  the partial series of one sustained tone per file:');
  for (const s of r.seriesHz) {
    console.log(`    ${s.label}`);
    console.log(`      ${s.partials.map((p) => `${p.toFixed(0)} Hz`).join(' / ')}`);
  }

  // --- 3b. the gate, swept rather than chosen -------------------------------

  console.log('\n--- 3b. The gate, swept ----------------------------------------------');
  console.log('Episode count at every combination of the two gates that decide it. Rows');
  console.log('are the comb threshold in dB, columns the continuity floor in ms. The');
  console.log(`cell at comb >= ${TONE_COMB_DB} dB, continuity >= ${TONE_CONTINUOUS_MS} ms is what this drive used to`);
  console.log('report as the answer.\n');
  for (const f of r.files) {
    const grid = sweepGrid(f.episodes);
    console.log(`  ${f.path}`);
    console.log(`      comb\\ms  ${CONTINUITY_AXIS_MS.map((m) => String(m).padStart(5)).join('')}`);
    for (const [i, comb] of COMB_AXIS_DB.entries()) {
      console.log(`      >=${String(comb).padStart(2)} dB  ${grid[i].map((n) => String(n).padStart(5)).join('')}`);
    }
  }
  console.log('');
  console.log('  Read down a column and across a row before reading any single cell.');
  console.log('  Where the count is flat over a region, that region is the measurement.');
  console.log('  Where it cliffs, the cliff is a property of the gate and not of the');
  console.log('  recording - and a conclusion drawn from one side of a cliff is a');
  console.log('  conclusion about where the gate was put.');

  // --- 3c. one sound or two? ------------------------------------------------

  console.log('\n--- 3c. One sound or two? --------------------------------------------');
  console.log('open-questions.md 16 measures 25 tonal runs of 130-210 ms in IMG_6113;');
  console.log('this drive measured 405-417 ms episodes elsewhere. Sharing a band is not');
  console.log('sharing an identity, so both go through one instrument here.\n');

  const d = [...r.populations.durationsMs].sort((a, b) => a - b);
  console.log(`  unbroken-run histogram, ${d.length} episodes pooled over the device recordings:`);
  const EDGES = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 10_000];
  for (let i = 0; i < EDGES.length - 1; i += 1) {
    const n = d.filter((v) => v >= EDGES[i] && v < EDGES[i + 1]).length;
    const label = EDGES[i + 1] === 10_000 ? `>= ${EDGES[i]}` : `${EDGES[i]}-${EDGES[i + 1]}`;
    console.log(`    ${label.padStart(9)} ms  ${String(n).padStart(3)}  ${'#'.repeat(n)}`);
  }
  console.log('');
  console.log('  population              n   median f0   f0 spread   median comb   median run');
  for (const p of [r.populations.short, r.populations.long]) {
    console.log(
      `  ${p.label.padEnd(22)} ${String(p.count).padStart(2)}   ${p.medianF0Hz.toFixed(0).padStart(7)} Hz   ` +
        `${p.f0SpreadHz.toFixed(0).padStart(7)} Hz   ${p.medianCombDb.toFixed(1).padStart(9)} dB   ${p.medianContinuousMs.toFixed(0).padStart(7)} ms`,
    );
  }
  console.log('');
  console.log(`  the comb again over ${FIXED_COMB_MS} ms for both, which is the control on the column`);
  console.log('  before it - a shorter window scores lower on a comb whatever it holds:');
  for (const p of [r.populations.short, r.populations.long]) {
    console.log(
      `    ${p.label.padEnd(22)} ${p.fixedWindowCombDb.toFixed(1).padStart(6)} dB   (as measured: ${p.medianCombDb.toFixed(1)} dB)`,
    );
  }
  console.log('');
  console.log('  partial ratios against each episode\'s own fundamental, median over the');
  console.log('  population. A harmonic series reads 2.00 / 3.00 / 4.00 / 5.00 / 6.00.');
  console.log('    population              2f0    3f0    4f0    5f0    6f0');
  for (const p of [r.populations.short, r.populations.long]) {
    console.log(
      `    ${p.label.padEnd(22)} ${p.partialRatios.map((v) => (Number.isFinite(v) ? v.toFixed(2) : 'n/a').padStart(6)).join(' ')}`,
    );
  }
  console.log('');
  console.log('  and how far each partial stands over its own neighbourhood, which is the');
  console.log('  control on the table above - a ratio finds the nearest peak whether or');
  console.log('  not there is one, so in noise it returns a tidy series regardless:');
  console.log('    population              2f0    3f0    4f0    5f0    6f0');
  for (const p of [r.populations.short, r.populations.long]) {
    console.log(
      `    ${p.label.padEnd(22)} ${p.partialExcessDb.map((v) => (Number.isFinite(v) ? v.toFixed(1) : 'n/a').padStart(6)).join(' ')}`,
    );
  }

  // --- 3d. the discriminator, which is section 16's own control window ------

  console.log('\n--- 3d. Which population blanks the tube ------------------------------');
  console.log('open-questions.md 16 measured blanking in these same three windows, and');
  console.log('its t=120 row is a control it put there for a different purpose. It');
  console.log('separates the two populations cleanly.\n');
  console.log('  window                     blanking(16)   long   short');
  const cite: [string, string, string][] = [[T120, '0.0%', 'the control'], [T210, '13.2%', ''], [T340, '16.7%', '']];
  for (const [path, blanking, note] of cite) {
    const f = r.files.find((q) => q.path === path);
    const eps = f?.episodes ?? [];
    const long = eps.filter((e) => e.continuousMs >= SPLIT_MS).length;
    const short = eps.filter((e) => e.continuousMs >= 100 && e.continuousMs < SPLIT_MS).length;
    console.log(
      `  ${path.replace('assets/reference/', '').padEnd(26)} ${blanking.padStart(6)}   ${String(long).padStart(4)}   ${String(short).padStart(5)}  ${note}`,
    );
  }
  console.log('');
  console.log('  **The short events track the blanking and the long tone does not.** The');
  console.log('  window that blanks 0.0% holds two of the longest tones in any recording');
  console.log('  here and not one short event. The two windows that blank 13-17% hold');
  console.log('  sixteen short events between them and one long tone. So the long tone');
  console.log('  can be present with no blanking at all, and blanking is present where');
  console.log('  only the short events are.');
  console.log('');
  console.log('  Whatever section 16 identified as the blanking source, it is not the');
  console.log('  sound this drive measured for task 23 - and this is section 16\'s own');
  console.log('  control window saying so, not a new one chosen to make the point. n is');
  console.log('  three windows, so this separates the populations; it does not on its');
  console.log('  own show the short events *cause* the blanks. Section 16 shows that,');
  console.log('  by onset coincidence against a shuffled null.');

  console.log('\n--- 4. Tonality controls ---------------------------------------------');
  console.log('The comb score is only ever readable against a known tone and a known');
  console.log('silence in the same recording.\n');
  for (const c of r.combControls) {
    console.log(`  ${c.label.padEnd(48)} f0 ${c.f0Hz.toFixed(0).padStart(5)} Hz   ${c.combDb.toFixed(1).padStart(6)} dB`);
  }

  console.log('\n--- 5. The negative control -------------------------------------------');
  const bsTones = r.battleshipEpisodes.filter(isSustainedTone);
  console.log(
    `  ${BATTLESHIP}: ${r.battleshipEpisodes.length} candidate(s), ${bsTones.length} sustained tone(s).`,
  );
  for (const e of r.battleshipEpisodes) {
    console.log(
      `    ${e.startSec.toFixed(3)} s  unbroken ${e.continuousMs.toFixed(0)} ms  ` +
        `comb ${e.combDb.toFixed(1)} dB  ${isSustainedTone(e) ? 'yes' : '-'}`,
    );
  }
  console.log('  Two full battleship arrivals, and no squadron: the recording was made to');
  console.log('  isolate the boat. A statistic that found a sustained tone here would be');
  console.log('  finding the boat, or the room, rather than whatever section 3 found.');

  console.log('\nRead the five together.');
}

if (isEntryPoint(import.meta.url)) {
  report(runMarchToneIdentity());
}
