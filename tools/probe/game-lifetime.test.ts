// How long the machine keeps running, and why it stops when it stops.
//
// Paths in this file are relative to the repository root.
//
// ## Why this file exists
//
// A long probe run of this ROM looks alarming. Drive sixty seconds of emulated
// time with no controls touched and the speaker falls silent partway through
// and stays silent for the rest of the run. The lit-segment output is
// byte-identical from there to the end, and a fire contact closed at any point
// afterwards changes neither it nor the speaker.
//
// All of that is true and none of it is a fault. The reading it invites - that
// the ROM has wedged in a loop that never terminates - is wrong, and this file
// is here so the next person to run that probe does not spend a night chasing
// it.
//
// What is actually happening: the ROM plays a whole game and loses. Jets enter,
// march one column at a time, and reach the G line; each arrival costs the
// player a launcher, and the third one ends the game (PRD v1 rule 6, as
// amended - see that rule for why a capture costs a launcher rather than the
// game). `game_lost` writes ST_OVER into NIB_STATE and plays the loss sound.
// From the next sweep on, `tick` reads NIB_STATE, takes its `MNEZ` arm into
// `tk_ended` and goes straight to `render` - so the sweep keeps running, the
// tube keeps being refreshed with a picture that no longer changes, and nothing
// ever touches the speaker again. That is the documented behaviour of the unit:
// the endings are terminal and the power switch is the only reset.
//
// So the tests below pin the three claims that separate "ended" from "wedged":
//
//   1. after the sound stops the machine is still sweeping the tube and still
//      executing;
//   2. a machine whose controls are actually being worked keeps sounding and
//      keeps redrawing far beyond the unattended machine's silence - the game
//      is playable, and its length is a function of play, not of a timer
//      running out;
//   3. powering a finished machine on again starts a new game.
//
// (2) is the load-bearing one. It fails for a ROM that has genuinely stopped
// executing, and passes for one that merely reached an ending, which is the
// distinction the probe run on its own cannot make.
//
// ## Two v2-era assertions that have no TMS1370 counterpart
//
// The v2 form of this file asked its core two questions alongside the
// liveness checks, and neither can be asked of this one. Neither was dropped
// quietly:
//
// - **The low-power state the v2 core's `SBY` instruction enters.** It is a Hitachi
//   concept with no TMS1000-family counterpart: this core has no such state, so
//   there is nothing to read and nothing that would be true or false about it.
//   What that assertion *meant* - the core is still fetching rather than parked
//   - is what `sweepCount` and the cycle count carry here, and both are asserted
//   over a window that begins after the machine went quiet.
// - **Illegal opcodes.** The TMS1370 decoder is total: all 256 eight-bit
//   patterns are assigned by the fixed instruction PLA, so there is no
//   unassigned encoding to land on and no counter to read
//   (`src/machine/cpu/tms1370/decoder.ts`). A corrupted return address is still
//   possible and is still caught, but by its consequence rather than by a decode
//   fault: a sweep loop that stopped issuing its twenty-four strobes fails the
//   windowed grid and sweep assertions below.
//
// Everything is read off the probe's observation surface -
// `takeSpeakerEdges()`, `getFrame()`, `sweepCount`, `strobes` - and every
// control movement goes through `setContacts`, closing a case contact as a
// player's hand does. Nothing here reads the ROM's RAM; a test that asserted on
// NIB_STATE would prove the ROM computed the right number and say nothing about
// whether the machine was alive.
//
// Node-side test: no DOM, no browser globals.

import { describe, it, expect } from 'vitest';
import { PLAYER_SLICE_CYCLES, SWEEP_HZ } from '../../src/machine/board/tms1370-cadence.js';
import { GRID_COUNT } from '../../src/machine/cpu/tms1370/ports.js';
import { CYCLE_HZ } from '../../src/machine/cpu/tms1370/timing.js';
import { Tms1370Machine, type SpeakerEdge } from './tms1370-probe.js';

/** Seconds of emulated time, in instruction cycles. */
function seconds(count: number): number {
  return Math.round(count * CYCLE_HZ);
}

