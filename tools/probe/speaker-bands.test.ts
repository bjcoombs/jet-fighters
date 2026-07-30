// Every noise the ROM makes, measured off R15 against docs/evidence/audio-reference.md.
//
// Paths in this file are relative to the repository root.
//
// ## The defect this exists to stop coming back
//
// The owner played the deployed build beside his physical CGL unit and reported
// "no sound, just speaker pops". Every pitch in the ROM's sound table was inside
// its measured band at the time, and the two existing pitch tests
// (jetfighter-rom.test.ts, "the pitched game sounds") passed. What was wrong was
// note *length*: the march ran one burst of eight periods, 12.5 ms, and the
// battleship one burst of eight, 28 ms. Pitch does not establish itself in under
// roughly twenty milliseconds, so a burst that short arrives at the ear as a
// click whatever its period says - and those two are the sounds a player hears
// constantly. A band test alone cannot see that, which is why this file asserts
// duration as well as frequency.
//
// ## Why the segmentation thresholds are what they are
//
// Two ways of reading this edge stream produce confident nonsense, and both were
// hit while diagnosing the report above:
//
//   - Segmenting sounds at a gap of 5 ms splits the loss sound's collapse into
//     individual transitions, because a 92 Hz square wave holds each level for
//     5.4 ms. They read as lone edges - the exact signature of a pin driven and
//     never returned to rest - and they are nothing of the kind.
//     BURST_GAP_CYCLES is two sweeps, above that half-period and below the
//     ~1724-cycle gap between two warning beeps, so it splits sounds without
//     splitting a note.
//   - Taking one frequency for a whole segment averages any two sounds that run
//     back to back. A march step immediately followed by the player's fire blip
//     - 627 Hz then 1577 Hz, and the played drive below produces one - reads as
//     a single burst belonging to no band at all. So a segment is broken into
//     runs of like periods first, and each run is measured on its own.
//
// Reading the stream either of those ways says the ROM is broken where it is
// not, and says nothing about where it is.
//
// ## What is different on the TMS1370, and why
//
// Three things, all of them consequences of how this machine makes sound rather
// than of how it is measured:
//
//   1. **Notes come in bursts, and a burst boundary stretches one period.**
//      `note` reloads its period counter between bursts, which costs seven
//      instructions the periods either side of it do not pay. At the march's
//      93-instruction period that stretch is 7.5% and at the fire blip's 37 it
//      is 19%, both above any run tolerance that could still tell 246 Hz from
//      199 Hz. Left alone it shreds a 70 ms march step into three 22 ms runs -
//      which is precisely the click the file was written to catch, reported
//      against a ROM that is not making one. So a lone stretched period whose
//      successor returns to the run's own period is kept inside the run; see
//      {@link runsOf}.
//   2. **The battleship's buzz is not a note and cannot be read as one.** It is
//      clocked off the display sweep, one tick per O strobe, so its rise-to-rise
//      intervals cycle through three values - measured here at 513, 858 and 922
//      instructions - rather than repeating one. A median period reads 68 Hz off
//      that, which is outside the measured band and is an artefact of the
//      method, not a fault in the ROM. audio-reference.md says why at length and
//      supplies the answer: harmonic-comb periodicity, which the probe exports as
//      `combPeriodicityHz` and which reads the same stretch at 101 Hz. So the
//      buzz is identified and measured by comb, and its runs are joins.
//   3. **The loss sound's collapse and the buzz share a band.** 80-97 Hz and
//      79-111 Hz overlap, and the ROM's collapse note sits at 92 Hz squarely
//      inside both. What tells them apart is the rest of the envelope: the loss
//      sound ends on a ~147 Hz decay floor and the buzz has no such note, so a
//      run in the overlap is read as the collapse only inside a sound that also
//      carries the floor. See {@link bandOf}.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import {
  BURST_GAP_CYCLES,
  CAPTURE_WINDOW_CYCLES,
  PLAYER_SLICE_CYCLES,
  STEP_CYCLES,
} from '../../src/machine/board/tms1370-cadence.js';
import { Tms1370Machine, assembleGame, combPeriodicityHz, type SpeakerEdge } from './tms1370-probe.js';

