// Three launchers, and the three ways the player finds out he has lost one.
//
// ## The defect this exists to stop coming back
//
// The owner played the deployed build beside his own CGL unit and reported "you
// seem to end the game after one loss, there's no three lives working". He was
// right, and the cause was one line: `game_capture` and `game_lost` were two
// labels on the same address. A jet reaching the G line therefore ran the loss
// sound and wrote ST_OVER without ever going near NIB_HITS, so the damage path
// - two beeps, three beeps, loss - existed and was correct and was reached only
// by rockets. Because a jet reaches the G line within seconds of power-on, that
// was how nearly every game ended, and the second and third launchers were
// never seen.
//
// ## Why the lever is parked, and why that is the interesting scenario
//
// A parked lever is the scenario the bug made impossible, and it is worth more
// than a test. `tools/probe/rom-atlas-conformance.test.ts` needs to drive rare
// events deliberately rather than wait for pacing to produce them, and the
// hardest of those is the player's own burst in a chosen lane. The deliberate
// way to reach it is to stand in one lane and wait to be destroyed - which could
// not work while a single capture ended the game, because a parked lever cannot
// cover the other two lanes and a jet reaches the G line within seconds. Being
// in the right lane when the shot arrived was therefore a coincidence rather
// than a choice. Standing still is now a strategy, and this file is the proof
// of the property that suite depends on.
//
// ## Why this reads the tube and the speaker rather than the RAM
//
// There is no lives display on this tube - owner-confirmed against his unit,
// and the three marks outside the playfield border are paint on the overlay.
// Damage is signalled by sound alone: two beeps on the first hit, three on the
// second, the full loss sound on the third (audio-reference.md,
// launcherHitWarning; all three owner-confirmed). The beeps *are* the lives
// indicator, so counting them off D14 is not a proxy for the rule - it is the
// rule, observed where a player observes it. A test that read NIB_HITS would
// prove the ROM incremented a nibble and say nothing about whether the player
// is ever told.
//
// The same discipline separates the two ways a launcher is lost, and it needs
// no RAM either. Fire is never pressed in any run below, so no missile is ever
// on the glass and a jet can leave the field only by reaching the G line. A jet
// vanishing from the deepest jet cell is therefore a capture and can be nothing
// else, and counting those against the warnings says which mechanism took each
// launcher.
//
// ## What makes a warning distinguishable from anything else the ROM plays
//
// Beeps inside one warning are separated by `warn_gap`, a measured 25-28 ms
// (audio-reference.md, launcherHitWarning.gapMs). That gap is wider than the
// 20 ms BURST_GAP_CYCLES that speaker-bands.test.ts uses to split sounds, so
// each beep arrives here as its own sound and a warning has to be reassembled
// by clustering. WARNING_CLUSTER_CYCLES is the reassembly window: well above
// the gap between two beeps of one warning, and far below the gap between two
// separate hits, which are whole game events apart.
//
// The loss sound opens on the same pitch as a warning beep - audio-reference.md
// records them as the same note - so pitch alone cannot tell the third hit from
// the first. What separates them is the collapse to 96 Hz that follows: nothing
// else this ROM plays goes near that band, so a sound containing one is the
// loss sound and no other sound is.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { assemble } from '../hmasm/assembler.js';
import { romImage } from '../hmasm/output.js';
import { Board } from '../../src/machine/board/board.js';
import type { SpeakerEdge } from '../../src/machine/board/speaker.js';
import { CYCLE_HZ } from '../../src/machine/cpu/cpu.js';

const ASM_PATH = resolve(import.meta.dirname, '..', '..', 'asm', 'jetfighter.asm');

/** Assemble the game ROM once and share the image across the runs below. */
const ROM = romImage(assemble(readFileSync(ASM_PATH, 'utf8'), ASM_PATH));

/**
 * Silence that separates two sounds, in machine cycles - 20 ms.
 *
 * The same constant, for the same reasons, as speaker-bands.test.ts: above the
 * 5.2 ms half-period of the slowest note the ROM plays and below the ~27 ms gap
 * between two beeps of one warning.
 */
const BURST_GAP_CYCLES = 8_000;