/**
 * The moment the unattended machine falls silent, in seconds.
 *
 * Not a target: it is where the capture rule and this machine's cadence
 * constants happen to land today, and it moves whenever those constants do. It
 * is named because it is the figure that started the misdiagnosis, and every
 * horizon below is stated as a multiple of it.
 *
 * **24.6 s is measured on the TMS1370**, by driving a machine with no contact
 * closed at all for ninety seconds of emulated time and timing two things: the
 * last speaker edge lands at **24.556 s** and the last change of picture at
 * **24.579 s**. Nothing happens on either surface over the remaining sixty-five
 * seconds. Both landing together is the point - a machine that had wedged would
 * show the picture freezing without the sound having finished a phrase.
 *
 * The v2 figure was 20.6 s and it reached that only after two wrong answers:
 * 5.66 s while a single capture ended the game, then an *estimated* 10.92 s
 * offered as "roughly twice" it, which was short of the ending the horizons were
 * meant to contain and turned main red. This one is measured for that reason,
 * and it is not the v2 figure rescaled - the instruction rate, the sweep length
 * and the cadence ladder all moved with the core, so the only honest way to get
 * it was to run this machine and look.
 */
const UNATTENDED_SILENCE_S = 24.6;

/**
 * Margin past the ending, in seconds: a fifth of the silence horizon.
 *
 * Used wherever a run has to be *certainly* over rather than about to be, and
 * wherever a short window is needed to show that a machine is or is not
 * sounding. Derived rather than chosen so that it moves with the ending it is
 * margin around.
 */
const ENDED_MARGIN_S = UNATTENDED_SILENCE_S * 0.2;

/**
 * The window a liveness question is asked over, in seconds.
 *
 * Same reason as {@link ENDED_MARGIN_S}: it is a fraction of the horizon rather
 * than a figure of its own, so a cadence change moves one number. At today's
 * value it is a little under five seconds, which is around three hundred sweeps.
 */
const LIVENESS_WINDOW_S = UNATTENDED_SILENCE_S / 5;

/** The three lanes the lever's detents select, in the order a hand walks them. */
const LEVER_LANES = [0, 1, 2] as const;

/**
 * Wall-clock allowance for the runs below.
 *
 * The horizon is the point of these tests, so the timeout moves rather than the
 * horizon. Each run here is a few million instructions and completes in a couple
 * of wall-clock seconds, but the allowance is stated rather than inherited so
 * that a slower machine or a longer horizon does not turn a liveness result into
 * a timeout.
 */
const LONG_RUN_TIMEOUT_MS = 60_000;

/**
 * Run the machine, draining the speaker as it goes.
 *
 * The speaker buffer is drained periodically for the same reason the v2 board
 * had to be: a run that let it grow for a minute of emulated time is holding
 * tens of thousands of edges nothing will read, and the drained stream is what
 * every assertion below is phrased over.
 *
 * The slice is `PLAYER_SLICE_CYCLES`, a fifth of a sweep, imported rather than
 * restated: under v2 it was the literal 3,000 in this file and three others, and
 * every one of them silently meant "at 400 kHz". The blind player below advances
 * the lever one lane and changes the fire contact every slice, so a full walk of
 * the three lanes takes six of them - faster than a human works a case, slower
 * than the ROM's own input scan, which samples each strobe column once per
 * sweep. Nothing about the argument below depends on the exact figure; it
 * decides how well the blind player plays, and therefore how long the game it is
 * playing lasts.
 *
 * @param machine the machine to advance.
 * @param cycles emulated instruction cycles to run for.
 * @param onSlice called before each slice; where a player moves the controls.
 * @returns every speaker edge produced during the run.
 */
function run(
  machine: Tms1370Machine,
  cycles: number,
  onSlice?: (machine: Tms1370Machine, slice: number) => void,
): SpeakerEdge[] {
  const edges: SpeakerEdge[] = [];
  const target = machine.cycles + cycles;
  let slice = 0;
  while (machine.cycles < target) {
    onSlice?.(machine, slice);
    machine.step(PLAYER_SLICE_CYCLES);
    edges.push(...machine.takeSpeakerEdges());
    slice += 1;
  }
  return edges;
}