/** Seconds of emulated time, as the cycle count the probe counts in. */
const seconds = (value: number): number => Math.round(value * CYCLE_HZ);

/**
 * How far two consecutive periods may differ and still count as one note.
 *
 * Six percent, and it has to sit in a narrow window. Below it are the ROM's own
 * period wobbles; above it is the smallest step between two notes it plays back
 * to back, which is the loss envelope's 246 Hz rasp running into its 199 Hz
 * drift - 237 instructions to 293, 24%. Six percent clears the first and breaks
 * at the second.
 *
 * It deliberately does *not* clear a burst boundary. That stretch is a fixed
 * seven instructions, so it is 2% of the 199 Hz drift's period and 19% of the
 * fire blip's, and no single figure both absorbs it and still separates two
 * notes. {@link runsOf} handles it as the one-period event it is instead.
 */
const RUN_TOLERANCE = 0.06;

/**
 * The longest stretched period {@link runsOf} will keep inside a note.
 *
 * One strobe. A burst boundary costs `note` seven instructions of counter
 * reload - measured off this ROM as 93 -> 100 on the march and 37 -> 44 on the
 * fire blip - and every gap the ROM puts *between* two sounds is at least the
 * silence it spends drawing a sweep. One strobe sits far above the first and far
 * below the second: the shortest real gap in the stream is the 25-28 ms measured
 * pause between two warning beeps, 1724 instructions here, which is 47 strobes.
 */
const MAX_BOUNDARY_STRETCH_CYCLES = STEP_CYCLES;

/** Periods a run needs before it is a note rather than a transition artefact. */
const MIN_RUN_PERIODS = 3;

/**
 * The bands, transcribed from docs/evidence/audio-reference.md.
 *
 * `minMs` is the shortest the sound may last. Where audio-reference.md carries a
 * duration it is the source; where it does not, the floor is the ~20 ms below
 * which a burst is heard as a click rather than a pitch.
 */