/**
 * How far apart two beeps may be and still belong to the same warning, in
 * machine cycles - 200 ms.
 *
 * `warn_gap` is 26.7 ms, so this is seven times the gap it has to bridge. The
 * nearest thing it must *not* bridge is two separate launcher losses, which are
 * seconds apart in every run below.
 */
const WARNING_CLUSTER_CYCLES = 80_000;

/**
 * How long after a launcher is lost the tube may take to show the jet gone, in
 * machine cycles - 1.5 s.
 *
 * The two are simultaneous in the ROM: the same `tick` clears the captured jet
 * and starts the sound. They are not simultaneous to an observer, because
 * `note_loop` stops sweeping the tube while it plays, so the sweep that would
 * have shown the jet gone does not complete until the sound has finished. The
 * lag is therefore the length of the sound, and the worst case is the whole
 * five-stage loss envelope: measured at 0.74 s, against 0.08 s and 0.18 s for
 * the two warnings.
 *
 * 1.5 s is twice that worst case and still well inside the 3.4 s between the
 * two closest launcher losses, which is what stops a departure being matched to
 * the wrong one.
 */
const CAPTURE_WINDOW_CYCLES = 600_000;

/**
 * How far *before* a launcher loss a departure may be seen, in machine cycles.
 *
 * Essentially zero: the tube can only report the jet gone after the ROM has
 * removed it, so a departure that preceded the sound would mean the two were
 * not the same event. One sweep of slack, for the sampling boundary.
 */
const CAPTURE_LEAD_CYCLES = 20_000;

/** How far two consecutive periods may differ and still count as one note. */
const RUN_TOLERANCE = 0.06;

/** Periods a run needs before it is a note rather than a transition artefact. */
const MIN_RUN_PERIODS = 3;

/** launcherHitWarning.dominantHzRange, which the loss opening shares. */
const WARNING_HZ = { min: 455, max: 545 } as const;

/** gameOver's collapse stage - the band no other sound in this ROM enters. */
const COLLAPSE_HZ = { min: 80, max: 97 } as const;

/**
 * The deepest cell a jet is ever drawn in: distance column 1, on grid 5.
 *
 * Column N is grid 6 - N, and column 0 is the G line itself, where the tube
 * prints no aircraft - the player's cell carries the launcher and its burst
 * instead. So grid 5 is the last place a jet is seen, and a jet disappearing
 * from it has either been shot or has arrived.
 */
const GRID_DEEPEST_JET = 5;

/** The nearest playfield cell a jet or a missile dart is drawn in. */
const GRID_NEAREST_PLAYFIELD = 1;

/** Plates 0-2 of a playfield grid: the jet in lane 0, 1, 2 of that column. */
const PLATE_JET = [0, 1, 2];

/**
 * Plates 6-8: the missile dart under grids 1-5, the launcher under grid 6.
 *
 * The grid decides which, which is why the search below is bounded to the
 * playfield - the launcher is lit on grid 6 for the whole game and reading it
 * as a shot would make every run look as though fire had been pressed.
 */
const PLATE_DART = [6, 7, 8];

/**
 * Emulated seconds to run for.
 *
 * An unattended machine loses its third launcher at 20.2 s and stops sounding
 * at 20.5 s, so thirty covers a whole game with room for the cadence constants
 * to move without the runs quietly stopping short of the ending.
 */
const HORIZON_S = 30;

/** Wall-clock allowance: three thirty-second games is several real seconds. */
const LONG_RUN_TIMEOUT_MS = 60_000;

/** Where the lever can be parked, and the lane each position selects. */
const LEVERS = [
  { position: 'up', lane: 0 },
  { position: 'centre', lane: 1 },
  { position: 'down', lane: 2 },
] as const;

/** One gap-separated stretch of speaker activity, and the pitches inside it. */
interface Sound {
  readonly atCycle: number;
  readonly hz: readonly number[];
}

/** What one game, played by standing still, produced. */
interface Game {
  /** Every sound the speaker made, in order. */
  readonly sounds: readonly Sound[];
  /** The cycle of each sweep on which a jet left the deepest jet cell. */
  readonly departures: readonly number[];
  /** Whether a missile dart was ever lit anywhere on the playfield. */
  readonly everFired: boolean;
}