/**
 * A player who cannot see the tube.
 *
 * It walks the lever through the three lanes and works the fire contact, which
 * is enough to shoot down jets: the missile launches in whichever lane the lever
 * is standing in, so cycling the lever while pressing fire eventually puts a
 * shot under every jet. It plays badly - it aims at nothing - and it still keeps
 * the game alive well past the unattended machine's own silence, which is the
 * whole point. A player that read the tube would prove less, because its skill
 * rather than the ROM's liveness would be carrying the result.
 *
 * The skill dial is deliberately left open, exactly as the unattended runs leave
 * it, so that the only difference between the two populations is the hand on the
 * lever and the button.
 */
function blindPlayer(machine: Tms1370Machine, slice: number): void {
  machine.setContacts({
    lane: LEVER_LANES[Math.floor(slice / 2) % LEVER_LANES.length],
    fire: slice % 2 === 0,
  });
}

/**
 * The launcher: grid 6, plates 6-8, one per lane.
 *
 * Excluded from the signature below. See `tubeSignature`.
 */
const GRID_LAUNCHER = 6;
const PLATES_LAUNCHER = [6, 7, 8];

/**
 * A stable, comparable rendering of what the ROM last drew on the tube,
 * excluding the one segment the player's hand moves directly.
 *
 * The last *completed* sweep, not what a viewer sees at this instant: these runs
 * are read at arbitrary cycles, and an arbitrary cycle lands inside a sound's
 * blanking often enough to matter - the ROM parks the sweep while it bit-bangs
 * the speaker and the tube really is dark then (vfd-appearance.md D1). "The tube
 * changed" is a question about what the ROM drew.
 *
 * ## Why the launcher is left out, which is load bearing
 *
 * `tick` returns to `render` at its first test once the game is over, and the
 * launcher is drawn in whatever lane the lever is standing in. So on a machine
 * whose game ended, moving the lever still changes the picture, for ever.
 *
 * That made the liveness assertion below pass on a corpse. Measured on the v2
 * machine: let one end unattended, confirm it is silent, then waggle the lever
 * at it for thirty seconds. It produces no speaker edge at all and three
 * distinct pictures - comfortably over the "more than one" the assertion asks
 * for. Take the launcher out of the signature and the same run collapses to one.
 *
 * The frozen-picture control could not catch this, because the two runs differ
 * in whether the lever is worked as well as in whether the game is alive: the
 * unattended machine's lever never moves, so its picture freezes whether or not
 * the launcher is counted. What was being compared was a machine with a moving
 * hand against one without, not a live game against a dead one.
 *
 * Everything else on the tube is the game's: jets march, the score changes,
 * bursts light and go out, and none of it moves after `NIB_STATE` leaves
 * ST_PLAY. The missile is the player's too, but a shot can only exist while the
 * game is running, so it is a fair liveness signal and stays in.
 */
function tubeSignature(machine: Tms1370Machine): string {
  return machine
    .getFrame()
    .segments.filter(
      (segment) =>
        !(segment.grid === GRID_LAUNCHER && PLATES_LAUNCHER.includes(segment.plate)),
    )
    .map((segment) => `${segment.grid}.${segment.plate}`)
    .sort()
    .join(' ');
}

/** How many buckets the sound of a played run is scored over. */
const SOUND_BUCKETS = 10;

/** Split edges into `count` equal buckets spanning `cycles`, by edge cycle. */
function bucketByCycle(
  edges: readonly SpeakerEdge[],
  cycles: number,
  count: number,
): number[] {
  const buckets = new Array<number>(count).fill(0);
  const width = cycles / count;
  for (const { cycle } of edges) {
    const bucket = Math.min(count - 1, Math.floor(cycle / width));
    if (bucket >= 0) {
      buckets[bucket] += 1;
    }
  }
  return buckets;
}

