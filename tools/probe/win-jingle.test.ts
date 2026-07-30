// The win jingle, and the one thing about it a player would notice.
//
// Paths in this file are relative to the repository root.
//
// ## The gap this closes
//
// `tools/probe/speaker-bands.test.ts` carries the jingle's three fundamentals
// and said, in its own comment on those rows:
//
//     win.fundamentalsHz, +/- 3%. The jingle needs 199 points and is not reached
//     by the scenarios below; the rows are here so the table is the whole
//     contract.
//
// Reaching them turned out to matter twice over: the rows had never run, and one
// of them was a bound this machine cannot meet from either side. See
// {@link ARPEGGIO_TOLERANCE}.
//
// So the one sound with a documented resolution had no assertion behind it, in
// the suite that exists to police sounds. The owner reported "the last note of
// the game win is a high note, not a low note" and there was nothing in the tree
// that could have caught it either way.
//
// ## That report was a description, and it was read as a question
//
// The first pass on it measured the ROM ending at 956 Hz against a 1190 Hz peak,
// found `audio-reference.md` recording the resolution as 940, and concluded that
// the machine was faithful and the owner was describing 956 Hz being "high in
// absolute terms". This file was then written to hold that shape in place.
//
// Re-analysed off `assets/reference/gameplay-audio.m4a`, the owner was being
// literal. **The unit's resolution is 1868 Hz - an octave above the arpeggio's
// middle note and a fifth above its peak.** The jingle climbs and then leaps
// past its own top note; it does not fall back at all. The sentence said so.
//
// `audio-reference.md`'s 940 was never a reading of that note: `win.partialsObserved`
// records 940 / 1880 / 2820, which are the *arpeggio* mid note's partials, and the
// tail's own partials (1868 / 3735 / 5601, with no 934 present at all) were never
// taken. See that document's "win" section for the correction, the method that
// settles it, and the superseded reading.
//
// ## Why the score is written, which is the only poke in these suites
//
// Reaching 199 by playing takes minutes of emulated time, and the missile and
// cadence work in flight will move that number again. That is a CI liability for
// a test whose subject is the jingle rather than the route to 199.
//
// So the score is set to 198 and the ROM is then played until a kill carries it
// to 199 through `add_score` - `as_win` and `game_win` are entered by the
// program's own path, the win test is the ROM's, and every note comes from the
// ROM's own note loop. **The score write is the only poke.** If the route to 199
// is worth policing, that belongs with the score tests, not here.
//
// ## Why the assertion is relative, not three absolute bands
//
// Three bands in a set are satisfied by any ordering, so they cannot express the
// defect that was reported: a jingle whose notes are each in band still passes if
// it ends on the wrong one of them. What a player hears is the *shape* - the
// arpeggio climbs and the last note leaps above it - so the assertion that
// falsifies the report is that **the final note is higher than the highest note
// the arpeggio reached**. The absolute bands are kept underneath it, because a
// jingle that leapt to the wrong pitch would satisfy the shape and still be wrong.
//
// The direction of that comparison was wrong when this file was written, and the
// inversion is not a patch to a bound. The previous wording reasoned from "the
// arpeggio climbs, and the last note falls back", which was never measured - it
// was inferred from a resolution figure that was itself an unmeasured note name.
// The premise and the evidence error are the same assumption, so both move here.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine, assembleGame, type SpeakerEdge } from './tms1370-probe.js';

const GAME_ASM = assembleGame();

function gameSymbol(name: string): number {
  const found = GAME_ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
}

const NIBBLES_PER_FILE = 16;
const FILE_TIME = gameSymbol('FILE_TIME');
const FILE_STATE = gameSymbol('FILE_STATE');
const NIB_SC_U = gameSymbol('NIB_SC_U');
const NIB_SC_T = gameSymbol('NIB_SC_T');
const NIB_SC_H = gameSymbol('NIB_SC_H');
const NIB_STATE = gameSymbol('NIB_STATE');
const ST_WIN = gameSymbol('ST_WIN');