/**
 * Park the lever in one lane, never touch fire, and watch.
 *
 * Advanced a sweep at a time because the tube is the second observation surface
 * here and it only means anything on a completed sweep. The speaker is drained
 * every sweep for the usual reason: the buffer is finite and a run this long
 * would otherwise discard edges and make a sounding machine look silent.
 */
function standStill(position: string): Game {
  const board = new Board(ROM);
  board.setControl('lever', position);
  const edges: SpeakerEdge[] = [];
  const departures: number[] = [];
  let everFired = false;
  let wasDeep = false;
  const target = Math.round(HORIZON_S * CYCLE_HZ);
  while (board.cycles < target) {
    board.runFrames(1);
    edges.push(...board.takeSpeakerEdges());
    const lit = board.getFrame().segments.filter((segment) => segment.duty > 0);
    const isDeep = lit.some(
      (segment) => segment.grid === GRID_DEEPEST_JET && PLATE_JET.includes(segment.plate),
    );
    if (
      lit.some(
        (segment) =>
          segment.grid >= GRID_NEAREST_PLAYFIELD &&
          segment.grid <= GRID_DEEPEST_JET &&
          PLATE_DART.includes(segment.plate),
      )
    ) {
      everFired = true;
    }
    if (wasDeep && !isDeep) {
      departures.push(board.cycles);
    }
    wasDeep = isDeep;
  }
  return { sounds: soundsIn(edges), departures, everFired };
}

/** Split an edge stream into sounds, each reduced to the pitches it holds. */
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
  return groups.map((inSound) => ({
    atCycle: inSound[0]!.cycle,
    hz: pitchesIn(inSound.filter((edge) => edge.level === 1).map((edge) => edge.cycle)),
  }));
}

/**
 * The sustained pitches inside one sound.
 *
 * Rising edges are turned into periods, the periods broken into runs of like
 * periods, and each run long enough to be a note reported at its median - the
 * same method speaker-bands.test.ts uses, and for the same reason: one figure
 * for a whole sound averages a march step running into a battleship buzz and
 * reports a pitch belonging to neither.
 */