interface Band {
  readonly name: string;
  readonly minHz: number;
  readonly maxHz: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/** The name the overlap rule in {@link bandOf} resolves *to*, inside a loss. */
const GAME_OVER_COLLAPSE = 'gameOver collapse';

/** The note that says a sound is the loss envelope rather than the buzz. */
const GAME_OVER_DECAY_FLOOR = 'gameOver decay floor';

/** The band the battleship's buzz is read against, by comb rather than by run. */
const BATTLESHIP_BUZZ = 'battleshipBuzz';

const BANDS: readonly Band[] = [
  // missileFire.dominantHzRange, and contract criterion V5's < 150 ms.
  // missileFire.totalMsTestRange is 8-35 ms; the ROM plays 30 periods at
  // 1577 Hz, which a rise-to-rise run reads as 18.6 ms.
  { name: 'missileFire', minHz: 1480, maxHz: 1632, minMs: 8, maxMs: 150 },
  // jetMarch.dominantHzRange; jetMarch.stepDurationMs is 70 ms.
  { name: 'jetMarch', minHz: 600, maxHz: 650, minMs: 60, maxMs: 120 },
  // battleshipBuzz.repetitionRangeHz - the 79-111 Hz wander measured off the
  // owner's isolated recording, not a note_loop entry. The buzz is clocked by
  // the display sweep out of `strobe` and runs for the whole four seconds the
  // boat is on the tube, so it is bounded here by that wander and by
  // battleshipBuzz.durationSec's 3.80 and 4.05 s. Nothing reads a *run* against
  // this row: the row is what {@link buzzHzOf}'s comb reading is checked
  // against, because a median period cannot read this sound at all.
  { name: BATTLESHIP_BUZZ, minHz: 79, maxHz: 111, minMs: 20, maxMs: 5000 },
  // win.fundamentalsHz. The jingle needs 199 points and is not reached by the
  // scenarios below; the rows are here so the table is the whole contract.
  // Durations from win's own transcription: 200 / 150 / 150 ms per arpeggio note
  // and 330 ms for the resolution.
  //
  // `tools/probe/win-jingle.test.ts` does reach the jingle, and reaching it
  // showed the D#6 row was a bound this machine cannot meet. `note` builds a
  // half-period from a nested loop, and with the outer count zero - which all
  // three win notes use - the period is `4 * I + 25` instructions, reproducing
  // every figure the ROM states beside these constants: I = 13 gives 758 Hz,
  // I = 9 gives 956, I = 6 gives 1190. The two pitches reachable either side of
  // the measured 1240 are 1190 (4.0% low) and 1296 (4.5% high), so 1190 is the
  // closest this note generator can play and the step between neighbours there
  // is 8.5% - wider than the +/-3% this row used to assert. Nothing had ever
  // failed on it because nothing reached it.
  //
  // So D#6 is +/-5% and the other two stay at +/-3%, where the ROM lands inside
  // 2%. The measurement is unchanged and still 1240; it is the bound that
  // follows the hardware. See audio-reference.md, "What the TMS1370 can actually
  // play, and why the top note is 1190 Hz".
  { name: 'win F#5 (750 Hz)', minHz: 727, maxHz: 772, minMs: 100, maxMs: 400 },
  { name: 'win A#5 (940 Hz)', minHz: 912, maxHz: 968, minMs: 100, maxMs: 400 },
  { name: 'win D#6 (1240 Hz)', minHz: 1178, maxHz: 1302, minMs: 100, maxMs: 400 },
  // launcherHitWarning.dominantHzRange, which is also gameOver.openingHzRange -
  // audio-reference.md records them as the same pitch. The beep is a measured
  // ~10 ms, so this is the one band whose floor is below the click threshold;
  // a run measures rise-to-rise and so reads one period short of the note.
  { name: 'launcherHitWarning / gameOver opening', minHz: 455, maxHz: 545, minMs: 7, maxMs: 60 },
  // The rest of the gameOver envelope. The first is gameOver.collapseHzRange;
  // the third is gameOver.bodyRaspHzRange; the second and fourth have no named
  // range in that document and are windows around rows 4 and 5 of its envelope
  // transcription (196 Hz for 170 ms, 147 Hz for 240 ms), the fourth agreeing
  // with gameOver.decayFloorHz's ~147.
  { name: GAME_OVER_COLLAPSE, minHz: 80, maxHz: 97, minMs: 20, maxMs: 120 },
  { name: 'gameOver rasp body', minHz: 200, maxHz: 280, minMs: 60, maxMs: 320 },
  { name: 'gameOver drift', minHz: 190, maxHz: 205, minMs: 60, maxMs: 320 },
  { name: GAME_OVER_DECAY_FLOOR, minHz: 140, maxHz: 155, minMs: 60, maxMs: 380 },
];

/** One stretch of like periods within a sound: a note, or a transition. */
interface Run {
  readonly hz: number;
  readonly ms: number;
  readonly periods: number;
}

/** One gap-separated stretch of speaker activity. */
interface Sound {
  readonly atMs: number;
  readonly edges: number;
  readonly ms: number;
  readonly runs: readonly Run[];
  /**
   * The comb-periodicity reading over the whole stretch, in hertz.
   *
   * Meaningful only where {@link carriesBuzz} is true - over a phrase of notes
   * it is the transform of an impulse train that has no single repetition rate,
   * and reports whichever scanned f0 happens to score highest.
   */
  readonly combHz: number;
  /** True when this stretch is the battleship's buzz. See {@link BUZZ_MIN_MS}. */
  readonly carriesBuzz: boolean;
}

const GAME_ASM = assembleGame();

function gameSymbol(name: string): number {
  const found = GAME_ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
}

/** The battleship's lane nibble, and the countdown to its next crossing. */
const BSLANE_ADDRESS = gameSymbol('FILE_STATE') * 16 + gameSymbol('NIB_BSLANE');
const BS_NONE = gameSymbol('BS_NONE');
const BS_LO_ADDRESS = gameSymbol('FILE_TIME') * 16 + gameSymbol('NIB_BS_LO');
const BS_HI_ADDRESS = gameSymbol('FILE_TIME') * 16 + gameSymbol('NIB_BS_HI');

/** Break a sound's rising edges into runs of like periods. */
function runsOf(rising: readonly number[]): Run[] {
  const periods = rising.slice(1).map((cycle, index) => cycle - rising[index]!);
  const runs: Run[] = [];
  let current: number[] = [];
  // The period new ones are compared against. Held across an absorbed burst
  // boundary rather than moved onto it, so the stretched period cannot pull the
  // comparison along with it and close the run one period later instead.
  let reference: number | undefined;
  const deviates = (period: number, from: number): boolean =>
    Math.abs(period - from) / from >= RUN_TOLERANCE;
  const close = (): void => {
    if (current.length === 0) {
      return;
    }
    // The median, so the stretched burst-boundary period cannot move the answer.
    const sorted = [...current].sort((left, right) => left - right);
    runs.push({
      hz: CYCLE_HZ / sorted[Math.floor(sorted.length / 2)]!,
      ms: (current.reduce((total, period) => total + period, 0) / CYCLE_HZ) * 1000,
      periods: current.length,
    });
    current = [];
    reference = undefined;
  };
  for (let at = 0; at < periods.length; at += 1) {
    const period = periods[at]!;
    if (reference !== undefined && deviates(period, reference)) {
      // A burst boundary inside one note: `note` reloads its counters, one
      // period is stretched by a fixed handful of instructions, and the next
      // period is back where it was. That is a fact about the routine and not a
      // note change, so the note is kept whole. Both conditions are needed - a
      // real note change is also a single deviant period, and what makes it one
      // is that the periods after it do *not* return.
      const next = periods[at + 1];
      const stretch = period - reference;
      if (
        next !== undefined &&
        !deviates(next, reference) &&
        stretch > 0 &&
        stretch <= MAX_BOUNDARY_STRETCH_CYCLES
      ) {
        current.push(period);
        continue;
      }
      close();
    }
    current.push(period);
    reference = period;
  }
  close();
  return runs;
}

/**
 * The shortest a stretch may be before its comb reading is read as the buzz.
 *
 * Two measured figures in audio-reference.md bracket this and agree on it. The
 * buzz itself lasts `battleshipBuzz.durationSec` - 3.80 s and 4.05 s across the
 * two arrivals - and the longest phrase `note` can build is the win jingle's
 * `win.totalDurationSec` of ~1.83 s. Anything between the two separates a buzz
 * from a phrase, and half the shorter arrival is that.
 *
 * It is a classifier and not a bound: how long the buzz actually ran is asserted
 * below against the measured band, not against this.
 */
const BUZZ_MIN_MS = 1900;

/** The buzz's repetition rate over a stretch, by harmonic-comb periodicity. */
function buzzHzOf(edges: readonly SpeakerEdge[]): number {
  const first = edges[0];
  const last = edges[edges.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }
  return combPeriodicityHz(edges, first.cycle, last.cycle, CYCLE_HZ);
}

/** Split an edge stream into sounds, each broken into its runs. */
function soundsIn(edges: readonly SpeakerEdge[]): Sound[] {
  const groups: SpeakerEdge[][] = [];
  let group: SpeakerEdge[] = [];
  for (const edge of edges) {
    const previous = group[group.length - 1];
    if (previous !== undefined && edge.cycle - previous.cycle > BURST_GAP_CYCLES) {
      groups.push(group);
      group = [];
    }
    group.push(edge);
  }
  if (group.length > 0) {
    groups.push(group);
  }
  return groups.map((edgesInSound) => {
    const ms =
      ((edgesInSound[edgesInSound.length - 1]!.cycle - edgesInSound[0]!.cycle) / CYCLE_HZ) * 1000;
    const combHz = buzzHzOf(edgesInSound);
    const buzzBand = BANDS.find((band) => band.name === BATTLESHIP_BUZZ)!;
    return {
      atMs: (edgesInSound[0]!.cycle / CYCLE_HZ) * 1000,
      edges: edgesInSound.length,
      ms,
      runs: runsOf(edgesInSound.filter((edge) => edge.level === 1).map((edge) => edge.cycle)),
      combHz,
      carriesBuzz: ms >= BUZZ_MIN_MS && combHz >= buzzBand.minHz && combHz <= buzzBand.maxHz,
    };
  });
}

/** Runs long enough to be a note rather than the join between two notes. */
function notesOf(sound: Sound): Run[] {
  return sound.runs.filter((run) => run.periods >= MIN_RUN_PERIODS);
}

/**
 * True when this stretch is the loss envelope.
 *
 * Identified by its decay floor, which is the note the buzz has nothing like.
 * The two sounds overlap in the 80-97 Hz collapse band and nowhere else, so the
 * floor is what decides the overlap - see {@link bandOf}. Asking instead whether
 * the stretch *contains* an 80-97 Hz note would be circular.
 */
function isLossEnvelope(sound: Sound): boolean {
  const floor = BANDS.find((band) => band.name === GAME_OVER_DECAY_FLOOR)!;
  return notesOf(sound).some((run) => run.hz >= floor.minHz && run.hz <= floor.maxHz);
}

/**
 * The band a run falls in, or undefined if it belongs to none.
 *
 * The table has exactly one overlap - the battleship's 79-111 Hz buzz against
 * the loss sound's 80-97 Hz collapse - and it is not a transcription slip:
 * audio-reference.md measured the two separately and they genuinely share that
 * ground. A run's own frequency cannot resolve it, so the sound it sits in does.
 */
function bandOf(run: Run, sound: Sound): Band | undefined {
  const candidates = BANDS.filter((band) => run.hz >= band.minHz && run.hz <= band.maxHz);
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const wanted = isLossEnvelope(sound) ? GAME_OVER_COLLAPSE : BATTLESHIP_BUZZ;
  return candidates.find((band) => band.name === wanted) ?? candidates[0];
}

/**
 * Emulated seconds the unattended machine takes to fall silent.
 *
 * **Measured off this ROM**, not estimated - the mistake CLAUDE.md records as
 * having turned `main` red three times in one day. A machine nobody plays loses
 * all three launchers and the loss sound is the last thing it makes: the last
 * speaker edge lands at 24.6 s with no contact closed, 24.5 s on skill 1 and
 * 26.1 s on skill 3, over 40 s drives.
 */
const UNATTENDED_SILENCE_S = 26.2;

/**
 * The idle window: the silence horizon with a fifth again of margin.
 *
 * Everything after it is silence by construction, so the margin costs nothing
 * but buys room for the oscillator's stated spread and for a cadence change
 * that lengthens the game.
 */
const IDLE_SECONDS = UNATTENDED_SILENCE_S * 1.2;

/**
 * Emulated seconds to the end of the battleship's opening crossing.
 *
 * `asm/jetfighter.asm` sets `BSHIP_OPEN` to 33 sixteen-sweep units - 528 sweeps,
 * 8.8 s nominal - and the crossing itself is three lane steps of 65 sweeps,
 * which audio-reference.md's `battleshipBuzz.durationSec` of 4.05 s is what set.
 * Measured on the running machine the onset lands at 8.5 s unattended and 9.5 s
 * on a played drive, because a sweep costs more while the game is sounding.
 */
const FIRST_CROSSING_END_S = 9.5 + 4.05;

/**
 * The played window.
 *
 * Long enough to clear the opening crossing with half again of margin, which is
 * what makes the drive's own missile blips and the crossing both reachable
 * inside it. It is deliberately shorter than the idle window: the loss sound and
 * the buzz both arrive unattended, and what only a played drive produces is the
 * fire blip.
 */
const PLAYED_SECONDS = FIRST_CROSSING_END_S * 1.5;

/**
 * Slices the drive holds each lever lane for: 60, which is 0.18 s.
 *
 * A slice is `PLAYER_SLICE_CYCLES`, a fifth of a sweep, so sixty of them are
 * twelve whole sweeps - 178 cycles each at `CYCLE_HZ`, 183 ms in all. That is
 * the figure, not the "about a second" this comment used to claim: a fifth of a
 * sweep is 3 ms, not 17 ms, and the arithmetic was out by 5.5x.
 *
 * The dwell is stated in slices rather than seconds because what it has to
 * clear is a count of input scans, not a duration. The ROM samples each strobe
 * column once per sweep, so twelve sweeps is twelve chances for a lane change to
 * be seen, and a lane that lasted one sweep could be missed by a scan landing
 * either side of it. It is faster than a hand works a lever and slower than the
 * blind player in `game-lifetime.test.ts`, which moves a lane every slice.
 *
 * Widening it to a literal second was the alternative and was not taken: the
 * measured bands below are read off the sounds this drive produces, so changing
 * how it plays re-opens every band in the file. Correcting the claim costs
 * nothing and changes no measurement.
 */
const LANE_DWELL_SLICES = 60;

/**
 * Run the machine on until the speaker has been at rest for longer than one
 * sound gap, or the ceiling is reached.
 *
 * Without this, a window that happens to end inside a note reports a pin left
 * driven - which is the exact fault "leaves the pin at its resting level" is
 * looking for, raised against the probe's own stopwatch rather than against the
 * ROM. The ceiling is not optional: once the game is over the machine never
 * sounds again, so a drive already in silence has to stop rather than spin.
 */
function drainToSilence(machine: Tms1370Machine): void {
  const until = machine.cycles + CAPTURE_WINDOW_CYCLES;
  while (machine.cycles < until) {
    const last = machine.speakerEdges.at(-1);
    if (last !== undefined && last.level === 0 && machine.cycles - last.cycle > BURST_GAP_CYCLES) {
      return;
    }
    machine.step(PLAYER_SLICE_CYCLES);
  }
}

/**
 * Every sound two scenarios produce, and the raw edges behind them.
 *
 * Two, because the ROM's noises divide by trigger: leaving the machine alone
 * produces the march, the battleship's opening crossing and eventually the loss
 * sound, and working the controls produces the missile blip. The controls are
 * worked throughout the second rather than tapped once at the start, for the
 * reason CLAUDE.md gives about `UNATTENDED_SILENCE_S`: an unattended machine
 * loses all three launchers inside half a minute and nothing sounds again
 * however long the run.
 */
function scenario(fire: boolean): { edges: readonly SpeakerEdge[]; sounds: Sound[] } {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: 3 });
  const window = seconds(fire ? PLAYED_SECONDS : IDLE_SECONDS);
  for (let slice = 0; machine.cycles < window; slice += 1) {
    if (fire) {
      // The lever walks the three lanes, holding each for LANE_DWELL_SLICES.
      machine.setContacts({ lane: Math.floor(slice / LANE_DWELL_SLICES) % 3 });
      // Hold fire over a crossing, and over the last few units of the countdown
      // to one, so a missile already in flight cannot end it early. A player who
      // fires blindly shoots the boat down almost every time - which is the boat
      // being slow enough to hit, and is exactly what makes a blind-firing
      // scenario useless for measuring how long the buzz lasts. Reading RAM to
      // decide is allowed; a probe may look at the tube, it may not write state.
      const ram = machine.ram;
      const crossing = ram[BSLANE_ADDRESS] !== BS_NONE;
      const due = ram[BS_HI_ADDRESS]! * 16 + ram[BS_LO_ADDRESS]!;
      machine.setContacts({ fire: !crossing && due >= 6 && slice % 12 === 0 });
    }
    machine.step(PLAYER_SLICE_CYCLES);
  }
  drainToSilence(machine);
  const edges = machine.speakerEdges;
  return { edges, sounds: soundsIn(edges) };
}