describe('the unattended machine reaches an ending rather than wedging', () => {
  it(
    'keeps sweeping the tube and executing long after the speaker falls silent',
    () => {
      // `keepStrobes` because the windowed grid assertion below needs to know
      // *which* grids were driven after the machine went quiet, and the probe's
      // `getStrobedGrids()` accumulates from power-on with nothing to clear it.
      const machine = new Tms1370Machine({ keepStrobes: true });
      const horizon = seconds(UNATTENDED_SILENCE_S * 2.5);

      const edges = run(machine, horizon);

      // The symptom, reproduced: the speaker stops early and stays stopped.
      expect(edges.length).toBeGreaterThan(0);
      const lastEdge = edges[edges.length - 1] as SpeakerEdge;
      expect(lastEdge.cycle / CYCLE_HZ).toBeLessThan(UNATTENDED_SILENCE_S * 2);

      // And the diagnosis it does *not* support. The core is still fetching -
      // `step` returns only when the budget is spent, so a machine that had
      // stopped executing could not reach the horizon at all.
      expect(machine.cycles).toBeGreaterThanOrEqual(horizon);

      // The clinching one: whole display sweeps are still being run, measured
      // over a window that begins *after* the machine went quiet.
      //
      // Both the strobe log and `sweepCount` count from power-on, so read
      // straight off a finished machine they answer "at some point since power
      // came up", and a ROM that wedged mid-game in a loop touching one grid
      // would still report every grid from the gameplay that preceded it.
      // Taking marks here is what makes the next window the thing being
      // observed. Nothing is reset - there is no reset but the power switch -
      // so the marks are indices into what has already been recorded.
      //
      // The whole-run figure is asserted too, and against `GRID_COUNT` rather
      // than against a list of grid numbers: this machine scans nine grids where
      // the v2 board it replaces scanned ten, and a suite carrying its own
      // copy of that number is how a ten-grid assumption survives a rebuild.
      expect(machine.getStrobedGrids()).toEqual(
        Array.from({ length: GRID_COUNT }, (_unused, grid) => grid),
      );
      const strobesBefore = machine.strobes.length;
      const sweepsBefore = machine.sweepCount;

      run(machine, seconds(LIVENESS_WINDOW_S));

      // And the same claim again, this time bounded to the window: every grid
      // the part defines, driven *after* the machine went quiet, so it is the
      // whole sweep still running and not a fragment of it. This is the half the
      // assertion above cannot make, because that one is satisfied by the
      // gameplay that preceded the ending.
      const gridsInWindow = [
        ...new Set(machine.strobes.slice(strobesBefore).map((strobe) => strobe.grid)),
      ].sort((left, right) => left - right);
      expect(gridsInWindow).toEqual(
        Array.from({ length: GRID_COUNT }, (_unused, grid) => grid),
      );

      // And enough completed sweeps in the window to be sweeps rather than one
      // stalled grid. The expected count is the window at `SWEEP_HZ`; half of it
      // is the floor, which leaves room for the sweep to slow under whatever is
      // on the glass without leaving room for it to have stopped.
      const sweepsInWindow = machine.sweepCount - sweepsBefore;
      expect(sweepsInWindow).toBeGreaterThan((SWEEP_HZ * LIVENESS_WINDOW_S) / 2);
    },
    LONG_RUN_TIMEOUT_MS,
  );

  it(
    'freezes its picture, which is what the played machine is measured against',
    () => {
      // The negative control for the liveness assertion in the next block, and
      // the reason that assertion is not vacuous: the same measurement, on the
      // same helper, over the same window, must come out the other way here.
      //
      // The unattended machine is *not* wedged - the test above proves it is
      // still running whole sweeps - so what distinguishes it is that its
      // picture stops changing. A liveness check that this machine also passes
      // is measuring nothing.
      const machine = new Tms1370Machine();
      // Twice the measured silence, so the ending falls well inside the first
      // two thirds and the window below is entirely after it. At a horizon equal
      // to the silence itself this would sample the ending, and read a game
      // still playing as a picture that had not frozen.
      const horizon = seconds(UNATTENDED_SILENCE_S * 2);
      const { samples } = sampleRun(machine, horizon);

      expect(new Set(lastThird(machine, horizon, samples)).size, 'frozen picture').toBe(1);
      // And frozen while still sweeping, so the two properties are independent
      // and the played machine has to satisfy both.
      expect(machine.sweepCount).toBeGreaterThan((SWEEP_HZ * UNATTENDED_SILENCE_S) / 2);
    },
    LONG_RUN_TIMEOUT_MS,
  );

  it(
    'is not brought back to life by working the lever at it',
    () => {
      // The second negative control, and the one the first cannot supply.
      //
      // The frozen-picture run above differs from the played run below in two
      // ways at once - the game is over, *and* nobody is touching the case - so
      // on its own it cannot say which of the two the liveness check is
      // actually reading. This run holds the first fixed and varies the second:
      // a machine that has definitely ended, with a hand working the controls.
      //
      // It matters because the answer used to be the wrong one. The render step
      // keeps drawing the launcher in whatever lane the lever selects long after
      // `tick` has stopped doing anything, so a dead machine with a moved lever
      // produced a changing picture and passed the liveness assertion. See
      // `tubeSignature` for the measurement and the fix.
      const machine = new Tms1370Machine();
      run(machine, seconds(UNATTENDED_SILENCE_S + ENDED_MARGIN_S));
      const sweepsBefore = machine.sweepCount;

      // Definitely finished: nothing more from the speaker, whatever is done to
      // it from here.
      const { edges, samples } = sampleRun(
        machine,
        seconds(UNATTENDED_SILENCE_S),
        blindPlayer,
      );
      expect(edges, 'a finished game makes no sound however the case is worked').toEqual([]);

      // And definitely still sweeping, so this is a picture that could have
      // changed and did not, rather than a display that stopped being driven.
      expect(new Set(samples.map((sample) => sample.picture)).size, 'frozen picture').toBe(1);
      expect(machine.sweepCount - sweepsBefore).toBeGreaterThan(
        (SWEEP_HZ * UNATTENDED_SILENCE_S) / 2,
      );
    },
    LONG_RUN_TIMEOUT_MS,
  );
});

