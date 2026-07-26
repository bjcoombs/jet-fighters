// Every noise the ROM makes, measured off D14 against docs/evidence/audio-reference.md.
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
//   - Segmenting sounds at a gap of 5 ms splits the loss sound's 96 Hz collapse
//     into individual transitions, because a 96 Hz square wave holds each level
//     for 5.2 ms. They read as seven lone edges - the exact signature of a pin
//     driven and never returned to rest - and they are nothing of the kind.
//     BURST_GAP_CYCLES is 8000 (20 ms), above that half-period and below the
//     ~10200-cycle warning-beep gap, so it splits sounds without splitting a note.
//   - Taking one frequency for a whole segment averages any two sounds that run
//     back to back. A march step immediately followed by a battleship lane step
//     - 640 Hz then 287 Hz, ~400 cycles apart - reads as a single 399 Hz burst
//     belonging to no band at all. So a segment is broken into runs of like
//     periods first, and each run is measured on its own.
//
// Reading the stream either of those ways says the ROM is broken where it is
// not, and says nothing about where it is.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';

/**
 * Silence that separates two sounds, in machine cycles - 20 ms.
 *
 * Above the 5.2 ms half-period of the slowest note the ROM plays (the loss
 * sound's 96 Hz collapse) and below the ~10200-cycle gap between two
 * launcher-hit warning beeps. Same constant as machine-probe.test.ts and
 * jetfighter-rom.test.ts.
 */
const BURST_GAP_CYCLES = 8000;

/**
 * How far two consecutive periods may differ and still count as one note.
 *
 * The ROM's sound table documents a twelve-cycle stretch on the period that
 * straddles a burst boundary; at the fastest note that is 4.4%. Six percent
 * clears it while still breaking at a real note change - the smallest step
 * between two sounds the ROM plays back to back is 239 Hz to 195 Hz, 22%.
 */
const RUN_TOLERANCE = 0.06;

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

const BANDS: readonly Band[] = [
  // missileFire.dominantHzRange, and contract criterion V5's < 150 ms.
  { name: 'missileFire', minHz: 1480, maxHz: 1632, minMs: 8, maxMs: 150 },
  // jetMarch.dominantHzRange; jetMarch.stepDurationMs is 70 ms.
  { name: 'jetMarch', minHz: 600, maxHz: 650, minMs: 60, maxMs: 120 },
  // battleshipBuzz.dominantHzRange. The measurement calls it "sustained" and v1
  // synthesized 380 ms; the ROM plays one buzz per lane step of the crossing.
  { name: 'battleshipBuzz', minHz: 230, maxHz: 300, minMs: 60, maxMs: 400 },
  // win.fundamentalsHz, +/- 3%. The jingle needs 199 points and is not reached
  // by the scenarios below; the rows are here so the table is the whole contract.
  { name: 'win F#5 (750 Hz)', minHz: 727, maxHz: 772, minMs: 100, maxMs: 400 },
  { name: 'win A#5 (940 Hz)', minHz: 912, maxHz: 968, minMs: 100, maxMs: 400 },
  { name: 'win D#6 (1240 Hz)', minHz: 1203, maxHz: 1277, minMs: 100, maxMs: 400 },
  // launcherHitWarning.dominantHzRange, which is also gameOver.openingHzRange -
  // audio-reference.md records them as the same pitch. The beep is a measured
  // ~10 ms, so this is the one band whose floor is below the click threshold;
  // a run measures rise-to-rise and so reads one period short of the note.
  { name: 'launcherHitWarning / gameOver opening', minHz: 455, maxHz: 545, minMs: 7, maxMs: 60 },
  // The rest of the gameOver envelope: collapse, rasp body, drift, decay floor.
  { name: 'gameOver collapse', minHz: 80, maxHz: 97, minMs: 20, maxMs: 120 },
  { name: 'gameOver rasp body', minHz: 200, maxHz: 280, minMs: 60, maxMs: 320 },
  { name: 'gameOver drift', minHz: 190, maxHz: 205, minMs: 60, maxMs: 320 },
  { name: 'gameOver decay floor', minHz: 140, maxHz: 155, minMs: 60, maxMs: 380 },
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
}

/** A board running the real game ROM, freshly powered on. */
function romBoard(): Board {
  const path = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');
  const assembly = assemble(readFileSync(path, 'utf8'), path);
  return new Board(romImage(assembly));
}

/** Break a sound's rising edges into runs of like periods. */
function runsOf(rising: readonly number[]): Run[] {
  const periods = rising.slice(1).map((cycle, index) => cycle - rising[index]!);
  const runs: Run[] = [];
  let current: number[] = [];
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
  };
  for (const period of periods) {
    const previous = current[current.length - 1];
    if (previous !== undefined && Math.abs(period - previous) / previous >= RUN_TOLERANCE) {
      close();
    }
    current.push(period);
  }
  close();
  return runs;
}