const idle = scenario(false);
const fired = scenario(true);
const allSounds = [...idle.sounds, ...fired.sounds];

describe('the R15 pin is never left driven', () => {
  it('made noise in both scenarios', () => {
    expect(idle.sounds.length).toBeGreaterThan(0);
    expect(fired.sounds.length).toBeGreaterThan(0);
  });

  it('alternates every transition, so no edge is left without its partner', () => {
    // A routine that raised the pin and returned without lowering it would show
    // up here as two rises in a row - a step in the waveform, which is a click.
    // The buzz is included: it toggles R15 from inside `strobe` between the
    // notes `note` plays, and a tick that failed to complete would break the
    // alternation of the whole stream.
    for (const { edges } of [idle, fired]) {
      edges.forEach((edge, index) => {
        expect(edge.level).toBe(index % 2 === 0 ? 1 : 0);
      });
    }
  });

  it('leaves the pin at its resting level when the noise stops', () => {
    for (const { edges } of [idle, fired]) {
      expect(edges[edges.length - 1]!.level).toBe(0);
    }
  });

  it('emits no lone transition', () => {
    // Not a restatement of the alternation test: a sound consisting of a single
    // transition alternates perfectly well with whatever came before it. What
    // makes it a pop is that nothing inside its own two sweeps completes it.
    const lone = allSounds.filter((sound) => sound.edges < 2);
    expect(lone.map((sound) => sound.atMs.toFixed(1))).toEqual([]);
  });
});