/**
 * Run a machine and sample what the tube shows, with the samples timestamped.
 *
 * Timestamps are the point: a liveness question about the *end* of a run has to
 * be asked of a window that begins near the end of it. Both the strobe log and
 * `sweepCount` answer "at some point since power-on", so read straight off a
 * finished machine they are satisfied by one that worked for six seconds and
 * then wedged - which is the machine these tests exist to exclude.
 */
function sampleRun(
  machine: Tms1370Machine,
  horizon: number,
  onSlice?: (machine: Tms1370Machine, slice: number) => void,
): { edges: SpeakerEdge[]; samples: { cycle: number; picture: string }[] } {
  const samples: { cycle: number; picture: string }[] = [];
  const edges = run(machine, horizon, (playing, slice) => {
    onSlice?.(playing, slice);
    if (slice % 100 === 0) {
      samples.push({ cycle: playing.cycles, picture: tubeSignature(playing) });
    }
  });
  return { edges, samples };
}

/** The samples taken in the last third of a run of `horizon` cycles. */
function lastThird(
  machine: Tms1370Machine,
  horizon: number,
  samples: readonly { cycle: number; picture: string }[],
): string[] {
  const from = machine.cycles - Math.floor(horizon / 3);
  return samples.filter((sample) => sample.cycle >= from).map((sample) => sample.picture);
}

