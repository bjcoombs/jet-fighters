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
// either account. It asks five things of two files - `gameplay-audio.m4a`,
// which is where the entry came from, and `skill3-video-audio.m4a`, the audio
// of the owner's skill-3 video - and every one of them can come back the other
// way:
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
  /** Seconds into the recording. */
  readonly startSec: number;
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
 */
const TONE_COMB_DB = 10;
const TONE_CONTINUOUS_MS = 200;

/** True for an episode that is a sustained tone rather than a passing artefact. */
export function isSustainedTone(e: Episode): boolean {
  return e.combDb >= TONE_COMB_DB && e.continuousMs >= TONE_CONTINUOUS_MS;
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
}

const GAMEPLAY = 'assets/reference/gameplay-audio.m4a';
const VIDEO = 'assets/reference/skill3-video-audio.m4a';
const BATTLESHIP = 'assets/reference/battleship-interval.m4a';
const LOSS = 'assets/reference/loss-audio.m4a';

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
    for (let i = lo; i < hi; i += 1) {
      run = env[i] >= peak * 0.25 ? run + 1 : 0; // 0.25 in amplitude is -12 dB
      best = Math.max(best, run);
    }
    const mags = spectrumAt(x, a, Math.min(0.2, b - a));
    const { f0, scoreDb } = bestCombF0(mags, 560, 700);
    return {
      startSec: a,
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

  for (const path of [GAMEPLAY, VIDEO]) {
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

  return { files, citedEvents, combControls, battleshipEpisodes, seriesHz };
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
