// The squadron keeps its cadence across a launcher loss.
//
// Paths in this file are relative to the repository root.
//
// ## The defect this exists to stop coming back
//
// `jet_march` counts down a nibble pair to the squadron's next step, and the
// reload that restarts it - `step_reload`, which reads the cadence ladder - sat
// at the *end* of the lane walk. A jet crossing the G line in the lever's own
// lane left that walk from the middle: `jm_capture` branched away to
// `launcher_down` and the walk's end was never reached. The countdown was
// therefore left exactly as `jet_march` had spent it - high nibble zero, low
// nibble reloaded to 15 - and the squadron's next step came sixteen sweeps
// later instead of the ladder's hundred and sixty.
//
// Measured on the shipped v3 ROM, lever parked and fire never pressed, the
// march-step intervals in sweeps were:
//
// | lever lane | intervals                                          |
// | ---------- | -------------------------------------------------- |
// | 0 (up)     | 160 x5, **16**, 160 x4, **16**, 160 x5             |
// | 1 (centre) | 160 x4, **16**, 160 x4                             |
// | 2 (down)   | 160 x4, **16**, 160 x4, **16**, 160 x4             |
//
// and every 16 fell on the interval that spanned a capture. Sixteen sweeps is
// not merely the bottom of the ladder - it is *below* it. The ladder floors
// `STEP_HI` at `STEP_HI_MIN`, so the shortest step the rule can ask for is
// {@link LADDER_FLOOR_SWEEPS} sweeps; an unreloaded countdown gives
// {@link UNRELOADED_SWEEPS}, a cadence no skill setting and no score can
// produce. That is what makes this a control-flow defect rather than an
// aggressive rung: the squadron took a free step the rules never granted it,
// immediately after the moment the player was least able to answer it.
//
// ## Why the countdown and not the march note
//
// A march step is audible - `jm_beep` sounds jetMarch, 627 Hz for ~72 ms - but
// the beep is emitted from the walk's end too, so the capture step is silent and
// the speaker reports the collapse as one 176-sweep gap rather than a 160 and a
// 16. The countdown pair is where the rule actually lives, and it is game state
// in the emulated RAM as CLAUDE.md requires all game state to be, put there by
// the program. Reading it names the defect; reading the speaker averages it away.
//
// The pair is read as one number, `STEP_HI * 16 + STEP_LO`. It falls by one on
// every sweep, so the sweep on which it *rises* is a march step and there is no
// threshold to tune: a reload rises to {@link LADDER_TOP_SWEEPS} - 1 and a
// skipped one rises to {@link UNRELOADED_SWEEPS} - 1.
//
// ## Why a parked lever, and how a capture is told from a rocket
//
// A parked lever loses all three launchers without anyone playing - the property
// `tools/probe/launcher-lives.test.ts` establishes - which is what makes the
// capture path reachable deliberately rather than by luck. Fire is never
// pressed, so no missile ever exists: no jet is ever shot, `NIB_KILLS` stays 0,
// and the ladder therefore stays on its top rung for the whole run. That is what
// lets the expected interval be a single number instead of a history.
//
// The two ways to lose a launcher are separated the way the ROM separates them.
// `jm_capture` clears the arriving jet's lane nibble, and the only lane whose
// arrival costs anything is the lever's own, so a launcher lost on the sweep the
// lever-lane jet nibble fell to zero is a capture and a launcher lost on any
// other sweep is a rocket. Measured, that splits the parked game into three
// captures in lane 0 and two captures and one rocket in each of lanes 1 and 2 -
// the same split launcher-lives.test.ts records from `NIB_HITS` and the rocket's
// own nibble, arrived at here independently.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { CAPTURE_WINDOW_CYCLES } from '../../src/machine/board/tms1370-cadence.js';
import { Tms1370Machine, assembleGame, planesOf, squadronMap } from './tms1370-probe.js';

/** The assembled game ROM, kept so symbol values are read rather than typed. */
const GAME_ASM = assembleGame();

function gameSymbol(name: string): number {
  const found = GAME_ASM.symbols.find((definition) => definition.name === name);
  if (found === undefined) throw new Error(`asm/jetfighter.asm no longer defines ${name}`);
  return found.value;
}