/** One point short of the win, so a single jet kill reaches it through `add_score`. */
const SCORE_BEFORE_WIN = 198;

/** How far a run of like periods may drift and still be one note. */
const RUN_TOLERANCE = 0.06;

/** Periods a run needs before it is a note rather than a transition artefact. */
const MIN_RUN_PERIODS = 3;

/** Two runs within this of each other are the same sustained note, refragmented. */
const SAME_PITCH_TOLERANCE = 0.04;

/**
 * audio-reference.md `win.fundamentalsHz`, as re-measured off the recording.
 *
 * 750 / 937 / 1248, each the spacing of its own partial series and each steady
 * across the three arpeggio passes to a standard deviation of 0.1 Hz. The middle
 * figure was 940 and the top 1240; the changes are 0.3% and 0.6%, well inside
 * every band here, and they are carried because the top one moves the
 * quantisation arithmetic in {@link ARPEGGIO_TOLERANCE}.
 */
const WIN_FUNDAMENTALS = [750, 937, 1248] as const;

/**
 * The tolerance the arpeggio is held to, and why it is not the +/-3% that
 * `tools/probe/speaker-bands.test.ts` uses for a sound the ROM can place exactly.
 *
 * `note` builds a half-period from a nested loop, outer count `NIB_HALF_O` and
 * inner count `NIB_HALF_I`. With the outer count zero - which all three win notes
 * use - the full period is `4 * I + 25` instructions, which reproduces every
 * figure the ROM states beside these constants: I = 13 gives 77 (758 Hz), I = 9
 * gives 61 (956 Hz), I = 6 gives 49 (1190 Hz).
 *
 * So the pitches are quantised, and near the top of the arpeggio the steps are
 * coarse. The two the ROM can reach either side of the re-measured 1248 Hz are
 * I = 6 at 1190 (4.6% low) and I = 5 at 1296 (3.9% high), and the gap between
 * neighbouring pitches there is 8.5% - wider than a +/-3% band. The other two
 * notes are comfortably inside 3% (758 against 750 is 1.0%, 956 against 937 is
 * 2.1%); it is only the top note that the encoding cannot place.
 *
 * **The ROM stays at I = 6, and on the refined measurement that is no longer the
 * closer of the two.** At 1240 it was - 1190 was 4.0% low against 1296's 4.5%
 * high - and the earlier wording here said so. At 1248 the ordering flips. It is
 * kept at 1190 deliberately, for the interval rather than the pitch: the leap
 * from the top of the arpeggio to the resolution measures +699 cents on the
 * recording, I = 6 gives +684, and I = 5 would give +537. Fifteen cents is
 * inaudible and 162 is over a semitone and a half, and a wrong interval in the
 * final leap is the class of error the owner heard. The 0.7% of measurement that
 * separates the two candidates on absolute pitch does not.
 *
 * `tools/probe/speaker-bands.test.ts` declared 1203-1277 for that note - a bound
 * this ROM cannot satisfy from either side, and one no scenario there reached,
 * so nothing had ever failed on it. That row is widened to +/-5% in the same
 * change as this file, and `audio-reference.md` records the quantisation the
 * bound now follows.
 *
 * Widening the tolerance rather than restating the ROM's own 1190 keeps the
 * assertion pointed at the measurement: a note that vanished would still fail.
 *
 * **What it does not do is separate the two reachable neighbours**, and the
 * earlier wording here claimed it did - "a note that drifted to 1296 would still
 * fail". That was untrue when written, not merely untrue after the re-measurement:
 * against 1240, 1296 is 4.5% out and the band was already +/-5%. Both neighbours
 * are inside it against 1248 too, and no symmetric band can exclude 1296 while
 * admitting 1190, because 1296 is the nearer of the two. What holds the top note
 * where it is, is {@link RESOLUTION_INTERVAL_CENTS} below.
 */