describe('a machine whose controls are worked keeps playing', () => {
  it(
    'sounds and redraws throughout a run far longer than the unattended machine',
    () => {
      const machine = new Tms1370Machine();
      // Half again as long as the unattended machine's whole life, so "far
      // longer than the unattended machine" is a property of the horizon rather
      // than of the reader's goodwill.
      const horizon = seconds(UNATTENDED_SILENCE_S * 1.5);

      let sweepsAtTwoThirds = -1;
      const twoThirds = machine.cycles + Math.floor((horizon * 2) / 3);
      const { edges, samples } = sampleRun(machine, horizon, (playing, slice) => {
        blindPlayer(playing, slice);
        if (sweepsAtTwoThirds < 0 && playing.cycles >= twoThirds) {
          sweepsAtTwoThirds = playing.sweepCount;
        }
      });

      // Sound across the run, not just its first few seconds. Ten buckets.
      //
      // The bug this guards is a machine that stops *dead* partway in - the
      // unattended one, whose picture is byte-identical from 24.6 s on. A blind
      // player being destroyed is not that: the game ends, correctly, and the
      // tube goes on being swept and redrawn. This used to require all ten
      // buckets, which also required the blind player to survive the whole run,
      // and that is not a property of the machine - it depends on the sampled
      // counter the game takes its randomness from, so any change that moves the
      // cycle stream by a few cycles a sweep moves it.
      //
      // So the assertion is on the shape of the sound, not on its last bucket:
      // no silent gap anywhere inside the sounding part of the run, and the
      // sound reaching well past the point the bug stopped at.
      const buckets = bucketByCycle(edges, horizon, SOUND_BUCKETS);
      const lastHeard = buckets.reduce((last, count, at) => (count > 0 ? at : last), -1);
      expect(lastHeard, 'sound reached the last third of the run').toBeGreaterThanOrEqual(
        Math.floor(SOUND_BUCKETS * 0.7),
      );
      expect(
        buckets.slice(0, lastHeard + 1).filter((count) => count > 0),
        'no silent stretch before the game ends',
      ).toHaveLength(lastHeard + 1);

      // And a tube still being swept and still changing *at the end of the
      // run*, which is the half of this the bucket count no longer carries.
      //
      // Every assertion here is anchored on the horizon rather than on
      // power-on, and that is the whole point. A strobe log and a sweep count
      // both accumulate from power-on, so a machine that swept normally for six
      // seconds and then wedged solid satisfies any assertion phrased over the
      // whole run - they are true of exactly the machine this test exists to
      // exclude. That hole was fixed once before on this project, in #54, and it
      // came back the same way.
      const late = lastThird(machine, horizon, samples);
      expect(late.length, 'enough late samples to mean anything').toBeGreaterThan(3);
      expect(
        new Set(late).size,
        'the picture was still changing in the last third of the run',
      ).toBeGreaterThan(1);
      // And sweeps were still being completed after the two-thirds mark: a
      // wedged sweep loop stops closing them, however many it closed earlier.
      expect(sweepsAtTwoThirds).toBeGreaterThan(0);
      expect(
        machine.sweepCount,
        'the sweep was still completing periods at the horizon',
      ).toBeGreaterThan(sweepsAtTwoThirds);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});

describe('the power switch is the way back', () => {
  it(
    'starts a new game on a machine that has already ended one',
    () => {
      // There is no power switch on this harness, and there must not be a
      // restart path anywhere else either - CLAUDE.md's rule, and the reason the
      // v2 board's `powerOff()`/`powerOn()` pair has no counterpart here.
      // Constructing a `Tms1370Machine` *is* power-on: the core resets with RAM
      // undefined and the ROM clears all 112 nibbles itself before it draws
      // anything. So the second machine below is the same act the switch
      // performs, expressed the only way this machine offers it.
      const ended = new Tms1370Machine();

      // Past the measured 24.6 s at which an unattended game runs out of
      // launchers, with margin - not a round number chosen by eye.
      run(ended, seconds(UNATTENDED_SILENCE_S + ENDED_MARGIN_S));
      expect(run(ended, seconds(ENDED_MARGIN_S))).toHaveLength(0); // ended, and silent

      const fresh = new Tms1370Machine();

      // A fresh game: the sound comes back and the tube starts moving again.
      const signature = tubeSignature(fresh);
      const edges = run(fresh, seconds(ENDED_MARGIN_S));
      expect(edges.length).toBeGreaterThan(0);
      expect(tubeSignature(fresh)).not.toEqual(signature);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});