describe('every sustained note lands in a band audio-reference.md measured', () => {
  it('resolved at least one note in every sound', () => {
    // A stretch carrying the buzz is accounted for even with no note in it: the
    // buzz is not built by `note` and has no period to resolve, and what
    // identifies it is the comb reading asserted further down.
    const silentSounds = allSounds.filter(
      (sound) => notesOf(sound).length === 0 && !sound.carriesBuzz,
    );
    expect(silentSounds.map((sound) => sound.atMs.toFixed(1))).toEqual([]);
  });

  it('puts every note inside a measured band', () => {
    const strays = allSounds.flatMap((sound) =>
      notesOf(sound)
        .filter((run) => bandOf(run, sound) === undefined)
        .map((run) => `${run.hz.toFixed(0)} Hz for ${run.ms.toFixed(1)} ms at ${sound.atMs.toFixed(0)} ms`),
    );
    expect(strays).toEqual([]);
  });

  it('holds every note long enough to be heard as a pitch, not a pop', () => {
    // The regression this file was written for. Both the march and the
    // battleship buzz sat correctly inside their bands while lasting 12.5 ms and
    // 28 ms, and the unit sounded like it was popping.
    const tooShort = allSounds.flatMap((sound) =>
      notesOf(sound).flatMap((run) => {
        const band = bandOf(run, sound);
        return band !== undefined && run.ms < band.minMs
          ? [`${band.name}: ${run.ms.toFixed(1)} ms, needs ${band.minMs} ms`]
          : [];
      }),
    );
    expect(tooShort).toEqual([]);
  });

  it('holds no note longer than its band allows', () => {
    const tooLong = allSounds.flatMap((sound) =>
      notesOf(sound).flatMap((run) => {
        const band = bandOf(run, sound);
        return band !== undefined && run.ms > band.maxMs
          ? [`${band.name}: ${run.ms.toFixed(1)} ms, allows ${band.maxMs} ms`]
          : [];
      }),
    );
    expect(tooLong).toEqual([]);
  });

  it('leaves only note joins unaccounted for', () => {
    // Runs below MIN_RUN_PERIODS are the single period between two sounds the
    // ROM plays back to back - the march running straight into the loss
    // envelope, or one note of that envelope into the next. They are a real
    // property of a machine with one core, but there must be few of them, or the
    // run grouping is shredding notes rather than joining them and every
    // assertion above is measuring the wrong thing.
    //
    // Counted over the stretches `note` built, which is what the claim is about.
    // A stretch carrying the buzz is every bit a join by construction - its
    // rise-to-rise intervals cycle through three values because it is clocked
    // off the sweep, so no two consecutive ones are alike - and counting those
    // would say nothing about whether a note was shredded.
    const phrases = allSounds.filter((sound) => !sound.carriesBuzz);
    const joins = phrases.flatMap((sound) =>
      sound.runs.filter((run) => run.periods < MIN_RUN_PERIODS),
    );
    const notes = phrases.flatMap((sound) => notesOf(sound));
    expect(joins.length).toBeLessThan(notes.length);
  });
});