/** Nibbles in a RAM file, which is also the radix of every nibble pair. */
const NIBBLES_PER_FILE = 16;

const ADDRESS = {
  hits: gameSymbol('FILE_STATE') * NIBBLES_PER_FILE + gameSymbol('NIB_HITS'),
  kills: gameSymbol('FILE_STATE') * NIBBLES_PER_FILE + gameSymbol('NIB_KILLS'),
  stepLo: gameSymbol('FILE_TIME') * NIBBLES_PER_FILE + gameSymbol('NIB_STEP_LO'),
  stepHi: gameSymbol('FILE_TIME') * NIBBLES_PER_FILE + gameSymbol('NIB_STEP_HI'),
} as const;

/** Where the two plane slots live, read from the ROM rather than written down. */
const SQUADRON = squadronMap(GAME_ASM);

/** `NIB_HITS` when the last launcher has gone - three, and the game is over. */
const LAUNCHERS = gameSymbol('HITS_LAST');

/**
 * The low nibble `step_reload` writes: `TCMIY 15` in `sr_ok`.
 *
 * A literal in the ROM rather than an `.EQU`, because 15 is the nibble's own
 * ceiling rather than a tuning knob - it is not the ladder, it is the radix.
 */
const STEP_LO_RELOAD = NIBBLES_PER_FILE - 1;

/**
 * Sweeps between march steps for a given high nibble.
 *
 * The pair is spent low first and the step falls on the sweep *after* it reaches
 * zero, so a pair of `hi:15` lasts `hi * 16 + 15 + 1` sweeps. The `+ 1` is the
 * same correction `tools/probe/battleship-arrival.test.ts` applies to the
 * battleship's pair, and for the same reason.
 */
function sweepsFor(stepHi: number): number {
  return stepHi * NIBBLES_PER_FILE + STEP_LO_RELOAD + 1;
}

/**
 * The ladder's own rule: `STEP_HI = STEP_HI_MAX - kills - STEP_SKILL * (skill -
 * 1)`, floored at `STEP_HI_MIN`, expressed in sweeps.
 */
function ladderSweeps(skill: number, kills: number): number {
  const rung =
    gameSymbol('STEP_HI_MAX') - kills - gameSymbol('STEP_SKILL') * (skill - 1);
  return sweepsFor(Math.max(gameSymbol('STEP_HI_MIN'), rung));
}

/** The skill the runs below are driven at: the dial's slowest, gentlest setting. */
const SKILL = 1;

/** 160 sweeps - the top rung, which is where a run with no kills stays. */
const LADDER_TOP_SWEEPS = ladderSweeps(SKILL, 0);

/** 32 sweeps - the fastest step the ladder can ask for, at any skill or score. */
const LADDER_FLOOR_SWEEPS = sweepsFor(gameSymbol('STEP_HI_MIN'));

/**
 * 16 sweeps - what an unreloaded countdown gives, and the defect's signature.
 *
 * `jet_march` leaves the pair at `0:15` on the sweep it steps, so a step that
 * misses `step_reload` runs on that instead of on a rung. It is below
 * {@link LADDER_FLOOR_SWEEPS}, so no rule can produce it.
 */
const UNRELOADED_SWEEPS = sweepsFor(0);

/**
 * March steps a parked game lasts, measured.
 *
 * The third launcher falls on the 18th march step with the lever in lane 0, the
 * 10th in lane 1 and the 13th in lane 2. The horizon below is a multiple of this
 * rather than a literal count of sweeps or seconds, for the reason CLAUDE.md
 * gives: this is a machine that stops, and a literal horizon in a test about one
 * is a bet on when it stops. A rules or cadence change moves this one number.
 */
const PARKED_GAME_MARCH_STEPS = 18;

/**
 * The sweep ceiling each run is given: twice the longest parked game.
 *
 * Not a measurement - the escape for a game that never ends. Every run below
 * stops on the third launcher, so the ceiling is only ever reached by a ROM that
 * has stopped losing them, and a run that hits it fails the vacuity check rather
 * than passing quietly.
 */