function pitchesIn(rising: readonly number[]): number[] {
  const periods = rising.slice(1).map((cycle, index) => cycle - rising[index]!);
  const pitches: number[] = [];
  let current: number[] = [];
  const close = (): void => {
    if (current.length >= MIN_RUN_PERIODS) {
      const sorted = [...current].sort((left, right) => left - right);
      pitches.push(CYCLE_HZ / sorted[Math.floor(sorted.length / 2)]!);
    }
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
  return pitches;
}

/** Does this sound hold a note in the given band? */
function holds(sound: Sound, band: { min: number; max: number }): boolean {
  return sound.hz.some((hz) => hz >= band.min && hz <= band.max);
}

/** The loss sound: the only one that collapses to 96 Hz. */
function isLoss(sound: Sound): boolean {
  return holds(sound, COLLAPSE_HZ);
}

/** A single warning beep: warning-pitched, and not the loss sound opening. */
function isBeep(sound: Sound): boolean {
  return holds(sound, WARNING_HZ) && !isLoss(sound);
}

/**
 * The warnings in a game: beeps gathered into the hits they announce.
 *
 * @returns one entry per launcher announced by beeps, holding how many beeps
 *   announced it and when it happened.
 */
function warningsIn(game: Game): { beeps: number; atCycle: number }[] {
  const warnings: { beeps: number; atCycle: number }[] = [];
  let last = -Infinity;
  for (const sound of game.sounds.filter(isBeep)) {
    const previous = warnings[warnings.length - 1];
    if (previous !== undefined && sound.atCycle - last <= WARNING_CLUSTER_CYCLES) {
      warnings[warnings.length - 1] = { ...previous, beeps: previous.beeps + 1 };
    } else {
      warnings.push({ beeps: 1, atCycle: sound.atCycle });
    }
    last = sound.atCycle;
  }
  return warnings;
}

/** Every moment a launcher was lost: the two warned ones, then the loss sound. */
function launcherLosses(game: Game): number[] {
  return [...warningsIn(game).map((warning) => warning.atCycle), ...lossesIn(game).map((s) => s.atCycle)];
}

/** The loss sounds in a game. There must be exactly one. */
function lossesIn(game: Game): Sound[] {
  return game.sounds.filter(isLoss);
}

const games = new Map(LEVERS.map(({ position }) => [position, standStill(position)]));

describe('standing still costs three launchers, and the third ends the game', () => {
  for (const { position, lane } of LEVERS) {
    describe(`lever parked in lane ${lane} (${position})`, () => {
      const game = (): Game => games.get(position)!;

      it(
        'announces exactly two launchers before it ends, at two beeps then three',
        () => {
          // The assertion the reported defect fails. On the ROM that ended a
          // game at the first capture this list is empty for the two lanes
          // whose launchers are taken by jets: the machine went straight to the
          // loss sound and the warnings were never reached at all.
          expect(warningsIn(game()).map((warning) => warning.beeps)).toEqual([2, 3]);
        },
        LONG_RUN_TIMEOUT_MS,
      );

      it('plays the loss sound exactly once, and only after both warnings', () => {
        const losses = lossesIn(game());
        expect(losses).toHaveLength(1);
        for (const warning of warningsIn(game())) {
          expect(warning.atCycle).toBeLessThan(losses[0]!.atCycle);
        }
      });

      it('keeps playing after each of the first two launchers is lost', () => {
        // The half of the rule the beep count cannot carry. A ROM that sounded
        // two beeps and *then* stopped would satisfy the count and still be the
        // bug the owner reported, so what has to be shown is that the game went
        // on: the machine kept making game noises - the march, the battleship
        // buzz - after each warning, and they are game noises because the game
        // is the only thing that produces them.
        for (const warning of warningsIn(game())) {
          const after = game().sounds.filter(
            (sound) => sound.atCycle > warning.atCycle + WARNING_CLUSTER_CYCLES && !isLoss(sound),
          );
          expect(after.length, `sounds after the ${warning.beeps}-beep warning`).toBeGreaterThan(0);
        }
      });

      it('ends the game on the third, and sounds nothing afterwards', () => {
        // The endings are terminal and the power switch is the only reset, so
        // anything after the loss sound would mean the game went on playing
        // past its own ending.
        const loss = lossesIn(game())[0]!;
        expect(game().sounds.filter((sound) => sound.atCycle > loss.atCycle)).toEqual([]);
      });

      it('never fires, so nothing here is the player defending himself', () => {
        expect(game().everFired).toBe(false);
      });
    });
  }
});

describe('which mechanism took each launcher, read off the tube', () => {
  // Fire is never pressed, so no missile exists and a jet can leave the field
  // only by reaching the G line. Counting jets that vanish from the deepest jet
  // cell therefore separates the two ways a launcher is lost without reading a
  // nibble of RAM.

  it(
    'takes all three by capture when the lever stands in the centre or bottom lane',
    () => {
      for (const position of ['centre', 'down'] as const) {
        const game = games.get(position)!;
        expect(game.departures, `${position}: jets that reached the G line`).toHaveLength(3);
        // And each launcher went at the moment one of them arrived - the
        // arrival never *preceding* the sound, because the tube cannot report a
        // jet gone before the ROM has removed it.
        for (const loss of launcherLosses(game)) {
          const cause = game.departures.find(
            (departure) =>
              departure - loss >= -CAPTURE_LEAD_CYCLES &&
              departure - loss <= CAPTURE_WINDOW_CYCLES,
          );
          expect(cause, `${position}: a capture at the moment of the loss at ${loss}`).toBeDefined();
        }
      }
    },
    LONG_RUN_TIMEOUT_MS,
  );

  it('takes all three by rocket when the lever stands in the top lane', () => {
    // Not a rule and not a target - it is what the current cadences and the
    // rocket's lane selection happen to produce, and it is asserted because it
    // is the negative control for the test above. The same three-launcher rule
    // holds here with no jet ever reaching the G line at all, which is what
    // says that rule belongs to the launcher and not to the capture path.
    //
    // If this starts failing because jets now get through in lane 0 too, the
    // fix is to note that here, not to force it back.
    const game = games.get('up')!;
    expect(game.departures).toHaveLength(0);
    expect(warningsIn(game).map((warning) => warning.beeps)).toEqual([2, 3]);
    expect(lossesIn(game)).toHaveLength(1);
  });
});