/** Split an edge stream into sounds, each broken into its runs. */
function soundsIn(edges: ReturnType<Board['takeSpeakerEdges']>): Sound[] {
  const groups: (typeof edges)[] = [];
  let group: typeof edges = [];
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
  return groups.map((edgesInSound) => ({
    atMs: (edgesInSound[0]!.cycle / CYCLE_HZ) * 1000,
    edges: edgesInSound.length,
    ms:
      ((edgesInSound[edgesInSound.length - 1]!.cycle - edgesInSound[0]!.cycle) / CYCLE_HZ) * 1000,
    runs: runsOf(edgesInSound.filter((edge) => edge.level === 1).map((edge) => edge.cycle)),
  }));
}

/** The band a run falls in, or undefined if it belongs to none. */
function bandOf(run: Run): Band | undefined {
  return BANDS.find((band) => run.hz >= band.minHz && run.hz <= band.maxHz);
}

/** Runs long enough to be a note rather than the join between two notes. */
function notesOf(sound: Sound): Run[] {
  return sound.runs.filter((run) => run.periods >= MIN_RUN_PERIODS);
}

/**
 * Every sound two scenarios produce, and the raw edges behind them.
 *
 * Two, because the ROM's noises divide by trigger: firing produces the missile
 * blip, and simply leaving the machine alone produces the march, the battleship
 * crossing and eventually the loss sound. 400 frames is several of each.
 */
function scenario(fire: boolean): { edges: ReturnType<Board['takeSpeakerEdges']>; sounds: Sound[] } {
  const board = romBoard();
  if (fire) {
    board.setFire(true);
    board.runFrames(6);
    board.setFire(false);
  }
  board.runFrames(400);
  const edges = board.takeSpeakerEdges();
  return { edges, sounds: soundsIn(edges) };
}

const idle = scenario(false);
const fired = scenario(true);
const allSounds = [...idle.sounds, ...fired.sounds];

describe('the D14 pin is never left driven', () => {
  it('made noise in both scenarios', () => {
    expect(idle.sounds.length).toBeGreaterThan(0);
    expect(fired.sounds.length).toBeGreaterThan(0);
  });

  it('alternates every transition, so no edge is left without its partner', () => {
    // A routine that raised the pin and returned without lowering it would show
    // up here as two rises in a row - a step in the waveform, which is a click.
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
    // makes it a pop is that nothing inside its own 20 ms completes it.
    const lone = allSounds.filter((sound) => sound.edges < 2);
    expect(lone.map((sound) => sound.atMs.toFixed(1))).toEqual([]);
  });
});

describe('every sustained note lands in a band audio-reference.md measured', () => {
  it('resolved at least one note in every sound', () => {
    const silentSounds = allSounds.filter((sound) => notesOf(sound).length === 0);
    expect(silentSounds.map((sound) => sound.atMs.toFixed(1))).toEqual([]);
  });

  it('puts every note inside a measured band', () => {
    const strays = allSounds.flatMap((sound) =>
      notesOf(sound)
        .filter((run) => bandOf(run) === undefined)
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
        const band = bandOf(run);
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
        const band = bandOf(run);
        return band !== undefined && run.ms > band.maxMs
          ? [`${band.name}: ${run.ms.toFixed(1)} ms, allows ${band.maxMs} ms`]
          : [];
      }),
    );
    expect(tooLong).toEqual([]);
  });

  it('leaves only note joins unaccounted for', () => {
    // Runs below MIN_RUN_PERIODS are the single stretched period between two
    // sounds the ROM plays back to back - the march running straight into a
    // battleship lane step, or one note of the loss envelope into the next.
    // They are a real property of a machine with one core, but there must be
    // few of them, or the run grouping is shredding notes rather than joining
    // them and every assertion above is measuring the wrong thing.
    const joins = allSounds.flatMap((sound) =>
      sound.runs.filter((run) => run.periods < MIN_RUN_PERIODS),
    );
    const notes = allSounds.flatMap((sound) => notesOf(sound));
    expect(joins.length).toBeLessThan(notes.length);
  });
});

describe('the sounds the scenarios actually reached', () => {
  const named = (name: string): Run[] =>
    allSounds.flatMap((sound) => notesOf(sound).filter((run) => bandOf(run)?.name === name));

  it('marched, at 600-650 Hz for ~70 ms a step', () => {
    const march = named('jetMarch');
    expect(march.length).toBeGreaterThan(0);
    for (const step of march) {
      // jetMarch.stepDurationMs is 70 ms. A run measures rise-to-rise and so
      // reads one period - 1.6 ms here - short of the note the ROM plays.
      expect(step.ms).toBeGreaterThan(60);
    }
  });

  it('buzzed the battleship below the march, and held the buzz', () => {
    const buzz = named('battleshipBuzz');
    const march = named('jetMarch');
    expect(buzz.length).toBeGreaterThan(0);
    // battleshipBuzz.constraint: below jetMarch, owner-confirmed. Asserted
    // against what was measured, not against the band's printed edges.
    expect(Math.max(...buzz.map((run) => run.hz))).toBeLessThan(
      Math.min(...march.map((run) => run.hz)),
    );
    for (const step of buzz) {
      expect(step.ms).toBeGreaterThan(60);
    }
  });

  it('blipped the missile inside contract criterion V5', () => {
    const blips = named('missileFire');
    expect(blips.length).toBeGreaterThan(0);
    for (const blip of blips) {
      expect(blip.ms).toBeLessThan(150);
    }
  });
});