const ARPEGGIO_TOLERANCE = 0.05;

/**
 * The resolution's measured pitch - `win.resolutionHz`.
 *
 * 1868 Hz, from the sustained tail of `gameplay-audio.m4a`. Six methods agree
 * within 3% (adjacent-partial spacing, autocorrelation, cepstrum, harmonic
 * product spectrum, a zero-crossing period fit and a harmonic-series refinement);
 * the tail's partials are 1868 / 3735 / 5601 / 7472 and it has no energy at 934
 * beyond the noise floor, where the arpeggio's genuine 937 Hz note carries its
 * own fundamental 31 dB above background in the same recording.
 *
 * Was 940 - the arpeggio's middle note, written down for this one as a note name
 * rather than measured. See audio-reference.md, "win".
 */
const RESOLUTION_HZ = 1868;

/**
 * The resolution's tolerance, and why it is wider than {@link ARPEGGIO_TOLERANCE}.
 *
 * Same quantisation, one step coarser again. With the outer count zero the
 * reachable pitches around 1868 are I = 2 at 1768 (5.4% low) and I = 1 at 2012
 * (7.7% high), a 13.8% step. **1768 is the closest this machine can play**, so
 * the band has to clear 5.4% for the ROM to sit inside its own measurement.
 */
const RESOLUTION_TOLERANCE = 0.06;

/**
 * The leap from the top of the arpeggio to the resolution, in cents.
 *
 * Measured +699 - a perfect fifth - and this is the assertion that pins the top
 * note, because the absolute band cannot. Moving the arpeggio's top note to
 * I = 5 (1296 Hz) would satisfy every band in this file and take the leap to
 * +537, over a semitone and a half flat. The tolerance is a semitone.
 */
const RESOLUTION_INTERVAL_CENTS = 699;
const INTERVAL_TOLERANCE_CENTS = 100;

/**
 * Emulated seconds the jingle is captured over.
 *
 * The ROM's own transcription is three arpeggios of ~200/150/150 ms and a ~330 ms
 * resolution, so the whole jingle is about 1.8 s. Captured over 3 s so the tail
 * and the silence after it are both inside the window - the silence is asserted
 * on, because "the last note" only means anything if nothing follows it.
 */
const CAPTURE_S = 3;

interface Note {
  hz: number;
  ms: number;
  periods: number;
}

/**
 * The sustained pitches inside an edge stream, in order.
 *
 * Rising edges become periods, periods become runs of like periods, and each run
 * long enough to be a note is reported at its median - `launcher-lives.test.ts`'s
 * method. Adjacent runs at the same pitch are then merged, because a note held
 * for hundreds of periods fragments whenever consecutive periods jitter past the
 * tolerance, and the resolution is exactly such a note.
 */