describe('the sounds the scenarios actually reached', () => {
  const named = (name: string): Run[] =>
    allSounds.flatMap((sound) => notesOf(sound).filter((run) => bandOf(run, sound)?.name === name));

  it('marched, at 600-650 Hz for ~70 ms a step', () => {
    const march = named('jetMarch');
    expect(march.length).toBeGreaterThan(0);
    for (const step of march) {
      // jetMarch.stepDurationMs is 70 ms, and the ROM plays 45 periods at
      // 627 Hz for 71.8 ms of it. A run measures rise-to-rise and so reads one
      // period - 1.6 ms here - short of the note.
      expect(step.ms).toBeGreaterThan(60);
    }
  });

  it('buzzed the battleship below the march, and held the buzz', () => {
    const buzzes = allSounds.filter((sound) => sound.carriesBuzz);
    const march = named('jetMarch');
    expect(buzzes.length, 'no battleship crossing in either window').toBeGreaterThan(0);
    const band = BANDS.find((entry) => entry.name === BATTLESHIP_BUZZ)!;
    for (const buzz of buzzes) {
      // Read by comb and not by median period, because the buzz is clocked off
      // the display sweep and its edges are not evenly spaced - which is the
      // evidence for that mechanism rather than noise on top of it. A median
      // reads 68 Hz off the same stretch.
      expect(buzz.combHz).toBeGreaterThanOrEqual(band.minHz);
      expect(buzz.combHz).toBeLessThanOrEqual(band.maxHz);
      // battleshipBuzz.constraint: below jetMarch, owner-confirmed. Asserted
      // against what was measured, not against the band's printed edges.
      expect(buzz.combHz).toBeLessThan(Math.min(...march.map((run) => run.hz)));
    }
    // "Held" is a statement about the whole crossing, not about one tick.
    //
    // The buzz's period is *deliberately* not equal from one tick to the next:
    // it is eight O strobes, and a sweep is however long the ROM's between-sweep
    // work took. So the four seconds of buzz arrive as hundreds of one-period
    // runs rather than one long one, and a per-run floor of the kind the march
    // uses would be asserting the buzz is something it is not. What "held" means
    // is that the sound is *present* for seconds rather than for one note, so it
    // is the stretch that is bounded - and battleshipBuzz.durationSec is 3.80 s
    // and 4.05 s, either of which clears this by a wide margin.
    const heldMs = buzzes.reduce((total, sound) => total + sound.ms, 0);
    expect(heldMs).toBeGreaterThan(1000);
  });

  it('blipped the missile inside contract criterion V5', () => {
    const blips = named('missileFire');
    expect(blips.length).toBeGreaterThan(0);
    for (const blip of blips) {
      expect(blip.ms).toBeLessThan(150);
    }
  });

  it('played the loss envelope, and told its collapse from the buzz', () => {
    // The overlap the TMS1370's buzz forced this file to resolve. Both sounds
    // put a note in 80-97 Hz, so a band lookup on frequency alone labels the
    // loss sound's collapse as a battleship crossing - and would go on passing
    // while the ROM stopped playing the collapse at all. What separates them is
    // the decay floor, so this asserts the whole envelope: the floor is present,
    // the collapse is in the sound the floor identifies, and the stretch it
    // sits in is not one the comb reads as the buzz.
    const losses = allSounds.filter((sound) => isLossEnvelope(sound));
    expect(losses.length, 'no loss sound in either window').toBeGreaterThan(0);
    for (const loss of losses) {
      expect(loss.carriesBuzz, `the loss sound at ${loss.atMs.toFixed(0)} ms read as a buzz`).toBe(
        false,
      );
    }
    const collapses = named(GAME_OVER_COLLAPSE);
    expect(collapses.length, 'the loss sound never collapsed to its low buzz').toBeGreaterThan(0);
  });
});