const SWEEP_CEILING = 2 * PARKED_GAME_MARCH_STEPS * LADDER_TOP_SWEEPS;

/**
 * The cycle ceiling one `runSweeps` call is given.
 *
 * launcher-lives.test.ts's reasoning, unchanged: the ROM stops sweeping for the
 * whole of every sound, so a caller waiting on a sweep during the 0.67 s loss
 * envelope must not spin for ever. {@link CAPTURE_WINDOW_CYCLES} is the named
 * horizon that already bounds a launcher-loss event.
 */
const SWEEP_WAIT_CYCLES = CAPTURE_WINDOW_CYCLES;

/** The three lanes the lever's detents select, and what the case calls each. */
const LEVERS = [
  { detent: 'up', lane: 0 },
  { detent: 'centre', lane: 1 },
  { detent: 'down', lane: 2 },
] as const;

/** What one parked game did to the march countdown. */
interface Game {
  /** The sweep of every march step, in order. */
  readonly steps: readonly number[];
  /** The sweep of every launcher lost to a jet reaching the G line. */
  readonly captures: readonly number[];
  /** The sweep of every launcher lost to a rocket. */
  readonly rockets: readonly number[];
  /** The highest `NIB_KILLS` reached, which must stay 0: fire is never pressed. */
  readonly peakKills: number;
  /** Launchers lost by the end of the run. */
  readonly hits: number;
  /** Sweeps the run took. */
  readonly sweeps: number;
}

/**
 * Park the lever in one lane, never touch fire, and watch the countdown.
 *
 * Advanced a sweep at a time because the countdown moves once per sweep and the
 * question is which sweep it moved on. RAM is snapshotted once per sweep rather
 * than per nibble: `machine.ram` rebuilds the whole 128-nibble image on each read.
 */
function standStill(lane: number): Game {
  const machine = new Tms1370Machine();
  machine.setContacts({ skill: SKILL, lane });
  const steps: number[] = [];
  const captures: number[] = [];
  const rockets: number[] = [];
  let peakKills = 0;
  let hits = 0;
  let previousPair: number | undefined;
  let previousAirborne = 0;
  while (hits < LAUNCHERS && machine.sweepCount < SWEEP_CEILING) {
    machine.runSweeps(1, SWEEP_WAIT_CYCLES);
    const ram = machine.ram;
    const pair = (ram[ADDRESS.stepHi] as number) * NIBBLES_PER_FILE + (ram[ADDRESS.stepLo] as number);
    const airborne = planesOf(ram, SQUADRON).length;
    const seenHits = ram[ADDRESS.hits] as number;
    peakKills = Math.max(peakKills, ram[ADDRESS.kills] as number);
    if (previousPair !== undefined && pair > previousPair) {
      steps.push(machine.sweepCount);
    }
    if (seenHits > hits) {
      // **A capture is told from a rocket by the squadron getting smaller.**
      // This used to read the lever's own lane nibble, on the rule that only an
      // arrival in that lane cost anything; that rule is gone (a capture costs a
      // launcher wherever the lever stands) and the nibble is gone with it. What
      // distinguishes the two is that `jm_capture` clears the crossing plane's
      // column and `launcher_hit` clears nothing - so a launcher lost on a sweep
      // where the squadron shrank is a capture and one where it did not is a
      // rocket. Sound only because this drive never fires: a missile kill would
      // shrink the squadron too, and there are no missiles in a parked game.
      (airborne < previousAirborne ? captures : rockets).push(machine.sweepCount);
    }
    hits = seenHits;
    previousPair = pair;
    previousAirborne = airborne;
  }
  return { steps, captures, rockets, peakKills, hits, sweeps: machine.sweepCount };
}

/** Sweeps between consecutive march steps. */
function intervals(game: Game): number[] {
  return game.steps.slice(1).map((step, index) => step - (game.steps[index] as number));
}

/**
 * The interval spanning each capture: the one whose two march steps sit either
 * side of it.
 *
 * A capture that took the third launcher ends the game and is followed by no
 * march step at all, so it spans nothing and is not listed. That is why the
 * vacuity check below counts these rather than counting captures.
 */