function notesIn(edges: readonly SpeakerEdge[]): Note[] {
  const rising = edges.filter((edge) => edge.level === 1).map((edge) => edge.cycle);
  const periods = rising.slice(1).map((cycle, index) => cycle - (rising[index] as number));
  const runs: Note[] = [];
  let current: number[] = [];
  let startCycle = rising[0] ?? 0;
  const close = (endCycle: number): void => {
    if (current.length >= MIN_RUN_PERIODS) {
      const sorted = [...current].sort((left, right) => left - right);
      runs.push({
        hz: CYCLE_HZ / (sorted[Math.floor(sorted.length / 2)] as number),
        ms: (1000 * (endCycle - startCycle)) / CYCLE_HZ,
        periods: current.length,
      });
    }
    current = [];
  };
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index] as number;
    const previous = current[current.length - 1];
    if (previous !== undefined && Math.abs(period - previous) / previous >= RUN_TOLERANCE) {
      close(rising[index] as number);
      startCycle = rising[index] as number;
    }
    current.push(period);
  }
  close(rising[rising.length - 1] ?? 0);

  const merged: Note[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last !== undefined && Math.abs(last.hz - run.hz) / last.hz < SAME_PITCH_TOLERANCE) {
      last.ms += run.ms;
      last.periods += run.periods;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Play to the win and return the jingle, as notes. */
function winJingle(): { notes: Note[]; silentAfter: boolean } {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 1, lane: 1, fire: false });

  // Let the ROM finish its own RAM clear and settle into play before anything
  // is written, or the clear loop would wipe the score straight back out.
  machine.step(2 * CYCLE_HZ);

  machine.pokeRam(FILE_TIME, NIB_SC_H, Math.floor(SCORE_BEFORE_WIN / 100));
  machine.pokeRam(FILE_TIME, NIB_SC_T, Math.floor(SCORE_BEFORE_WIN / 10) % 10);
  machine.pokeRam(FILE_TIME, NIB_SC_U, SCORE_BEFORE_WIN % 10);

  const state = (): number => machine.ram[FILE_STATE * NIBBLES_PER_FILE + NIB_STATE] as number;
  const start = machine.cycles;
  let lane = 0;
  let fire = false;
  let toggledAt = machine.cycles;
  while (state() !== ST_WIN && machine.cycles - start < 120 * CYCLE_HZ) {
    machine.step(200);
    if (machine.cycles - toggledAt > 12_000) {
      toggledAt = machine.cycles;
      lane = (lane + 1) % 3;
      fire = !fire;
      machine.setContacts({ lane, fire });
    }
  }
  if (state() !== ST_WIN) {
    throw new Error('the drive never reached the win, so there is no jingle to assert on');
  }

  machine.takeSpeakerEdges();
  const jingleStart = machine.cycles;
  machine.step(CAPTURE_S * CYCLE_HZ);
  const edges = machine.takeSpeakerEdges();

  // Silence after the jingle: the last edge must fall well inside the window, or
  // "the final note" is only the final note of the capture.
  const lastEdge = edges[edges.length - 1];
  const silentAfter =
    lastEdge !== undefined &&
    machine.cycles - lastEdge.cycle > 0.5 * CYCLE_HZ &&
    jingleStart < lastEdge.cycle;

  return { notes: notesIn(edges), silentAfter };
}

const jingle = winJingle();

