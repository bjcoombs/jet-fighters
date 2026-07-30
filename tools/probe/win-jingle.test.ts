// The win jingle, and the one thing about it a player would notice.
//
// Paths in this file are relative to the repository root.
//
// ## The gap this closes
//
// `tools/probe/speaker-bands.test.ts` carries the jingle's three fundamentals
// and says, in its own comment on those rows:
//
//     win.fundamentalsHz, +/- 3%. The jingle needs 199 points and is not reached
//     by the scenarios below; the rows are here so the table is the whole
//     contract.
//
// So the one sound with a documented resolution had no assertion behind it, in
// the suite that exists to police sounds. The owner reported the jingle "ends on
// a high note not a low note" and there was nothing in the tree that could have
// caught it either way. Measured, the ROM is correct - three arpeggios of
// 758 / 956 / 1190 Hz and then a sustained 956 - but "measured once by hand" is
// what this file replaces.
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
// defect that was reported: a jingle ending on its own peak passes all three.
// What a player hears is the *shape* - the arpeggio climbs and the last note
// falls back - so the assertion that falsifies the report is that **the final
// note is lower than the highest note the jingle reached**. The absolute bands
// are kept underneath it, because a jingle that fell back to the wrong pitch
// would satisfy the shape and still be wrong.
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

/** audio-reference.md `win.fundamentalsHz`, the tolerance speaker-bands.test.ts uses. */
const BAND_TOLERANCE = 0.03;
const WIN_FUNDAMENTALS = [750, 940, 1240] as const;

/**
 * The tolerance the arpeggio is held to, and why it is not {@link BAND_TOLERANCE}.
 *
 * `note` builds a half-period from a nested loop, outer count `NIB_HALF_O` and
 * inner count `NIB_HALF_I`. With the outer count zero - which all three win notes
 * use - the full period is `4 * I + 25` instructions, which reproduces every
 * figure the ROM states beside these constants: I = 13 gives 77 (758 Hz), I = 9
 * gives 61 (956 Hz), I = 6 gives 49 (1190 Hz).
 *
 * So the pitches are quantised, and near the top of the arpeggio the steps are
 * coarse. The two the ROM can reach either side of the measured 1240 Hz are
 * I = 6 at 1190 (4.0% low) and I = 5 at 1296 (4.5% high). **1190 is the closest
 * this machine can play**, and the gap between neighbouring pitches there is
 * 8.5% - wider than a +/-3% band. The other two notes are comfortably inside 3%
 * (758 against 750 is 1.1%, 956 against 940 is 1.7%); it is only the top note
 * that the encoding cannot place.
 *
 * `tools/probe/speaker-bands.test.ts` declares 1203-1277 for that note, which
 * this ROM cannot satisfy and no scenario there reaches, so nothing has ever
 * failed on it. Widening the tolerance here rather than restating the ROM's own
 * 1190 keeps the assertion pointed at the measurement: a note that drifted to
 * 1296 would still fail, and so would one that vanished.
 */
const ARPEGGIO_TOLERANCE = 0.05;

/** The resolution's measured pitch - `win.resolutionHz`, the long A#5. */
const RESOLUTION_HZ = 940;

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
    expect(jingle.silentAfter, 'the speaker went quiet after the jingle').toBe(true);
  });

  it('ends below its own highest note', () => {
    // The assertion the owner's report is about, and the reason it is stated
    // relatively: three absolute bands in a set are satisfied by any ordering,
    // so a jingle ending on its 1240 Hz peak would pass them all. This is what a
    // player actually hears - the arpeggio climbs, and the last note falls back.
    const peak = Math.max(...jingle.notes.map((note) => note.hz));
    const last = jingle.notes[jingle.notes.length - 1] as Note;
    expect(
      last.hz,
      `the jingle peaks at ${peak.toFixed(0)} Hz and must resolve below it, not end on it`,
    ).toBeLessThan(peak);
  });

  it('resolves onto the measured resolution pitch, and holds it', () => {
    // The absolute half, under the shape: falling back to the *wrong* pitch would
    // satisfy the test above. win.resolutionHz is the long A#5, and it is a
    // sustain rather than a fourth arpeggio note - so it must also outlast the
    // notes that came before it.
    const last = jingle.notes[jingle.notes.length - 1] as Note;
    expect(Math.abs(last.hz - RESOLUTION_HZ) / RESOLUTION_HZ).toBeLessThan(BAND_TOLERANCE);
    const longestBefore = Math.max(...jingle.notes.slice(0, -1).map((note) => note.ms));
    expect(last.ms, 'the resolution is sustained, not another arpeggio note').toBeGreaterThan(
      longestBefore,
    );
  });

  it('climbs through the three measured fundamentals before it resolves', () => {
    // win.arpeggio, and the reason the resolution reads as a resolution: it is
    // the note the jingle already passed through on the way up.
    for (const fundamental of WIN_FUNDAMENTALS) {
      expect(
        jingle.notes.some(
          (note) => Math.abs(note.hz - fundamental) / fundamental < ARPEGGIO_TOLERANCE,
        ),
        `no note within ${ARPEGGIO_TOLERANCE * 100}% of ${fundamental} Hz`,
      ).toBe(true);
    }
    const peak = Math.max(...jingle.notes.map((note) => note.hz));
    const peakAt = jingle.notes.findIndex((note) => note.hz === peak);
    expect(peakAt, 'the highest note is not the last one').toBeLessThan(jingle.notes.length - 1);
  });
});