function intervalsSpanningACapture(game: Game): { atCycleSweep: number; sweeps: number }[] {
  const spanning: { atCycleSweep: number; sweeps: number }[] = [];
  for (const capture of game.captures) {
    const after = game.steps.findIndex((step) => step > capture);
    if (after <= 0) {
      continue;
    }
    spanning.push({
      atCycleSweep: capture,
      sweeps: (game.steps[after] as number) - (game.steps[after - 1] as number),
    });
  }
  return spanning;
}

const games = new Map(LEVERS.map(({ lane }) => [lane, standStill(lane)]));

describe('the squadron keeps its march cadence across a launcher loss', () => {
  it('states a floor no rung can reach, so the signature is unambiguous', () => {
    // Not a property of the machine - a property of the two numbers the
    // assertions below tell apart. If a future ladder ever made a legitimate
    // rung as short as an unreloaded countdown, every assertion here would go
    // green on the defect and this is where that is caught.
    expect(UNRELOADED_SWEEPS).toBeLessThan(LADDER_FLOOR_SWEEPS);
    expect(LADDER_FLOOR_SWEEPS).toBeLessThanOrEqual(LADDER_TOP_SWEEPS);
  });

  for (const { detent, lane } of LEVERS) {
    describe(`lever parked in lane ${lane} (${detent})`, () => {
      const game = (): Game => games.get(lane) as Game;

      it('lost all three launchers, at least one of them to a capture', () => {
        // The vacuity guard. Everything below is quantified over captures, so a
        // run that reached the ceiling without losing a launcher - or lost them
        // all to rockets, which never leave the lane walk - would assert nothing.
        expect(game().hits, 'launchers lost').toBe(LAUNCHERS);
        expect(game().sweeps, 'the run hit its ceiling instead of ending').toBeLessThan(
          SWEEP_CEILING,
        );
        expect(intervalsSpanningACapture(game()).length, 'captures with a march step after them')
          .toBeGreaterThan(0);
      });

      it('never fired, so the ladder stayed on the rung the skill dial chose', () => {
        // What makes a single expected interval legitimate: `NIB_KILLS` walks the
        // ladder down, and nothing shot anything here.
        expect(game().peakKills, 'jets shot down').toBe(0);
      });

      it('holds the ladder value across the capture, rather than dropping to the floor', () => {
        // The assertion the defect fails. Pre-fix this reported 16 for the
        // interval spanning each non-terminal capture, against a top rung of 160.
        //
        // Each of the three assertions here counts what it is about before
        // quantifying over it. A `for` over an empty list and a `toEqual` against
        // a self-derived array both pass while asserting nothing, and a test that
        // goes green because its subject vanished is the failure mode this whole
        // run keeps finding - including in the rocket-lane check this PR repairs.
        const spanning = intervalsSpanningACapture(game());
        expect(spanning.length, 'intervals spanning a capture').toBeGreaterThan(0);
        for (const span of spanning) {
          expect(
            span.sweeps,
            `sweeps between the march steps either side of the capture at sweep ${span.atCycleSweep}`,
          ).toBe(LADDER_TOP_SWEEPS);
        }
      });

      it('steps at the ladder value for the whole game, capture or no capture', () => {
        // The same rule stated over every step rather than only the ones next to
        // a capture, which is what the invariant actually is: nothing in a game
        // where no jet was shot may change the squadron's cadence.
        const measured = intervals(game());
        expect(measured.length, 'march intervals measured').toBeGreaterThan(0);
        expect(measured).toEqual(measured.map(() => LADDER_TOP_SWEEPS));
      });

      it('never takes a step the cadence ladder cannot ask for', () => {
        // The rule from underneath, and the form that survives a ladder change:
        // no interval may be shorter than the shortest rung, whatever the rung.
        const measured = intervals(game());
        expect(measured.length, 'march intervals measured').toBeGreaterThan(0);
        for (const interval of measured) {
          expect(interval, 'sweeps between two march steps').toBeGreaterThanOrEqual(
            LADDER_FLOOR_SWEEPS,
          );
        }
      });
    });
  }
});