describe('the win jingle', () => {
  it('is heard at all, so everything below is about something', () => {
    // The guard `speaker-bands.test.ts` could not have: its rows were unreachable
    // and it said so. See `requireNonVacuous` in tools/probe/tms1370-rom.test.ts
    // for why a count comes before a quantifier in these suites.
    expect(jingle.notes.length, 'notes in the win jingle').toBeGreaterThan(0);
  });

  it('falls silent afterwards, so its last note is the last thing heard', () => {
    // `tk_ended` branches straight to `render` in a finished game, so nothing
    // should follow the jingle. Without this the assertions below would be about
    // wherever the capture window happened to stop.
    //
    // This is not unconditionally true of the ROM as it stands, and the exposure
    // is worth naming rather than discovering later. The battleship buzz is
    // ticked from `strobe` on every O strobe, and once `tick` takes its
    // `tk_ended` arm it never reaches `tick_bship` again to run the crossing
    // down - so an ending that lands *during* a crossing buzzes for as long as
    // the machine is left on. Measured over the nine parked-lever combinations
    // of skill and lane, two of them end mid crossing and produce ~630 edges in
    // the four seconds afterwards where the other seven produce none.
    //
    // This drive is not one of those: it wins early, with no boat on the glass.
    // That is luck rather than design, and the assertion is kept pointing at the
    // right thing anyway - silence after an ending is what the machine should do,
    // and the capture-rule work clears `NIB_BUZZ` and `NIB_BPHASE` at the top of
    // `game_win` to make it true in every case. If this ever fails because the
    // win drifted into a crossing, the buzz is the bug, not this expectation.
    expect(jingle.silentAfter, 'the speaker went quiet after the jingle').toBe(true);
  });

  it('ends above every note the arpeggio reached', () => {
    // The assertion the owner's report is about, stated relatively because three
    // absolute bands in a set are satisfied by any ordering. This is what a player
    // actually hears - the arpeggio climbs, and the last note leaps past its top.
    //
    // This comparison ran the other way when the file was written, on a resolution
    // figure that had never been measured. See the header.
    const arpeggio = jingle.notes.slice(0, -1);
    const peak = Math.max(...arpeggio.map((note) => note.hz));
    const last = jingle.notes[jingle.notes.length - 1] as Note;
    expect(
      last.hz,
      `the arpeggio peaks at ${peak.toFixed(0)} Hz and the jingle must leap above it, not fall back`,
    ).toBeGreaterThan(peak);
  });

  it('resolves onto the measured resolution pitch, and holds it', () => {
    // The absolute half, under the shape: leaping to the *wrong* pitch would
    // satisfy the test above. It is a sustain rather than a fourth arpeggio note,
    // so it must also outlast the notes that came before it.
    const last = jingle.notes[jingle.notes.length - 1] as Note;
    expect(Math.abs(last.hz - RESOLUTION_HZ) / RESOLUTION_HZ).toBeLessThan(RESOLUTION_TOLERANCE);
    const longestBefore = Math.max(...jingle.notes.slice(0, -1).map((note) => note.ms));
    expect(last.ms, 'the resolution is sustained, not another arpeggio note').toBeGreaterThan(
      longestBefore,
    );
  });

  it('leaps a fifth from the top of the arpeggio, which the bands cannot check', () => {
    // What holds the arpeggio's top note at I = 6. Both of the pitches this note
    // generator can reach around the measured 1248 Hz sit inside ARPEGGIO_TOLERANCE,
    // so the band admits either; the interval to the resolution does not.
    const arpeggio = jingle.notes.slice(0, -1);
    const peak = Math.max(...arpeggio.map((note) => note.hz));
    const last = jingle.notes[jingle.notes.length - 1] as Note;
    const cents = 1200 * Math.log2(last.hz / peak);
    expect(
      Math.abs(cents - RESOLUTION_INTERVAL_CENTS),
      `the leap is ${cents.toFixed(0)} cents, measured ${RESOLUTION_INTERVAL_CENTS}`,
    ).toBeLessThan(INTERVAL_TOLERANCE_CENTS);
  });

  it('climbs through the three measured fundamentals before it resolves', () => {
    // win.arpeggio. Each of the three has to be there, and the resolution is not
    // one of them.
    for (const fundamental of WIN_FUNDAMENTALS) {
      expect(
        jingle.notes.some(
          (note) => Math.abs(note.hz - fundamental) / fundamental < ARPEGGIO_TOLERANCE,
        ),
        `no note within ${ARPEGGIO_TOLERANCE * 100}% of ${fundamental} Hz`,
      ).toBe(true);
    }

    // **The resolution is a pitch the arpeggio never played.** This clause used to
    // assert the opposite - that the highest note is not the last one, on the
    // reasoning that the resolution "is the note the jingle already passed through
    // on the way up". That is exactly the defect: playing the middle note a fourth
    // time is what the ROM did and what the owner reported. A resolution that is
    // one of its own arpeggio notes is the failure, not the contract.
    const last = jingle.notes[jingle.notes.length - 1] as Note;
    for (const fundamental of WIN_FUNDAMENTALS) {
      expect(
        Math.abs(last.hz - fundamental) / fundamental,
        `the resolution is ${last.hz.toFixed(0)} Hz, which is the arpeggio's ${fundamental} Hz again`,
      ).toBeGreaterThan(ARPEGGIO_TOLERANCE);
    }
  });
});
